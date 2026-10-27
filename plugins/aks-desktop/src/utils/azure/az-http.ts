// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Authenticated HTTP requests to Azure REST APIs. */

import type { TokenCredential } from '@azure/identity';
import { debugLog, getErrorMessage } from './az-cli-core';
import { azCliCredential, withAbort } from './az-token';

/** Default ARM origin; callers select sovereign/custom clouds with endpoint/scope. */
export const ARM_ENDPOINT = 'https://management.azure.com';

const DEFAULT_TIMEOUT_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60 * 1000; // 1 minute
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
// HTTP methods that are safe to retry.
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);

/** Supported HTTP methods; only GET/HEAD receive automatic transport retries. */
export type AzHttpMethod = 'GET' | 'HEAD' | 'PUT' | 'PATCH' | 'POST' | 'DELETE';

/** One authenticated request, including its whole retry/acquisition timeout budget. */
export interface AzRequestOptions {
  /** Absolute HTTPS URL, or a path relative to `endpoint`. */
  url: string;
  /** HTTP method; defaults to GET. Writes are never automatically retried. */
  method?: AzHttpMethod;
  /** Value of the `api-version` query parameter. */
  apiVersion?: string;
  /** JSON request body. */
  body?: unknown;
  /** Base URL for relative paths. Defaults to `ARM_ENDPOINT`. */
  endpoint?: string;
  /** Token scope. Defaults to `<request URL origin>/.default`. */
  scope?: string;
  /** Tenant the token is issued for. */
  tenantId?: string;
  /** Token source. Defaults to `azCliCredential`. */
  credential?: TokenCredential;
  /** Caller cancellation, combined with timeoutMs for authentication, fetch and backoff. */
  signal?: AbortSignal;
  /** Request timeout. Defaults to 1 minute. */
  timeoutMs?: number;
  /** Retry limit for GET and HEAD. Defaults to 3. */
  maxRetries?: number;
}

/** HTTP/transport/response-validation failure with optional Azure correlation metadata. */
export class AzureRequestError extends Error {
  /** HTTP status when a response was received. */
  readonly status?: number;
  /** ARM/Graph/registry/provider error code, if supplied by the service. */
  readonly code?: string;
  /** Service request identifier useful for support diagnostics. */
  readonly requestId?: string;
  /** Azure correlation identifier, when present in response headers. */
  readonly correlationId?: string;

  /**
   * @param message - Service or client validation diagnostic.
   * @param details - Optional HTTP status, service code and correlation identifiers.
   */
  constructor(
    message: string,
    details: { status?: number; code?: string; requestId?: string; correlationId?: string } = {}
  ) {
    super(message);
    this.name = 'AzureRequestError';
    Object.assign(this, details);
  }
}

/** The status, headers, and parsed body of a successful Azure REST response. */
export interface AzResponse<T> {
  /** The HTTP status code. */
  status: number;
  /** The response headers, such as `Location`. */
  headers: Headers;
  /** The parsed JSON body, or `undefined` when the response has no body. */
  data: T | undefined;
}

/**
 * Resolves the request URL against `options.endpoint`, which defaults to `ARM_ENDPOINT`.
 * It also adds the `api-version` query parameter when the URL does not already have one.
 * @param options - The request options. Only `url`, `endpoint`, and `apiVersion` are used.
 * @returns The absolute HTTPS URL for the request.
 * @throws {AzureRequestError} Thrown when the URL is invalid or does not use HTTPS.
 */
function resolveUrl(options: AzRequestOptions): URL {
  const endpoint = options.endpoint ?? ARM_ENDPOINT;
  let url: URL;
  try {
    url = new URL(options.url, endpoint);
  } catch {
    throw new AzureRequestError(`Invalid Azure request URL: ${options.url}`);
  }
  if (url.protocol !== 'https:') {
    throw new AzureRequestError(`Azure requests must use HTTPS: ${url.origin}`);
  }
  if (options.apiVersion && !url.searchParams.has('api-version')) {
    url.searchParams.set('api-version', options.apiVersion);
  }
  return url;
}

