// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runCommand } from '@kinvolk/headlamp-plugin/lib';
import { makePromiseQueue } from './promiseQueue';

declare const pluginRunCommand: typeof runCommand;

const AZURE_API_TIMEOUT_MS = 5_000;

/** Spawn azure-api.js, buffer its output, enforce a timeout, and parse the JSON result */
export function runJsonCommand(
  runCommand: typeof pluginRunCommand,
  args: string[],
  timeout: number
): Promise<unknown> {
  return new Promise((res, rej) => {
    const command = runCommand('scriptjs', ['az-auth/azure-api.js', ...args], {});

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fn();
    };

    const timeoutId = setTimeout(
      () => finish(() => rej(new Error(`azure-api ${args[0]} timed out after ${timeout}ms`))),
      timeout
    );

    command.stdout.on('data', data => {
      stdout += data;
    });
    command.stderr.on('data', data => {
      stderr += data;
    });
    command.on('exit', code => {
      finish(() => {
        if (code !== 0) {
          rej(new Error(stderr.trim() || `azure-api ${args[0]} exited with code ${code}`));
          return;
        }
        try {
          res(JSON.parse(stdout));
        } catch {
          rej(new Error(`azure-api ${args[0]} returned invalid JSON: ${stdout.slice(0, 200)}`));
        }
      });
    });
  });
}

type TokenResult = { token: string; expiresOnTimestamp?: number };

type LoginStatus = { isLoggedIn: boolean; username?: string; tenantId?: string };

/** Refresh a cached token this many ms before it actually expires */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60_000;

// A token with no expiry timestamp is treated as not cacheable and always refetched.
export const isTokenValid = (result?: TokenResult): boolean =>
  !!result &&
  typeof result.expiresOnTimestamp === 'number' &&
  result.expiresOnTimestamp - TOKEN_EXPIRY_MARGIN_MS > Date.now();

/** Build the Azure auth API */
export function makeAzureAuth(runCommand: typeof pluginRunCommand) {
  // To prevent many processes being spawned all invokations are placed in a simple promise queue
  const apiQueue = makePromiseQueue();
  const runAzureApi = (args: string[], timeout = AZURE_API_TIMEOUT_MS) =>
    apiQueue.enqueuePromise(() => runJsonCommand(runCommand, args, timeout));

  const tokenCache = new Map<string, Promise<TokenResult>>();
  const fetchToken = (cacheKey: string, scopeArray: string[]): Promise<TokenResult> => {
    const tokenPromise = runAzureApi(['get-token', ...scopeArray]) as Promise<TokenResult>;
    tokenCache.set(cacheKey, tokenPromise);
    tokenPromise.catch(() => {
      tokenCache.delete(cacheKey);
    });
    return tokenPromise;
  };

  /** Azure SDK compatible token credential */
  const azureCredential = {
    async getToken(scopes: string | string[]): Promise<TokenResult> {
      const scopeArray = typeof scopes === 'string' ? [scopes] : scopes;
      const cacheKey = scopeArray.join('|');

      const cached = tokenCache.get(cacheKey);
      if (cached) {
        const result = await cached;
        if (isTokenValid(result)) {
          return result;
        }
        tokenCache.delete(cacheKey);
      }

      return fetchToken(cacheKey, scopeArray);
    },
  };

  let loginStatusCache: Promise<LoginStatus> | undefined;
  const getLoginStatus = async (): Promise<LoginStatus> => {
    if (loginStatusCache) {
      return loginStatusCache;
    }

    const responsePromise = runAzureApi(['user-info']) as Promise<LoginStatus>;
    loginStatusCache = responsePromise;
    responsePromise.catch(() => {
      loginStatusCache = undefined;
    });

    return responsePromise;
  };

  /** Clear all cache and initiate logout */
  const logout = () => {
    loginStatusCache = undefined;
    tokenCache.clear();
    return runAzureApi(['logout']);
  };

  const initiateLogin = async () => {
    const result = await runAzureApi(['login'], 60_000);
    // Clear any existing login status cache
    loginStatusCache = undefined;
    return result;
  };

  return { azureCredential, getLoginStatus, initiateLogin, logout };
}

if (typeof pluginRunCommand !== 'undefined') {
  Object.defineProperty(window, 'azureAuth', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: makeAzureAuth(pluginRunCommand),
  });
}
