// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getLoginStatus } from './az-auth';
import { getAzureCloudEndpoints } from './az-cloud';
import type { AzRequestOptions, AzResponse } from './az-http';
import {
  azRequestRaw,
  AzureRequestError,
  createAzureRequestSignal,
  waitForAzureRetry,
} from './az-http';
import { getSubscriptionCredential, withAbort } from './az-token';

const API_VERSION = '2026-01-01';
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_TOKEN_LIFETIME_MS = 60_000;
const ACCOUNT_VERIFICATION_FRESHNESS_MS = 30_000;
const WRITABLE_PROPERTIES = [
  'labels',
  'annotations',
  'defaultResourceQuota',
  'defaultNetworkPolicy',
  'adoptionPolicy',
  'deletePolicy',
] as const;
type Policy = 'AllowAll' | 'AllowSameNamespace' | 'DenyAll';
type PollTarget = { url: string; kind: 'operation' | 'location' | 'resource' };

/** Scope of a single AKS managed namespace. */
export interface ManagedNamespaceScope {
  /** Name of the AKS cluster. */
  clusterName: string;
  /** Resource group containing the cluster. */
  resourceGroup: string;
  /** Managed namespace name. */
  namespaceName: string;
  /** Subscription ID; when omitted, reads the current CLI account's subscription. */
  subscriptionId?: string;
  /** Cancels account lookup, requests, and polling. */
  signal?: AbortSignal;
}

/** Writable changes merged over the current managed namespace. */
export interface ManagedNamespaceUpdateOptions extends ManagedNamespaceScope {
  /** CPU request in millicores; undefined preserves the current value. */
  cpuRequest?: number;
  /** CPU limit in millicores; undefined preserves the current value. */
  cpuLimit?: number;
  /** Memory request in MiB; undefined preserves the current value. */
  memoryRequest?: number;
  /** Memory limit in MiB; undefined preserves the current value. */
  memoryLimit?: number;
  /** Ingress policy; undefined preserves the current value. */
  ingressPolicy?: Policy;
  /** Egress policy; undefined preserves the current value. */
  egressPolicy?: Policy;
  /** Labels to merge over current labels, retaining unrelated keys. */
  labels?: Record<string, string>;
  /** Return the accepted PUT body without polling or the final GET. */
  noWait?: boolean;
}

/** Full ARM resource returned by managed namespace GET. */
export interface ManagedNamespaceResource {
  /** ARM resource ID. */
  id: string;
  /** Resource name. */
  name: string;
  /** ARM resource type. */
  type: string;
  /** Azure resource location. */
  location: string;
  /** Optional ARM tags. */
  tags?: Record<string, string>;
  /** Read-only concurrency token, when returned by ARM. */
  eTag?: string;
  /** Namespace properties, including read-only service response fields. */
  properties: Record<string, unknown>;
  /** Other ARM response fields are retained for callers. */
  [key: string]: unknown;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringMap(value: unknown): boolean {
  return object(value) && Object.values(value).every(item => typeof item === 'string');
}

function malformed(field: string): never {
  throw new AzureRequestError(`Malformed managed namespace response: ${field}`);
}

function validateResource(value: unknown): ManagedNamespaceResource {
  if (!object(value)) malformed('expected full ARM resource');
  for (const key of ['id', 'name', 'type', 'location']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) malformed(key);
  }
  if (!object(value.properties)) malformed('properties');
  if (value.tags !== undefined && !stringMap(value.tags)) malformed('tags');
  if (value.eTag !== undefined && typeof value.eTag !== 'string') malformed('eTag');
  for (const key of WRITABLE_PROPERTIES) {
    const field = value.properties[key];
    if (field === undefined) continue;
    if (['adoptionPolicy', 'deletePolicy'].includes(key)) {
      if (typeof field !== 'string') malformed(`properties.${key}`);
    } else if (['labels', 'annotations'].includes(key)) {
      if (!stringMap(field)) malformed(`properties.${key}`);
    } else {
      if (!object(field)) malformed(`properties.${key}`);
      const known =
        key === 'defaultResourceQuota'
          ? ['cpuRequest', 'cpuLimit', 'memoryRequest', 'memoryLimit']
          : ['ingress', 'egress'];
      for (const name of known) {
        if (field[name] !== undefined && typeof field[name] !== 'string') {
          malformed(`properties.${key}.${name}`);
        }
      }
    }
  }
  return value as ManagedNamespaceResource;
}