/**
 * Gets the error details that are available from any response, even when its body cannot be read.
 * The request ID comes from the `x-ms-request-id` header, or from `request-id` if that header
 * is missing.
 * @param response - The HTTP response to read the status and headers from.
 * @returns The HTTP status, request ID, and correlation ID of the response. The IDs are
 * `undefined` when their headers are missing.
 */
function responseDetails(response: Response) {
  const { headers } = response;
  return {
    status: response.status,
    requestId: headers.get('x-ms-request-id') ?? headers.get('request-id') ?? undefined,
    correlationId: headers.get('x-ms-correlation-request-id') ?? undefined,
  };
}

/**
 * Builds an `AzureRequestError` from a failed response's body and headers.
 * @param response - The failed HTTP response. Its status and request ID headers are added to
 * the error.
 * @param text - The response body. When it is JSON, the error code and message are read from it.
 * @returns An error that includes the HTTP status and, when available, the error code,
 * message, and request ID.
 */
function errorFromResponse(response: Response, text: string): AzureRequestError {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body = JSON.parse(text);
    // Error body shapes: ARM and Graph use `{ error: { code, message } }`,
    // container registries use `{ errors: [{ code, message }] }`.
    const err = body?.error ?? body?.errors?.[0] ?? body;
    code = typeof err?.code === 'string' ? err.code : undefined;
    message = typeof err?.message === 'string' ? err.message : undefined;
  } catch {
    // Non-JSON error body.
  }
  const details = responseDetails(response);
  const summary = [code, message ?? (response.statusText || 'Request failed')]
    .filter(Boolean)
    .join(': ');
  const suffix = details.requestId ? `, request ID ${details.requestId}` : '';
  return new AzureRequestError(`${summary} (HTTP ${response.status}${suffix})`, {
    ...details,
    code,
  });
}

/**
 * Calculates how long to wait before the next retry. If the response has a `Retry-After`
 * header, its value is used. Otherwise, the delay starts at 1 second and doubles with each
 * attempt, up to `MAX_RETRY_DELAY_MS`.
 * @param response - The response that triggered the retry, or `undefined` if the request
 * failed with a network error.
 * @param attempt - The zero-based number of the attempt that just failed.
 * @returns The delay in milliseconds, which is never negative.
 */
function retryDelayMs(response: Response | undefined, attempt: number): number {
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(ms)) return Math.max(ms, 0);
  }
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

/**
 * @param ms - Delay before the next retry.
 * @param signal - Request-wide cancellation/deadline signal.
 * @returns After the delay, or rejects with the abort reason before then.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Creates a signal that aborts when the caller's `signal` aborts or after `timeoutMs`.
 * `dispose` stops the timer and removes the listener.
 * @param signal - Optional caller signal, including already-aborted signals.
 * @param timeoutMs - Total request/acquisition/retry budget in milliseconds.
 * @returns The linked signal and a disposer that must run on every completion path.
 */
function linkSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new AzureRequestError(`Azure request timed out after ${timeoutMs} ms`)),
    timeoutMs
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Sends authenticated HTTP with GET/HEAD-only retries and one timeout budget.
 * @typeParam T - Expected JSON response-body shape.
 * @param options - Destination, method/body, credential and retry/deadline controls.
 * @returns Status, headers and parsed data; data is undefined for empty/HEAD responses.
 * @throws {AzureRequestError} For URL, HTTP, transport or response-JSON failures.
 * Credential rejections and the caller/deadline abort reason also propagate.
 */
