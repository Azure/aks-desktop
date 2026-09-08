// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runCommand } from '@kinvolk/headlamp-plugin/lib';

declare const pluginRunCommand: typeof runCommand;

const AZURE_API_TIMEOUT_MS = 5_000;
const LOGIN_TIMEOUT_MS = 60_000;

type QueueTask<T> = () => Promise<T>;

/** Serializes access to the bundled Azure authentication process. */
const createPromiseQueue = () => {
  let tail = Promise.resolve<unknown>(undefined);

  return <T>(task: QueueTask<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
};

const enqueueApiCall = createPromiseQueue();

// Tracks in-flight (queued or running) requests by their args signature,
// so identical calls share the same result instead of being enqueued again.
const pendingApiCalls = new Map<string, Promise<unknown>>();

function azureApi<T>(args: string[], timeout = AZURE_API_TIMEOUT_MS): Promise<T> {
  const key = JSON.stringify(args);

  const existing = pendingApiCalls.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = enqueueApiCall(
    () =>
      new Promise<T>((resolve, reject) => {
        const command = pluginRunCommand('scriptjs', ['azure-aks/azure-api.js', ...args], {});
        let stdout = '';
        let stderr = '';
        const timer = window.setTimeout(
          () => reject(new Error('Azure API request timed out')),
          timeout
        );

        command.stdout.on('data', data => {
          stdout += String(data);
        });
        command.stderr.on('data', data => {
          stderr += String(data);
        });
        command.on('exit', code => {
          window.clearTimeout(timer);
          if (code) {
            reject(new Error(stderr.trim() || `Azure API process exited with code ${code}`));
            return;
          }

          try {
            resolve(JSON.parse(stdout.slice(stdout.indexOf('{'))) as T);
          } catch (error) {
            reject(error);
          }
        });
      })
  ).finally(() => {
    pendingApiCalls.delete(key);
  });

  pendingApiCalls.set(key, promise);
  return promise;
}

const tokenCache = new Map<string, Promise<AzureToken>>();

export interface AzureToken {
  token: string;
  expiresOnTimestamp: number;
}

export const azureCredential = {
  getToken(scopes: string | string[]): Promise<AzureToken> {
    const scopeArray = typeof scopes === 'string' ? [scopes] : scopes;
    const cacheKey = scopeArray.join('|');
    const cachedToken = tokenCache.get(cacheKey);
    if (cachedToken) return cachedToken;

    const tokenPromise = azureApi<AzureToken>(['get-token', ...scopeArray]);
    tokenCache.set(cacheKey, tokenPromise);
    tokenPromise.catch(() => tokenCache.delete(cacheKey));
    return tokenPromise;
  },
};

export async function getLoginStatus(): Promise<any> {
  const cachedUser = sessionStorage.getItem('azure-user-info');
  if (cachedUser) return JSON.parse(cachedUser);

  const response = await azureApi<any>(['user-info']);
  if (response) sessionStorage.setItem('azure-user-info', JSON.stringify(response));
  return response;
}

export async function initiateLogin(): Promise<any> {
  const response = await azureApi<any>(['login'], LOGIN_TIMEOUT_MS);
  sessionStorage.removeItem('azure-user-info');
  tokenCache.clear();
  return response;
}

export async function logout(): Promise<any> {
  const response = await azureApi<any>(['logout']);
  sessionStorage.removeItem('azure-user-info');
  tokenCache.clear();
  return response;
}
