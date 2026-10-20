// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { TokenResponse } from './github-auth';
import { GitHubOAuthError, postGitHubOAuth } from './github-oauth-transport';

const CLIENT_ID =
  typeof process !== 'undefined' && process.env?.AKS_DESKTOP_GITHUB_CLIENT_ID
    ? process.env.AKS_DESKTOP_GITHUB_CLIENT_ID
    : 'Iv23liWWbvrfIrA6WWj5';
const VERIFICATION_URI = 'https://github.com/login/device';
const MAX_AUTHORIZATION_MS = 15 * 60 * 1000;

/** Internal protocol state. Only the public code/URI/expiry belong in an auth UI snapshot. */
export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubOAuthError('invalid_response');
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function seconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    value > 0 &&
    Number.isSafeInteger(value) &&
    Number.isSafeInteger(value * 1000)
  );
}

function checkActive(signal: AbortSignal, deadline?: number): void {
  if (signal.aborted) throw new GitHubOAuthError('cancelled');
  if (deadline !== undefined && Date.now() >= deadline) throw new GitHubOAuthError('expired_token');
}

function safeError(error: unknown): GitHubOAuthError {
  return error instanceof GitHubOAuthError
    ? error
    : new GitHubOAuthError('network_error', { retryable: true });
}

/** Chunk very long Retry-After values so browser timer overflow cannot cause an early retry. */
async function wait(ms: number, signal: AbortSignal): Promise<void> {
  checkActive(signal);
  let remaining = ms;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 2147483647);
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        reject(new GitHubOAuthError('cancelled'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, chunk);
      signal.addEventListener('abort', cancel, { once: true });
    });
    remaining -= chunk;
    checkActive(signal);
  }
}

function parseTokens(value: unknown): TokenResponse {
  const data = object(value);
  if (
    !nonempty(data.access_token) ||
    !nonempty(data.refresh_token) ||
    !seconds(data.expires_in) ||
    data.token_type !== 'bearer' ||
    !Number.isFinite(new Date(Date.now() + data.expires_in * 1000).getTime())
  ) {
    throw new GitHubOAuthError('invalid_response');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/** Request timeout is owned by the transport; this additional timer enforces grant expiry. */
async function pollRequest(
  form: URLSearchParams,
  signal: AbortSignal,
  deadline: number
): Promise<unknown> {
  checkActive(signal, deadline);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, Math.max(0, deadline - Date.now()));
  try {
    const data = await postGitHubOAuth('token', form, controller.signal);
    checkActive(signal, deadline);
    return data;
  } catch (error) {
    checkActive(signal, deadline);
    throw safeError(error);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

export async function initiateDeviceFlow(signal: AbortSignal): Promise<DeviceAuthorization> {
  checkActive(signal);
  const issuedAt = Date.now();
  let response: unknown;
  try {
    // This requests expiring tokens, not additional GitHub App permissions.
    response = await postGitHubOAuth(
      'device',
      new URLSearchParams({ client_id: CLIENT_ID, scope: 'offline_access' }),
      signal
    );
  } catch (error) {
    throw safeError(error);
  }
  checkActive(signal);
  const data = object(response);
  if (
    !nonempty(data.device_code) ||
    !nonempty(data.user_code) ||
    data.verification_uri !== VERIFICATION_URI ||
    !seconds(data.expires_in) ||
    !seconds(data.interval)
  ) {
    throw new GitHubOAuthError('invalid_response');
  }
  const expiresAt = issuedAt + Math.min(data.expires_in * 1000, MAX_AUTHORIZATION_MS);
  checkActive(signal, expiresAt);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: VERIFICATION_URI,
    expiresAt,
    intervalMs: data.interval * 1000,
  };
}

export async function waitForDeviceTokens(
  auth: DeviceAuthorization,
  signal: AbortSignal
): Promise<TokenResponse> {
  let interval = auth.intervalMs;
  let backoff = interval;
  let delay = interval;
  const form = new URLSearchParams({
    client_id: CLIENT_ID,
    device_code: auth.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  while (true) {
    checkActive(signal, auth.expiresAt);
    await wait(Math.min(delay, auth.expiresAt - Date.now()), signal);
    checkActive(signal, auth.expiresAt);
    try {
      const response = await pollRequest(form, signal, auth.expiresAt);
      return parseTokens(response);
    } catch (error) {
      checkActive(signal, auth.expiresAt);
      const failure = safeError(error);
      if (failure.code === 'authorization_pending') {
        backoff = interval;
        delay = Math.max(interval, failure.retryAfterMs);
      } else if (failure.code === 'slow_down') {
        interval = Math.max(interval + 5000, failure.intervalMs ?? 0);
        backoff = interval;
        delay = Math.max(interval, failure.retryAfterMs);
      } else if (failure.retryable) {
        backoff = Math.max(interval, Math.min(backoff * 2, 60000));
        delay = Math.max(backoff, failure.retryAfterMs);
      } else {
        throw failure;
      }
    }
  }
}

export async function refreshDeviceToken(
  refreshToken: string,
  signal: AbortSignal
): Promise<TokenResponse> {
  if (!nonempty(refreshToken)) throw new GitHubOAuthError('bad_refresh_token');
  const form = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    checkActive(signal);
    try {
      const data = await postGitHubOAuth('token', form, signal);
      checkActive(signal);
      return parseTokens(data);
    } catch (error) {
      checkActive(signal);
      const failure = safeError(error);
      if (!failure.retryable || attempt === 2) throw failure;
      await wait(Math.max(1000 * 2 ** attempt, failure.retryAfterMs), signal);
    }
  }
  throw new GitHubOAuthError('network_error', { retryable: true });
}
