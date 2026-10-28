// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Azure CLI-backed access tokens for Azure REST calls. */

import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/identity';
import { debugLog, needsRelogin, runCommandAsync } from './az-cli-core';

export const ARM_SCOPE = 'https://management.azure.com/.default';

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

// Tenant ID or domain name, with no leading `-`.
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i;

export class AzTokenError extends Error {
  readonly needsRelogin: boolean;

  constructor(message: string, relogin = false) {
    super(message);
    this.name = 'AzTokenError';
    this.needsRelogin = relogin;
  }
}

export interface AzCliCredential extends TokenCredential {
  getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken>;
  /** Clears all cached tokens. */
  clearCache(): void;
}

async function requestCliToken(scope: string, tenantId?: string): Promise<AccessToken> {
  const args = ['account', 'get-access-token', '--scope', scope, '-o', 'json'];
  if (tenantId) args.push('--tenant', tenantId);
  debugLog('[AZ-TOKEN] Requesting token for scope:', scope, 'tenant:', tenantId ?? '(default)');

  const { stdout, stderr } = await runCommandAsync('az', args);
  const output = stdout.trim();
  if (!output) {
    const message = stderr.trim() || 'Azure CLI returned no access token';
    throw new AzTokenError(message, needsRelogin(message));
  }

  let parsed: { accessToken?: unknown; expires_on?: unknown };
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
  return { token: parsed.accessToken, expiresOnTimestamp: expiresOnSeconds * 1000 };
}

/**
 * Runs `start` unless `signal` is already aborted, and rejects as soon as `signal` aborts.
 * The started promise itself keeps running.
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

/** Creates a credential that gets tokens from `requestCliToken`, cached per tenant and scope. */
export function createAzCliCredential(): AzCliCredential {
  const cache = new Map<string, Promise<AccessToken>>();

  const load = (key: string, scope: string, tenantId?: string) => {
    const promise = requestCliToken(scope, tenantId);
    cache.set(key, promise);
    promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
    return promise;
  };

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
      return withAbort(() => resolveToken(scopeList[0], tenantId), options?.abortSignal);
    },
    clearCache() {
      cache.clear();
    },
  };
}

/** Default credential used by `az-http`. */
export const azCliCredential = createAzCliCredential();

// Clears cache when user logs in or logs out inside the app.
if (typeof window !== 'undefined') {
  window.addEventListener('azure-auth-update', () => azCliCredential.clearCache());
}

/** Gets an access token for the given scope (ARM by default). */
export function getAzToken(scope = ARM_SCOPE, options?: GetTokenOptions): Promise<AccessToken> {
  return azCliCredential.getToken(scope, options);
}