function accountIdentity(account: Awaited<ReturnType<typeof getLoginStatus>>): string {
  return JSON.stringify([
    account.isLoggedIn,
    account.username,
    account.tenantId,
    account.subscriptionId?.toLowerCase(),
    account.environmentName,
  ]);
}

function assertExpectedAccount(
  account: Awaited<ReturnType<typeof getLoginStatus>>,
  expectedIdentity: string,
  changedMessage: string
): void {
  if (!account.isLoggedIn) {
    throw new AzureRequestError(account.error ?? 'Unable to verify the selected Azure account');
  }
  if (accountIdentity(account) !== expectedIdentity) {
    throw new AzureRequestError(changedMessage);
  }
}

async function resourceContext(options: ManagedNamespaceScope) {
  const names = [options.resourceGroup, options.clusterName, options.namespaceName];
  const isDotSegment = (value: string) => value.trim() === '.' || value.trim() === '..';
  if (
    (options.subscriptionId !== undefined &&
      (typeof options.subscriptionId !== 'string' ||
        !options.subscriptionId.trim() ||
        isDotSegment(options.subscriptionId))) ||
    names.some(value => typeof value !== 'string' || !value.trim() || isDotSegment(value))
  ) {
    throw new AzureRequestError(
      'Managed namespace requires subscription, resource group, cluster and namespace'
    );
  }
  const account = await withAbort(
    () => getLoginStatus(options.subscriptionId, options.signal),
    options.signal
  );
  if (
    !account.isLoggedIn ||
    !account.subscriptionId ||
    isDotSegment(account.subscriptionId) ||
    !account.tenantId
  ) {
    throw new AzureRequestError(
      account.error ?? 'No Azure subscription or tenant; sign in to the target subscription'
    );
  }
  const [sub, group, cluster, namespace] = [account.subscriptionId, ...names].map(value =>
    encodeURIComponent(value)
  );
  const cloud = await getAzureCloudEndpoints(account.environmentName, options.signal);
  const sharedCredential = getSubscriptionCredential(account.subscriptionId);
  let token = await sharedCredential.getToken([cloud.scope], {
    tenantId: account.tenantId,
    abortSignal: options.signal,
  });
  const acquireToken = async () => {
    sharedCredential.clearCache?.(cloud.scope);
    return sharedCredential.getToken([cloud.scope], {
      tenantId: account.tenantId,
      abortSignal: options.signal,
    });
  };
  if (token.expiresOnTimestamp - Date.now() <= MIN_TOKEN_LIFETIME_MS) {
    token = await acquireToken();
    if (token.expiresOnTimestamp - Date.now() <= MIN_TOKEN_LIFETIME_MS) {
      throw new AzureRequestError(
        'Azure access token expires too soon to start the managed namespace operation'
      );
    }
  }
  const confirmed = await withAbort(
    () => getLoginStatus(options.subscriptionId, options.signal),
    options.signal
  );
  const expectedIdentity = accountIdentity(account);
  assertExpectedAccount(
    confirmed,
    expectedIdentity,
    'Azure account changed while preparing the managed namespace request'
  );
  let lastAccountVerification = Date.now();
  let accountVerification: Promise<void> | undefined;
  const verifyAccount = async (
    force: boolean,
    signal?: AbortSignal,
    changedMessage = 'Azure account changed while the managed namespace operation was running'
  ): Promise<void> => {
    if (!force && Date.now() - lastAccountVerification < ACCOUNT_VERIFICATION_FRESHNESS_MS) return;
    if (!accountVerification) {
      const verification = withAbort(
        () => getLoginStatus(options.subscriptionId, signal),
        signal
      ).then(status => {
        assertExpectedAccount(status, expectedIdentity, changedMessage);
        lastAccountVerification = Date.now();
      });
      accountVerification = verification.finally(() => {
        accountVerification = undefined;
      });
    }
    await withAbort(() => accountVerification!, signal);
  };
  const credential = {
    async getToken(scopes: string | string[]) {
      const requested = Array.isArray(scopes) ? scopes : [scopes];
      if (requested.length !== 1 || requested[0] !== cloud.scope) {
        throw new AzureRequestError('Managed namespace credential scope changed');
      }
      if (token.expiresOnTimestamp - Date.now() <= MIN_TOKEN_LIFETIME_MS) {
        await verifyAccount(true, options.signal);
        token = await acquireToken();
        await verifyAccount(
          true,
          options.signal,
          'Azure account changed while renewing the managed namespace token'
        );
        if (token.expiresOnTimestamp - Date.now() <= MIN_TOKEN_LIFETIME_MS) {
          throw new AzureRequestError(
            'Azure access token could not be renewed for the managed namespace operation'
          );
        }
      }
      return token;
    },
  };
  return {
    url: `${cloud.endpoint}/subscriptions/${sub}/resourceGroups/${group}/providers/Microsoft.ContainerService/managedClusters/${cluster}/managedNamespaces/${namespace}`,
    origin: new URL(cloud.endpoint).origin,
    tenantId: account.tenantId,
    scope: cloud.scope,
    credential,
    subscriptionId: options.subscriptionId,
    accountIdentity: expectedIdentity,
    verifyAccount,
  };
}

