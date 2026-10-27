// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getLoginStatus } from './az-auth';
import type { AzRequestOptions, AzResponse } from './az-http';
import { ARM_ENDPOINT, azRequestRaw, AzureRequestError } from './az-http';
import { withAbort } from './az-token';

const API_VERSION = '2026-01-01';
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const WRITABLE_PROPERTIES = [
  'labels',
  'annotations',
  'defaultResourceQuota',
  'defaultNetworkPolicy',
  'adoptionPolicy',
  'deletePolicy',
] as const;
type Policy = 'AllowAll' | 'AllowSameNamespace' | 'DenyAll';

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

async function resourceContext(options: ManagedNamespaceScope) {
  const names = [options.resourceGroup, options.clusterName, options.namespaceName];
  if (
    (options.subscriptionId !== undefined &&
      (typeof options.subscriptionId !== 'string' || !options.subscriptionId.trim())) ||
    names.some(value => typeof value !== 'string' || !value.trim())
  ) {
    throw new AzureRequestError(
      'Managed namespace requires subscription, resource group, cluster and namespace'
    );
  }
  const account = await withAbort(() => getLoginStatus(options.subscriptionId), options.signal);
  if (!account.isLoggedIn || !account.subscriptionId || !account.tenantId) {
    throw new AzureRequestError(
      account.error ?? 'No Azure subscription or tenant; sign in to the target subscription'
    );
  }
  const [sub, group, cluster, namespace] = [account.subscriptionId, ...names].map(value =>
    encodeURIComponent(value)
  );
  return {
    url: `${ARM_ENDPOINT}/subscriptions/${sub}/resourceGroups/${group}/providers/Microsoft.ContainerService/managedClusters/${cluster}/managedNamespaces/${namespace}`,
    tenantId: account.tenantId,
  };
}

function request(
  url: string,
  tenantId: string,
  signal?: AbortSignal,
  extra: Partial<AzRequestOptions> = {}
) {
  return azRequestRaw<unknown>({ url, apiVersion: API_VERSION, tenantId, signal, ...extra });
}

/**
 * Reads a managed namespace without flattening its ARM resource shape.
 * @param options - Namespace scope and optional cancellation signal.
 * @returns The validated full ARM resource, retaining read-only response fields.
 */
export async function getManagedNamespaceResource(
  options: ManagedNamespaceScope
): Promise<ManagedNamespaceResource> {
  const { url, tenantId } = await resourceContext(options);
  return validateResource((await request(url, tenantId, options.signal)).data);
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
    quota[key] = `${value}${key.startsWith('cpu') ? 'm' : 'Mi'}`;
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
  if (status === 'succeeded') return status;
  if (['inprogress', 'running', 'accepted', 'creating', 'updating'].includes(status)) return status;
  throw operationError(`Managed namespace operation ${raw}`, response);
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
  base: string
): { url: string; operation: boolean } | undefined {
  const asyncUrl = response.headers.get('azure-asyncoperation');
  const location = asyncUrl ?? response.headers.get('location');
  if (!location) return undefined;
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    throw operationError('Invalid operation URL', response);
  }
  if (next.origin !== ARM_ENDPOINT || next.username || next.password) {
    throw operationError('Refusing untrusted managed namespace operation URL', response);
  }
  return { url: next.href, operation: Boolean(asyncUrl) };
}

function delay(response: AzResponse<unknown>, signal: AbortSignal): Promise<void> {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  const milliseconds =
    header === null
      ? NaN
      : Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - Date.now();
  const ms = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 1000;
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
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
    const { url, tenantId } = await resourceContext({ ...options, signal });
    const initial = await request(url, tenantId, signal);
    const current = validateResource(initial.data);
    const etag = initial.headers.get('etag') ?? current.eTag;
    let response = await request(url, tenantId, signal, {
      method: 'PUT',
      body: updateBody(current, options),
      ...(etag ? { headers: { 'If-Match': etag } } : {}),
    });
    if (options.noWait) return response.data ?? {};
    if (![200, 201, 202].includes(response.status)) {
      throw operationError('Unexpected managed namespace PUT response', response);
    }
    let next = continuation(response, url);
    const putState =
      object(response.data) && object(response.data.properties)
        ? response.data.properties.provisioningState
        : undefined;
    let pending = response.status === 202 || Boolean(next);
    if (putState !== undefined)
      pending = state(response.data, false, response) !== 'succeeded' || pending;
    next ??= { url, operation: false };
    while (pending) {
      await delay(response, signal);
      response = await request(next.url, tenantId, signal);
      // Location polling may return an operation status or a resource body.
      const operation = next.operation || (object(response.data) && 'status' in response.data);
      pending =
        !operation && response.status === 202 && response.data === undefined
          ? true
          : state(response.data, operation, response) !== 'succeeded';
      if (pending) next = continuation(response, next.url) ?? next;
    }
    const final = await request(url, tenantId, signal);
    const result = validateResource(final.data);
    if (state(result, false, final) !== 'succeeded') {
      throw operationError('Final managed namespace GET did not confirm success', final);
    }
    return result;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
