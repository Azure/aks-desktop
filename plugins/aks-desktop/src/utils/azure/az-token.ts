// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Azure CLI-backed access tokens for Azure REST calls. */

import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/identity';
import {
  debugLog,
  isValidGuid,
  needsRelogin,
  registerNativeSubscriptionTenantLookup,
  runCommandAsync,
} from './az-cli-core';
import {
  getNativeAccount,
  getNativeAuthGeneration,
  hasNativeSession,
  isAzureExplicitlySignedOut,
  nativeCredential,
  type NativeTokenOptions,
  updateNativeAccountTenant,
} from './native-auth';

/** Default public-cloud ARM scope; configured clouds can supply another audience. */
export const ARM_SCOPE = 'https://management.azure.com/.default';

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

// Tenant ID or domain name, with no leading `-`.
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i;

let accountGeneration = 0;
interface NativeSubscriptionTenantBinding {
  tenant: string;
  tenants: Set<string>;
}
let nativeSubscriptionTenants = new Map<string, NativeSubscriptionTenantBinding>();
let observedNativeGeneration: number | undefined;

function synchronizeNativeGeneration(): void {
  const generation = getNativeAuthGeneration();
  if (observedNativeGeneration !== undefined && generation !== observedNativeGeneration) {
    accountGeneration++;
    nativeSubscriptionTenants.clear();
  }
  observedNativeGeneration = generation;
}

export const AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT = 'azure-subscription-tenant-change';

function dispatchNativeSubscriptionTenantChange(subscriptionIds: string[]): void {
  if (subscriptionIds.length > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, {
        detail: { subscriptionIds },
      })
    );
  }
}

/** Snapshot used to discard subscription discovery completed after an account change. */
export function getAzureAccountGeneration(): number {
  synchronizeNativeGeneration();
  return accountGeneration;
}

/**
 * Publishes native subscription bindings only if discovery belongs to the current account.
 * Bindings from tenants whose queries failed are preserved until a later successful query.
 */
export function setNativeSubscriptionTenants(
  subscriptions: Array<{ id: string; tenant: string; tenants?: string[] }>,
  generation: number,
  preserveTenantIds: string[] = []
): boolean {
  synchronizeNativeGeneration();
  if (generation !== accountGeneration || !hasNativeSession()) return false;
  registerNativeSubscriptionTenantLookup(
    subscriptionId => {
      synchronizeNativeGeneration();
      return nativeSubscriptionTenants.get(subscriptionId.toLowerCase())?.tenant;
    },
    canReconcileNativeSubscriptionTenant,
    reconcileNativeSubscriptionTenant
  );
  const preserved = new Set(
    preserveTenantIds.filter(isValidGuid).map(tenantId => tenantId.toLowerCase())
  );
  const next = new Map<string, NativeSubscriptionTenantBinding>();
  for (const [id, binding] of nativeSubscriptionTenants) {
    const tenants = new Set([...binding.tenants].filter(tenant => preserved.has(tenant)));
    if (tenants.size > 0) {
      next.set(id, {
        tenant: tenants.has(binding.tenant) ? binding.tenant : [...tenants][0],
        tenants,
      });
    }
  }
  for (const { id, tenant, tenants = [] } of subscriptions) {
    if (!isValidGuid(id) || !isValidGuid(tenant)) continue;
    const key = id.toLowerCase();
    const existing = next.get(key);
    const previousTenant = nativeSubscriptionTenants.get(key)?.tenant;
    const alternatives = new Set(
      [tenant, ...tenants].filter(isValidGuid).map(value => value.toLowerCase())
    );
    for (const alternative of existing?.tenants ?? []) alternatives.add(alternative);
    const selected =
      previousTenant && alternatives.has(previousTenant)
        ? previousTenant
        : existing && alternatives.has(existing.tenant)
        ? existing.tenant
        : tenant.toLowerCase();
    next.set(key, { tenant: selected, tenants: alternatives });
  }
  if (
    next.size !== nativeSubscriptionTenants.size ||
    [...next].some(([id, binding]) => {
      const current = nativeSubscriptionTenants.get(id);
      return (
        current?.tenant !== binding.tenant ||
        current.tenants.size !== binding.tenants.size ||
        [...binding.tenants].some(tenant => !current.tenants.has(tenant))
      );
    })
  ) {
    const changed = [...new Set([...nativeSubscriptionTenants.keys(), ...next.keys()])].filter(
      id => nativeSubscriptionTenants.get(id)?.tenant !== next.get(id)?.tenant
    );
    nativeSubscriptionTenants = next;
    dispatchNativeSubscriptionTenantChange(changed);
  }
  const account = getNativeAccount();
  const accountTenant = account
    ? nativeSubscriptionTenants.get(account.subscriptionId.toLowerCase())?.tenant
    : undefined;
  if (account && accountTenant) {
    updateNativeAccountTenant(account.subscriptionId, accountTenant);
  }
  return true;
}

