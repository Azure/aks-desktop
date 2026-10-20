// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getHeadlampAPIHeaders } from '@kinvolk/headlamp-plugin/lib';

const ENDPOINTS = {
  device: 'https://github.com/login/device/code',
  token: 'https://github.com/login/oauth/access_token',
} as const;

const OAUTH_CODES = [
  'authorization_pending',
  'slow_down',
  'access_denied',
  'expired_token',
  'device_flow_disabled',
  'incorrect_client_credentials',
  'bad_verification_code',
  'bad_refresh_token',
  'invalid_grant',
  'invalid_client',
  'invalid_request',
  'unsupported_grant_type',
  'temporarily_unavailable',
] as const;
type OAuthCode = (typeof OAUTH_CODES)[number];
export type GitHubOAuthErrorCode =
  | OAuthCode
  | 'oauth_error'
  | 'http_error'
  | 'network_error'
  | 'invalid_response'
  | 'request_timeout'
  | 'cancelled';
const knownCodes = new Set<string>(OAUTH_CODES);

/** Contains only controlled diagnostic fields, never request/response data or causes. */
export class GitHubOAuthError extends Error {
  readonly code: GitHubOAuthErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs: number;
  readonly intervalMs?: number;

  constructor(
    code: GitHubOAuthErrorCode,
    options: {
      status?: number;
      retryable?: boolean;
      retryAfterMs?: number;
      intervalMs?: number;
    } = {}
  ) {
    super(
      code === 'device_flow_disabled'
        ? 'GitHub device login is disabled. Ask the app owner to enable device flow for this GitHub App.'
        : code === 'cancelled'
        ? 'GitHub authentication was cancelled.'
        : code === 'request_timeout'
        ? 'GitHub authentication request timed out.'
        : 'GitHub authentication could not be completed. Please connect GitHub again.'
    );
    this.name = 'GitHubOAuthError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? 0;
    this.intervalMs = options.intervalMs;
  }
}

function proxyEndpoint(): string {
  const host =
    typeof window === 'undefined'
      ? undefined
      : (window as Window & {
          process?: { type?: string };
          headlampBackendPort?: number;
          headlampBaseUrl?: string;
          ddClient?: unknown;
        });
  let origin = host?.location.origin ?? 'http://localhost:4466';
  if (
    host?.process?.type === 'renderer' ||
    (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'))
  ) {
    origin = `http://localhost:${host?.headlampBackendPort || 4466}`;
  } else if (host?.ddClient !== undefined) {
    origin = 'http://localhost:64446';
  }
  const raw = host?.headlampBaseUrl?.replace(/\/+$/, '') ?? '';
  const prefix = raw && raw !== '.' ? (raw.startsWith('/') ? raw : `/${raw}`) : '';
  return `${origin}${prefix}/externalproxy`;
}

function retryAfterMilliseconds(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

/** Raw fetch deliberately avoids ApiProxy's request-body/debug logging. */
export async function postGitHubOAuth(
  endpoint: keyof typeof ENDPOINTS,
  form: URLSearchParams,
  signal: AbortSignal
): Promise<unknown> {
  const target =
    endpoint === 'device' ? ENDPOINTS.device : endpoint === 'token' ? ENDPOINTS.token : null;
  if (!target) throw new GitHubOAuthError('invalid_request');
  if (signal.aborted) throw new GitHubOAuthError('cancelled');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 10000);
  try {
    const response = await fetch(proxyEndpoint(), {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        ...getHeadlampAPIHeaders(),
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Forward-To': target,
        'X-Headlamp-Proxy-Redirect': 'error',
      },
      body: form.toString(),
      signal: controller.signal,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      /* Never propagate a raw parse error/body. */
    }
    if (signal.aborted) throw new GitHubOAuthError('cancelled');
    if (controller.signal.aborted)
      throw new GitHubOAuthError('request_timeout', { retryable: true });
    const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    if (!response.ok || typeof record?.error === 'string') {
      const rawCode = record?.error;
      const transientStatus = response.status === 429 || response.status >= 500;
      const code = transientStatus
        ? 'http_error'
        : typeof rawCode === 'string' && knownCodes.has(rawCode)
        ? (rawCode as OAuthCode)
        : response.ok
        ? 'oauth_error'
        : 'http_error';
      const interval = typeof record?.interval === 'number' ? record.interval * 1000 : NaN;
      throw new GitHubOAuthError(code, {
        status: response.status,
        retryable: transientStatus || code === 'temporarily_unavailable',
        retryAfterMs: retryAfterMilliseconds(response.headers.get('Retry-After')),
        intervalMs: Number.isFinite(interval) && interval > 0 ? interval : undefined,
      });
    }
    if (data === undefined) throw new GitHubOAuthError('invalid_response');
    return data;
  } catch (error) {
    if (signal.aborted) throw new GitHubOAuthError('cancelled');
    if (controller.signal.aborted)
      throw new GitHubOAuthError('request_timeout', { retryable: true });
    if (error instanceof GitHubOAuthError) throw error;
    throw new GitHubOAuthError('network_error', { retryable: true });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}