async function request(
  url: string,
  context: Awaited<ReturnType<typeof resourceContext>> &
    Partial<Pick<AzRequestOptions, 'timeoutMs'>>,
  signal?: AbortSignal,
  extra: Partial<AzRequestOptions> = {},
  forceAccountVerification = false
) {
  await context.verifyAccount(forceAccountVerification, signal);
  return azRequestRaw<unknown>({
    url,
    apiVersion: API_VERSION,
    tenantId: context.tenantId,
    scope: context.scope,
    credential: context.credential,
    timeoutMs: context.timeoutMs,
    signal,
    ...extra,
  });
}

/**
 * Reads a managed namespace without flattening its ARM resource shape.
 * @param options - Namespace scope and optional cancellation signal.
 * @returns The validated full ARM resource, retaining read-only response fields.
 */
export async function getManagedNamespaceResource(
  options: ManagedNamespaceScope
): Promise<ManagedNamespaceResource> {
  const linked = createAzureRequestSignal(options.signal);
  try {
    const context = await resourceContext({ ...options, signal: linked.signal });
    return validateResource((await request(context.url, context, linked.signal)).data);
  } finally {
    linked.dispose();
  }
}

function updateBody(current: ManagedNamespaceResource, options: ManagedNamespaceUpdateOptions) {
  const properties: Record<string, unknown> = {};
  for (const key of WRITABLE_PROPERTIES) {
    if (current.properties[key] !== undefined) properties[key] = current.properties[key];
  }
  if (options.labels !== undefined) {
    if (!stringMap(options.labels))
      throw new AzureRequestError('Namespace labels must be a string map');
    properties.labels = { ...(properties.labels as Record<string, string>), ...options.labels };
  }
  const quota = { ...(properties.defaultResourceQuota as Record<string, unknown>) };
  for (const key of ['cpuRequest', 'cpuLimit', 'memoryRequest', 'memoryLimit'] as const) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0)
      throw new AzureRequestError(`Invalid namespace quota: ${key}`);
    quota[key] = `${plainDecimal(value)}${key.startsWith('cpu') ? 'm' : 'Mi'}`;
    properties.defaultResourceQuota = quota;
  }
  for (const [option, key] of [
    ['ingressPolicy', 'ingress'],
    ['egressPolicy', 'egress'],
  ] as const) {
    if (options[option] !== undefined) {
      properties.defaultNetworkPolicy = {
        ...(properties.defaultNetworkPolicy as Record<string, unknown>),
        [key]: options[option],
      };
    }
  }
  return {
    location: current.location,
    ...(current.tags === undefined ? {} : { tags: current.tags }),
    properties,
  };
}