/** Returns the tenant discovered for a native subscription in the current account generation. */
export function getNativeSubscriptionTenant(subscriptionId: string): string | undefined {
  synchronizeNativeGeneration();
  return nativeSubscriptionTenants.get(subscriptionId.toLowerCase())?.tenant;
}

function canReconcileNativeSubscriptionTenant(subscriptionId: string, tenantId: string): boolean {
  synchronizeNativeGeneration();
  const binding = nativeSubscriptionTenants.get(subscriptionId.toLowerCase());
  const tenant = tenantId.toLowerCase();
  return binding?.tenants.has(tenant) === true;
}

function reconcileNativeSubscriptionTenant(subscriptionId: string, tenantId: string): boolean {
  if (!canReconcileNativeSubscriptionTenant(subscriptionId, tenantId)) return false;
  const binding = nativeSubscriptionTenants.get(subscriptionId.toLowerCase())!;
  const tenant = tenantId.toLowerCase();
  const account = getNativeAccount();
  if (!account) return false;
  if (
    account.subscriptionId.toLowerCase() === subscriptionId.toLowerCase() &&
    !updateNativeAccountTenant(subscriptionId, tenant)
  ) {
    return false;
  }
  if (binding.tenant !== tenant) {
    binding.tenant = tenant;
    dispatchNativeSubscriptionTenantChange([subscriptionId.toLowerCase()]);
  }
  return true;
}

/** Token acquisition or validation failure without exposing the token response. */
export class AzTokenError extends Error {
  /** Whether the CLI diagnostic indicates that interactive login is required. */
  readonly needsRelogin: boolean;

  /**
   * @param message - Safe diagnostic, excluding access-token contents.
   * @param relogin - Whether to request interactive login; defaults to false.
   */
  constructor(message: string, relogin = false) {
    super(message);
    this.name = 'AzTokenError';
    this.needsRelogin = relogin;
  }
}

/** CLI-backed credential with per-instance tenant/scope caching and invalidation. */
export interface AzCliCredential extends TokenCredential {
  /**
   * @param scopes - One absolute scope, supplied as a string or singleton array.
   * @param options - Optional tenant and cancellation signal. Bound credentials
   * require a tenant GUID matching the selected account; unbound ones accept domains.
   * @returns A cached or refreshed access token, with expiry in Unix milliseconds.
   * @throws {AzTokenError} For invalid selectors, failed acquisition or tenant mismatch.
   */
  getToken(scopes: string | string[], options?: NativeTokenOptions): Promise<AccessToken>;
  /**
   * Forgets cached/in-flight token promises without cancelling their CLI processes.
   *
   * @param scope - Optional OAuth scope to evict; clears all cached scopes when omitted.
   */
  clearCache(scope?: string): void;
}

/**
 * Acquires a token using mutually exclusive CLI account/tenant selectors.
 * @param scope - OAuth scope, preserved exactly, including resource trailing slashes.
 * @param tenantId - Optional tenant selector or expected GUID for a bound account.
 * @param subscriptionId - Optional subscription whose CLI account takes precedence.
 * @returns The parsed token and its expiry in Unix milliseconds.
 * @throws {AzTokenError} For CLI, response-shape or expected-tenant failures.
 */
async function requestCliToken(
  scope: string,
  tenantId?: string,
  subscriptionId?: string,
  nativeSession = false,
  rejectedToken?: string
): Promise<AccessToken> {
  if (nativeSession) {
    return nativeCredential.getToken(scope, {
      tenantId,
      ...(rejectedToken !== undefined && { rejectedToken }),
    });
  }
  const args = ['account', 'get-access-token', '--scope', scope, '-o', 'json'];
  // Keep the selected account: Azure CLI rejects combining these selectors.
  if (subscriptionId) args.push('--subscription', subscriptionId);
  else if (tenantId) args.push('--tenant', tenantId);
  debugLog('[AZ-TOKEN] Requesting token for scope:', scope, 'tenant:', tenantId ?? '(default)');

  const { stdout, stderr } = await runCommandAsync('az', args);
  const output = stdout.trim();
  if (!output) {
    const message = stderr.trim() || 'Azure CLI returned no access token';
    throw new AzTokenError(message, needsRelogin(message));
  }

  let parsed: { accessToken?: unknown; expires_on?: unknown; tenant?: unknown };
  try {
    parsed = JSON.parse(output);
  } catch {
    // The stdout contains the access token, so it is not included in the error here.
    throw new AzTokenError('Azure CLI returned a malformed access token response');
  }

  const expiresOnSeconds = Number(parsed.expires_on);
  if (typeof parsed.accessToken !== 'string' || !parsed.accessToken || !expiresOnSeconds) {
    throw new AzTokenError('Azure CLI access token response is missing required fields');
  }
  if (
    subscriptionId &&
    tenantId &&
    (typeof parsed.tenant !== 'string' || parsed.tenant.toLowerCase() !== tenantId.toLowerCase())
  ) {
    throw new AzTokenError(
      'The selected subscription account does not belong to the requested tenant'
    );
  }
  return { token: parsed.accessToken, expiresOnTimestamp: expiresOnSeconds * 1000 };
}