export async function azRequestRaw<T>(options: AzRequestOptions): Promise<AzResponse<T>> {
  const method = options.method ?? 'GET';
  const url = resolveUrl(options);
  const scope = options.scope ?? `${url.origin}/.default`;
  const credential = options.credential ?? azCliCredential;
  const maxRetries = RETRYABLE_METHODS.has(method) ? options.maxRetries ?? DEFAULT_MAX_RETRIES : 0;
  const linked = linkSignal(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    for (let attempt = 0; ; attempt++) {
      const accessToken = await withAbort(
        () =>
          credential.getToken(scope, { tenantId: options.tenantId, abortSignal: linked.signal }),
        linked.signal
      );
      if (!accessToken?.token) throw new AzureRequestError('No access token was returned');

      debugLog('[AZ-HTTP]', method, url.origin + url.pathname, `attempt ${attempt + 1}`);
      const headers: Record<string, string> = { Authorization: `Bearer ${accessToken.token}` };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';

      let response: Response | undefined;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: linked.signal,
        });
      } catch {
        if (linked.signal.aborted) throw linked.signal.reason;
        if (attempt >= maxRetries) {
          throw new AzureRequestError('Azure request failed before a response was received');
        }
      }

      if (response && !(RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries)) {
        let text = '';
        try {
          if (method !== 'HEAD') text = await response.text();
        } catch (error) {
          if (linked.signal.aborted) throw linked.signal.reason;
          throw new AzureRequestError(
            `Azure response could not be read: ${getErrorMessage(error)}`,
            responseDetails(response)
          );
        }
        if (!response.ok) throw errorFromResponse(response, text);
        if (!text.trim())
          return { status: response.status, headers: response.headers, data: undefined };
        try {
          return {
            status: response.status,
            headers: response.headers,
            data: JSON.parse(text) as T,
          };
        } catch {
          throw new AzureRequestError(
            `Malformed JSON response (HTTP ${response.status})`,
            responseDetails(response)
          );
        }
      }

      await response?.body?.cancel().catch(() => undefined);
      await sleep(retryDelayMs(response, attempt), linked.signal);
    }
  } finally {
    linked.dispose();
  }
}

/**
 * @typeParam T - Expected JSON response-body shape.
 * @param options - Same request/authentication/retry contract as azRequestRaw.
 * @returns Parsed JSON, or undefined for a successful response without a body.
 * @throws Failures from azRequestRaw, including credentials and cancellation.
 */
export async function azRequest<T>(options: AzRequestOptions): Promise<T | undefined> {
  return (await azRequestRaw<T>(options)).data;
}

/**
 * Collects ARM value items while following same-origin nextLink pages.
 * @typeParam T - Item shape inside each page's value array.
 * @param options - GET request/authentication options reused per page; timeoutMs is
 * per request, while a caller signal can impose one budget across the entire list.
 * @returns All items in service order, without partial success on a failed later page.
 * @throws For invalid value arrays, untrusted nextLink origins or propagated request failures.
 */
export async function azListAll<T>(
  options: Omit<AzRequestOptions, 'method' | 'body'>
): Promise<T[]> {
  const origin = resolveUrl(options).origin;
  const items: T[] = [];
  let next: AzRequestOptions | undefined = { ...options, method: 'GET' };

  while (next) {
    const page: { value?: T[]; nextLink?: string } | undefined = await azRequest(next);
    if (page?.value !== undefined && !Array.isArray(page.value)) {
      throw new AzureRequestError('Malformed list response: `value` is not an array');
    }
    items.push(...(page?.value ?? []));
    if (!page?.nextLink) break;
    // Relative nextLinks resolve against the page that returned them.
    const nextUrl = resolveUrl({ url: page.nextLink, endpoint: resolveUrl(next).href });
    if (nextUrl.origin !== origin) {
      throw new AzureRequestError(
        `Refusing to follow nextLink to untrusted host: ${nextUrl.origin}`
      );
    }
    // nextLink already carries api-version and any continuation token.
    next = { ...options, method: 'GET', url: nextUrl.href, apiVersion: undefined };
  }
  return items;
}
