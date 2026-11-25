// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { isValidGuid } from '../azure/az-cli-core';
import { AzureRequestError } from '../azure/az-http';

const SCOPES = new Set([
  'https://management.azure.com/.default',
  'https://management.core.windows.net/.default',
  'https://management.core.windows.net//.default',
  'https://graph.microsoft.com/.default',
]);

/** Node live tests need policy storage without replacing Node's native fetch/AbortSignal. */
export function createAzureAuthLiveStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** Allows only cached authentication and public-cloud metadata; never prompts or changes accounts. */
export function runReadOnlyAzureAuthCommand(executable: string, args: string[]) {
  const accountRead =
    args[0] === 'account' &&
    args[1] === 'show' &&
    ((args.length === 4 && args[2] === '-o' && args[3] === 'json') ||
      (args.length === 6 &&
        args[2] === '--subscription' &&
        isValidGuid(args[3]) &&
        args[4] === '-o' &&
        args[5] === 'json'));
  const cloudRead =
    args[0] === 'cloud' &&
    args[1] === 'show' &&
    ((args.length === 4 && args[2] === '--output' && args[3] === 'json') ||
      (args.length === 6 &&
        args[2] === '--name' &&
        args[3] === 'AzureCloud' &&
        args[4] === '--output' &&
        args[5] === 'json'));
  const tokenRead =
    args.length === 8 &&
    args[0] === 'account' &&
    args[1] === 'get-access-token' &&
    args[2] === '--scope' &&
    SCOPES.has(args[3]) &&
    args[4] === '-o' &&
    args[5] === 'json' &&
    args[6] === '--subscription' &&
    isValidGuid(args[7]);
  if (
    !['az', 'az.cmd'].includes(basename(executable).toLowerCase()) ||
    !(accountRead || cloudRead || tokenRead)
  ) {
    throw new Error(
      'Live authentication tests allow only read-only account, cloud and token commands'
    );
  }
  const child = spawn(executable, args, {
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

/** Keeps tokens, OAuth challenges, account identifiers and Azure response bodies out of reports. */
export async function readLiveAzure<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const status = error instanceof AzureRequestError ? error.status : undefined;
    throw new Error(
      `Live Azure read failed${status ? ` (HTTP ${status})` : ''}. ` +
        'Check permissions and renew cached Azure credentials outside the test runner if required.'
    );
  }
}

/** ARM may return the owning tenant for a subscription delegated through Lighthouse. */
export function validateLiveAzureSubscription(value: unknown, subscriptionId: string): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('subscriptionId' in value) ||
    typeof value.subscriptionId !== 'string' ||
    !isValidGuid(value.subscriptionId) ||
    value.subscriptionId.toLowerCase() !== subscriptionId.toLowerCase() ||
    !('tenantId' in value) ||
    typeof value.tenantId !== 'string' ||
    !isValidGuid(value.tenantId)
  ) {
    throw new Error('Live ARM subscription response has invalid subscription or tenant metadata');
  }
}