/**
 * Runs `start` unless `signal` is already aborted, and rejects as soon as `signal` aborts.
 * The started promise itself keeps running.
 * @param start - Deferred asynchronous work; not called for a pre-aborted signal.
 * @param signal - Optional caller cancellation signal.
 * @returns The work result unless cancellation wins the race.
 * @throws The abort reason, an AzTokenError if none exists, or the work's rejection.
 */
export function withAbort<T>(
  start: () => Promise<T>,
  signal: GetTokenOptions['abortSignal']
): Promise<T> {
  if (!signal) return start();
  // Uses the signal's abort reason when it has one, otherwise an AzTokenError.
  const abortError = () =>
    (signal as { reason?: unknown }).reason ?? new AzTokenError('Token request was aborted');
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    new Promise<T>(started => started(start()))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Creates a credential with shared in-flight requests and a five-minute refresh margin.
 * @param subscriptionId - Optional account binding; omitted for tenant/default CLI selection.
 * @returns A credential whose token failures are evicted so later requests can retry.
 * Separate bound instances do not share tokens between subscription accounts.
 */
export function createAzCliCredential(subscriptionId?: string): AzCliCredential {
  const cache = new Map<string, Promise<AccessToken>>();
  let cacheGeneration = 0;
  const scopeGenerations = new Map<string, number>();

  /**
   * @param key - Tenant/scope cache key for this credential instance.
   * @param scope - Requested OAuth scope.
   * @param tenantId - Optional tenant selector or expected bound-account tenant.
   * @returns The cached acquisition promise, removed from the cache if rejected.
   */
  const load = (
    key: string,
    scope: string,
    tenantId: string | undefined,
    native: boolean,
    rejectedToken?: string
  ) => {
    const promise = requestCliToken(scope, tenantId, subscriptionId, native, rejectedToken);
    cache.set(key, promise);
    promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
    return promise;
  };

  /**
   * @param scope - Requested OAuth scope.
   * @param tenantId - Optional tenant included in the cache identity.
   * @returns The existing token, shared acquisition, or a token refreshed near expiry.
   */
  const resolveToken = async (
    scope: string,
    tenantId?: string,
    rejectedToken?: string
  ): Promise<AccessToken> => {
    synchronizeNativeGeneration();
    const native = hasNativeSession();
    let resolvedTenantId = tenantId;
    if (!native && isAzureExplicitlySignedOut()) {
      throw new AzTokenError('Azure login is required', true);
    }
    const accountVersion = accountGeneration;
    const cacheVersion = cacheGeneration;
    const scopeVersion = scopeGenerations.get(scope) ?? 0;
    if (native && subscriptionId) {
      const mappedTenant = nativeSubscriptionTenants.get(subscriptionId.toLowerCase())?.tenant;
      if (!mappedTenant) {
        throw new AzTokenError(
          'No tenant is known for the selected subscription; refresh subscriptions'
        );
      }
      if (tenantId && tenantId.toLowerCase() !== mappedTenant) {
        throw new AzTokenError(
          'The selected subscription account does not belong to the requested tenant'
        );
      }
      resolvedTenantId = mappedTenant;
    } else if (native && !tenantId) {
      resolvedTenantId = getNativeAccount()?.tenantId;
    }
    const key = `${native ? `native:${accountVersion}` : `cli:${accountVersion}`}|${
      resolvedTenantId ?? ''
    }|${scope}`;
    const cached = cache.get(key);
    const ensureCurrent = () => {
      synchronizeNativeGeneration();
      if (
        accountVersion !== accountGeneration ||
        cacheVersion !== cacheGeneration ||
        scopeVersion !== (scopeGenerations.get(scope) ?? 0) ||
        native !== hasNativeSession() ||
        (!native && isAzureExplicitlySignedOut()) ||
        (native &&
          subscriptionId !== undefined &&
          nativeSubscriptionTenants.get(subscriptionId.toLowerCase())?.tenant !==
            resolvedTenantId) ||
        (native &&
          subscriptionId === undefined &&
          tenantId === undefined &&
          getNativeAccount()?.tenantId.toLowerCase() !== resolvedTenantId?.toLowerCase())
      ) {
        throw new AzTokenError('Azure account changed during token acquisition');
      }
    };
    let token = await (cached ?? load(key, scope, resolvedTenantId, native, rejectedToken));
    ensureCurrent();
    if (
      cached &&
      (token.expiresOnTimestamp - REFRESH_MARGIN_MS <= Date.now() || token.token === rejectedToken)
    ) {
      const current = cache.get(key);
      token = await (current && current !== cached
        ? current
        : load(key, scope, resolvedTenantId, native, rejectedToken));
    }
    ensureCurrent();
    return token;
  };

  return {
    async getToken(scopes: string | string[], options?: NativeTokenOptions): Promise<AccessToken> {
      const scopeList = Array.isArray(scopes) ? scopes : [scopes];
      if (scopeList.length !== 1 || !SCOPE_PATTERN.test(scopeList[0])) {
        throw new AzTokenError('Exactly one valid token scope is required');
      }
      const tenantId = options?.tenantId;
      if (tenantId !== undefined && !TENANT_PATTERN.test(tenantId)) {
        throw new AzTokenError(`Invalid tenant ID: ${tenantId}`);
      }
      if (subscriptionId && tenantId !== undefined && !isValidGuid(tenantId)) {
        throw new AzTokenError(
          'A subscription-bound credential requires a tenant GUID for validation'
        );
      }
      return withAbort(
        () => resolveToken(scopeList[0], tenantId, options?.rejectedToken),
        options?.abortSignal
      );
    },
    clearCache(scope?: string) {
      if (scope === undefined) {
        cacheGeneration++;
        scopeGenerations.clear();
        cache.clear();
        return;
      }
      scopeGenerations.set(scope, (scopeGenerations.get(scope) ?? 0) + 1);
      const suffix = `|${scope}`;
      for (const key of cache.keys()) {
        if (key.endsWith(suffix)) {
          cache.delete(key);
        }
      }
    },
  };
}

/** Default credential used by `az-http`. */
export const azCliCredential = createAzCliCredential();
const subscriptionCredentials = new Map<string, AzCliCredential>();

/**
 * Reuses authentication for a subscription without changing the CLI's active account.
 * @param subscriptionId - Subscription GUID identifying the cached CLI account.
 * @returns The subscription's shared credential; login/logout events clear its tokens.
 * @throws {AzTokenError} If the subscription ID is not a GUID.
 */
export function getSubscriptionCredential(subscriptionId: string): AzCliCredential {
  if (!isValidGuid(subscriptionId)) throw new AzTokenError('Invalid subscription ID format');
  let credential = subscriptionCredentials.get(subscriptionId);
  if (!credential) {
    credential = createAzCliCredential(subscriptionId);
    subscriptionCredentials.set(subscriptionId, credential);
  }
  return credential;
}

/** Clears cached tokens for the default and all subscription-bound credentials. */
export function clearAzureTokenCaches(): void {
  azCliCredential.clearCache();
  for (const credential of subscriptionCredentials.values()) credential.clearCache();
}

// Clears cache when user logs in or logs out inside the app.
function handleAzureAccountChange(event: Event): void {
  if (event instanceof CustomEvent && Array.isArray(event.detail?.subscriptionIds)) {
    const changed = new Set<string>(
      event.detail.subscriptionIds
        .filter((id: unknown): id is string => typeof id === 'string')
        .map((id: string) => id.toLowerCase())
    );
    for (const [id, credential] of subscriptionCredentials) {
      if (changed.has(id.toLowerCase())) credential.clearCache();
    }
    return;
  }
  const nativeGeneration = getNativeAuthGeneration();
  const account = getNativeAccount();
  // Discovery during native login precedes the account publication event.
  const preserveNativeBindings =
    !!account && observedNativeGeneration === nativeGeneration && hasNativeSession();
  observedNativeGeneration = nativeGeneration;
  accountGeneration++;
  clearAzureTokenCaches();
  if (!preserveNativeBindings) {
    nativeSubscriptionTenants.clear();
  }
  if (account && nativeSubscriptionTenants.size === 0) {
    setNativeSubscriptionTenants(
      [{ id: account.subscriptionId, tenant: account.tenantId }],
      accountGeneration
    );
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('azure-auth-update', handleAzureAccountChange);
  window.addEventListener('azure-account-change', handleAzureAccountChange);
}

/**
 * @param scope - OAuth scope; defaults to the public-cloud ARM scope.
 * @param options - Optional tenant selector and cancellation signal.
 * @returns A token from the unbound default credential, using its refresh/cache rules.
 * @throws {AzTokenError} For invalid selectors or failed CLI acquisition.
 */
export function getAzToken(scope = ARM_SCOPE, options?: GetTokenOptions): Promise<AccessToken> {
  return azCliCredential.getToken(scope, options);
}