function plainDecimal(value: number): string {
  const [coefficient, exponent = '0'] = value.toString().split(/e/i);
  const [integer, fraction = ''] = coefficient.split('.');
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + Number(exponent);
  if (decimalPosition <= 0) return `0.${'0'.repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length)
    return `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
  return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function state(value: unknown, operation: boolean, response: AzResponse<unknown>): string {
  const raw = object(value)
    ? operation
      ? value.status
      : object(value.properties)
      ? value.properties.provisioningState
      : undefined
    : undefined;
  if (typeof raw !== 'string' || !raw.trim())
    throw operationError('Malformed operation status', response);
  const status = raw.toLowerCase();
  if (['failed', 'canceled', 'cancelled'].includes(status)) {
    throw operationError(`Managed namespace operation ${raw}`, response);
  }
  if (status === 'succeeded') return status;
  return status;
}

function operationError(message: string, response: AzResponse<unknown>): AzureRequestError {
  const error = object(response.data) && object(response.data.error) ? response.data.error : {};
  const requestId =
    response.headers.get('x-ms-request-id') ?? response.headers.get('request-id') ?? undefined;
  const correlationId = response.headers.get('x-ms-correlation-request-id') ?? undefined;
  const code = typeof error.code === 'string' ? error.code : undefined;
  const detail = typeof error.message === 'string' ? error.message : undefined;
  return new AzureRequestError(
    [
      message,
      code,
      detail,
      requestId && `request ID ${requestId}`,
      correlationId && `correlation ID ${correlationId}`,
    ]
      .filter(Boolean)
      .join(': '),
    { status: response.status, requestId, correlationId, code }
  );
}

function continuation(
  response: AzResponse<unknown>,
  base: string,
  origin: string
): PollTarget | undefined {
  const asyncUrl = response.headers.get('azure-asyncoperation');
  const location = asyncUrl ?? response.headers.get('location');
  if (!location) return undefined;
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    throw operationError('Invalid operation URL', response);
  }
  if (next.origin !== origin || next.username || next.password) {
    throw operationError('Refusing untrusted managed namespace operation URL', response);
  }
  return { url: next.href, kind: asyncUrl ? 'operation' : 'location' };
}

/**
 * Merges writable settings into a fresh GET and submits one ARM PUT.
 * If ARM returns an ETag, it is forwarded as If-Match; enforcement by this API is not guaranteed.
 * @param options - Scope, desired quota/policy/label changes, and optional no-wait or cancellation.
 * @returns Accepted PUT body for noWait; otherwise the full resource from the final successful GET.
 */
export async function updateManagedNamespaceResource(
  options: ManagedNamespaceUpdateOptions
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new AzureRequestError('Managed namespace update timed out after 10 minutes')
      ),
    UPDATE_TIMEOUT_MS
  );
  const signal = controller.signal;
  try {
    const context = {
      ...(await resourceContext({ ...options, signal })),
      timeoutMs: UPDATE_TIMEOUT_MS,
    };
    const { url, origin } = context;
    const initial = await request(url, context, signal);
    const current = validateResource(initial.data);
    const etag = initial.headers.get('etag') ?? current.eTag;
    let response = await request(
      url,
      context,
      signal,
      {
        method: 'PUT',
        body: updateBody(current, options),
        ...(etag ? { headers: { 'If-Match': etag } } : {}),
      },
      true
    );
    if (![200, 201, 202].includes(response.status)) {
      throw operationError('Unexpected managed namespace PUT response', response);
    }
    const putState =
      object(response.data) && object(response.data.properties)
        ? response.data.properties.provisioningState
        : undefined;
    if (putState !== undefined) state(response.data, false, response);
    if (options.noWait) return response.data ?? {};
    let next = continuation(response, url, origin);
    let pending = response.status === 202 || Boolean(next);
    if (putState !== undefined)
      pending = state(response.data, false, response) !== 'succeeded' || pending;
    next ??= { url, kind: 'resource' };
    while (pending) {
      await waitForAzureRetry(response.headers, signal);
      response = await request(next.url, context, signal);
      if (
        next.kind === 'location' &&
        response.data === undefined &&
        [200, 204].includes(response.status)
      ) {
        break;
      }
      // Location polling may return an operation status or a resource body.
      const operation =
        next.kind === 'operation' || (object(response.data) && 'status' in response.data);
      if (response.status === 202 && (next.kind === 'location' || !operation)) {
        if (object(response.data)) {
          if (typeof response.data.status === 'string') {
            state(response.data, true, response);
          }
          if (
            object(response.data.properties) &&
            typeof response.data.properties.provisioningState === 'string'
          ) {
            state(response.data, false, response);
          }
        }
        pending = true;
      } else {
        pending = state(response.data, operation, response) !== 'succeeded';
      }
      if (pending) next = continuation(response, next.url, origin) ?? next;
    }
    for (;;) {
      const final = await request(url, context, signal);
      const result = validateResource(final.data);
      if (state(result, false, final) === 'succeeded') return result;
      await waitForAzureRetry(final.headers, signal);
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
