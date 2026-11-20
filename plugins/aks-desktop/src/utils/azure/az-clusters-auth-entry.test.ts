// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), runCommandAsync: vi.fn() }));

// Only the CLI and network boundaries are doubles; auth, cloud, token and HTTP modules are real.
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.runCommandAsync }));
vi.mock('./az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI.',
}));

import { getLoginStatus } from './az-auth';
import { clearAzureCloudCache } from './az-cloud';
import { getClusterResourceIdAndGroup } from './az-clusters';
import { clearAzureTokenCaches } from './az-token';

type CliResult = { stdout: string; stderr: string };

const SUBSCRIPTION = '00000000-0000-4000-8000-00000000000a';
const CLUSTER_ID = `/subscriptions/${SUBSCRIPTION}/resourceGroups/sample-rg/providers/Microsoft.ContainerService/managedClusters/sample-cluster`;
const FOUND = { resourceId: CLUSTER_ID, resourceGroup: 'sample-rg' };
const TOKEN_COMMAND = `account get-access-token --scope https://management.core.windows.net//.default -o json --subscription ${SUBSCRIPTION}`;
const SIGNED_OUT: CliResult = { stdout: '', stderr: "Please run 'az login' to setup account." };

/** Synthetic `az account show` output; the default subscription is never the requested one. */
const account = (name: string): CliResult => ({
  stdout: JSON.stringify({
    id: `00000000-0000-4000-8000-0000000000d${name}`,
    tenantId: `00000000-0000-4000-8000-0000000000e${name}`,
    user: { name: `user-${name}@example.invalid` },
    environmentName: 'AzureCloud',
  }),
  stderr: '',
});

let events: string[];
let cli: { accountShow: () => CliResult | Promise<CliResult>; token: string };
let clusters: unknown[];
const count = (event: string) => events.filter(recorded => recorded === event).length;

beforeEach(() => {
  clearAzureTokenCaches();
  clearAzureCloudCache();
  events = [];
  cli = { accountShow: () => account('a'), token: 'synthetic-token-a' };
  clusters = [{ name: 'sample-cluster', id: CLUSTER_ID }];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.runCommandAsync.mockImplementation(async (_command: string, args: string[]) => {
    const command = args.join(' ');
    events.push(command);
    if (command === 'account show -o json') return cli.accountShow();
    if (command === 'cloud show --output json') {
      const endpoints = {
        resourceManager: 'https://management.azure.com/',
        activeDirectoryResourceId: 'https://management.core.windows.net/',
      };
      return { stdout: JSON.stringify({ name: 'AzureCloud', endpoints }), stderr: '' };
    }
    if (command === TOKEN_COMMAND) {
      const expires_on = Math.floor(Date.now() / 1000) + 3600;
      return { stdout: JSON.stringify({ accessToken: cli.token, expires_on }), stderr: '' };
    }
    throw new Error(`Unexpected CLI command: az ${command}`);
  });
  mocks.fetch.mockImplementation(async (_url: URL, init: RequestInit) => {
    events.push(`fetch ${(init.headers as Record<string, string>).Authorization}`);
    return new Response(JSON.stringify({ value: clusters }), { status: 200 });
  });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Observes account A, then leaves its token for the subscription in the real credential cache. */
async function warmAccountA() {
  await getLoginStatus();
  events = [];
  await expect(getClusterResourceIdAndGroup('sample-cluster', SUBSCRIPTION)).resolves.toEqual(
    FOUND
  );
  expect(count(TOKEN_COMMAND)).toBe(1);
  expect(count('fetch Bearer synthetic-token-a')).toBe(1);
}

test('waits for fresh account observation before reusing a warm token', async () => {
  await warmAccountA();
  let release!: (result: CliResult) => void;
  cli.accountShow = () => new Promise<CliResult>(resolve => (release = resolve));

  const lookup = getClusterResourceIdAndGroup('sample-cluster', SUBSCRIPTION);
  lookup.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(count('account show -o json')).toBe(2);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(count(TOKEN_COMMAND)).toBe(1);

  release(SIGNED_OUT);
  await expect(lookup).rejects.toThrow(
    'Authentication required. Please log in to Azure CLI: az login'
  );
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(count(TOKEN_COMMAND)).toBe(1);
});

test('rejects an invalid subscription before any observation or I/O', async () => {
  await expect(getClusterResourceIdAndGroup('sample-cluster', 'invalid')).rejects.toThrow(
    'Invalid subscription ID format'
  );
  expect(events).toEqual([]);
});

test('returns empty-name absence without validation or I/O', async () => {
  await expect(getClusterResourceIdAndGroup('', 'invalid')).resolves.toBeNull();
  expect(events).toEqual([]);
});

test('uses a fresh replacement account token for an explicit subscription', async () => {
  await warmAccountA();
  events = [];
  cli = { accountShow: () => account('b'), token: 'synthetic-token-b' };

  await expect(getClusterResourceIdAndGroup('sample-cluster', SUBSCRIPTION)).resolves.toEqual(
    FOUND
  );
  // The exact command list also proves no `account set` or `--tenant` selector was used.
  expect(events).toEqual([
    'account show -o json',
    'cloud show --output json',
    TOKEN_COMMAND,
    'fetch Bearer synthetic-token-b',
  ]);
});

test('keeps ordinary observation failure actionable, not null', async () => {
  await warmAccountA();
  events = [];
  cli.accountShow = () => ({
    stdout: '',
    stderr: 'ERROR: account service temporarily unavailable',
  });

  const lookup = getClusterResourceIdAndGroup('sample-cluster', SUBSCRIPTION);
  await expect(lookup).rejects.toThrow('ERROR: account service temporarily unavailable');
  await expect(lookup).rejects.not.toThrow('Authentication required');
  expect(events).toEqual(['account show -o json']);
});

test('keeps successful absence after an available observation', async () => {
  clusters = [];
  await expect(getClusterResourceIdAndGroup('sample-cluster', SUBSCRIPTION)).resolves.toBeNull();
  clusters = [{ name: 'sample-cluster' }];
  await expect(getClusterResourceIdAndGroup('sample-cluster', SUBSCRIPTION)).resolves.toBeNull();

  expect(events).toEqual([
    'account show -o json',
    'cloud show --output json',
    TOKEN_COMMAND,
    'fetch Bearer synthetic-token-a',
    'account show -o json',
    'fetch Bearer synthetic-token-a',
  ]);
});
