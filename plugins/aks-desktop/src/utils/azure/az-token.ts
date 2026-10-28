// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Azure CLI-backed access tokens for Azure REST calls. */

import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/identity';
import { debugLog, isValidGuid, needsRelogin, runCommandAsync } from './az-cli-core';

/** Default public-cloud ARM scope; configured clouds can supply another audience. */
export const ARM_SCOPE = 'https://management.azure.com/.default';

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

// Tenant ID or domain name, with no leading `-`.
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i;

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
  getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken>;
  /** Forgets cached/in-flight token promises without cancelling their CLI processes. */
  clearCache(): void;
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
  subscriptionId?: string
): Promise<AccessToken> {
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

  /**
   * @param key - Tenant/scope cache key for this credential instance.
   * @param scope - Requested OAuth scope.
   * @param tenantId - Optional tenant selector or expected bound-account tenant.
   * @returns The cached acquisition promise, removed from the cache if rejected.
   */
  const load = (key: string, scope: string, tenantId?: string) => {
    const promise = requestCliToken(scope, tenantId, subscriptionId);
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
  const resolveToken = async (scope: string, tenantId?: string): Promise<AccessToken> => {
    const key = `${tenantId ?? ''}|${scope}`;
    const cached = cache.get(key);
    if (!cached) return load(key, scope, tenantId);

    const token = await cached;
    if (token.expiresOnTimestamp - REFRESH_MARGIN_MS > Date.now()) return token;
    const current = cache.get(key);
    return current && current !== cached ? current : load(key, scope, tenantId);
  };

  return {
    async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken> {
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
      return withAbort(() => resolveToken(scopeList[0], tenantId), options?.abortSignal);
    },
    clearCache() {
      cache.clear();
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

// Clears cache when user logs in or logs out inside the app.
if (typeof window !== 'undefined') {
  window.addEventListener('azure-auth-update', () => {
    azCliCredential.clearCache();
    for (const credential of subscriptionCredentials.values()) credential.clearCache();
  });
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
