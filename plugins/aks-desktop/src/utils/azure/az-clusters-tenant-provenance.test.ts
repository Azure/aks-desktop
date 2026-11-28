// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), runCommandAsync: vi.fn() }));

// Only the CLI and network boundaries are doubles; subscription discovery, the cluster
// adapter, cloud, token and HTTP modules are real.
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.runCommandAsync }));
vi.mock('./az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI.',
}));

import { clearAzureCloudCache } from './az-cloud';
import { getClusters } from './az-clusters';
import { getSubscriptions } from './az-subscriptions';
import { clearAzureTokenCaches } from './az-token';

const SUBSCRIPTION = '00000000-0000-4000-8000-00000000000a';
// Tenant A discovers the subscription through delegation; the CLI profile maps it to tenant B.
const TENANT_A = '00000000-0000-4000-8000-0000000000aa';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
// ARM's home tenant differs from both, so it cannot stand in for the CLI account tenant.
const TENANT_HOME = '00000000-0000-4000-8000-0000000000cc';
const SCOPE = 'https://management.core.windows.net//.default';
const TOKEN_COMMAND = `account get-access-token --scope ${SCOPE} -o json`;
const PROFILE_COMMAND = 'account list --all --output json';
const PROFILE_REFRESH_COMMAND = 'account list --all --refresh --output json';
const TENANT_MISMATCH = 'The selected subscription account does not belong to the requested tenant';
// Azure CLI's error when `--subscription` names an account missing from its cached profile.
const NOT_IN_PROFILE = `ERROR: Subscription '${SUBSCRIPTION}' not found. Check the spelling and casing and try again.`;
const CLUSTER_ID = `/subscriptions/${SUBSCRIPTION}/resourceGroups/sample-rg/providers/Microsoft.ContainerService/managedClusters/sample-cluster`;
const CLUSTER_FETCH = `fetch /subscriptions/${SUBSCRIPTION}/providers/Microsoft.ContainerService/managedClusters Bearer token-subscription`;

let events: string[];
/** The tenant a profile refresh finds for the subscription, or undefined if it finds none. */
let accountTenant: string | undefined;
/** The CLI's cached profile tenant for the subscription; undefined is a cold cache. */
let cachedTenant: string | undefined;
/** Profile change made outside discovery, applied before the subscription token is requested. */
let beforeSubscriptionToken: (() => void) | undefined;

/** Synthetic token output; a subscription-bound token reports its profile account's tenant. */
const token = (accessToken: string, tenant?: string) => ({
  stdout: JSON.stringify({
    accessToken,
    expires_on: Math.floor(Date.now() / 1000) + 3600,
    ...(tenant && { tenant }),
  }),
  stderr: '',
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
  clearAzureTokenCaches();
  clearAzureCloudCache();
  events = [];
  accountTenant = TENANT_B;
  cachedTenant = TENANT_B;
  beforeSubscriptionToken = undefined;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.runCommandAsync.mockImplementation(async (_command: string, args: string[]) => {
    const command = args.join(' ');
    events.push(command);
    if (command === 'cloud show --output json') {
      const endpoints = {
        resourceManager: 'https://management.azure.com/',
        activeDirectoryResourceId: 'https://management.core.windows.net/',
      };
      return { stdout: JSON.stringify({ name: 'AzureCloud', endpoints }), stderr: '' };
    }
    if (command === PROFILE_COMMAND || command === PROFILE_REFRESH_COMMAND) {
      if (command === PROFILE_REFRESH_COMMAND) cachedTenant = accountTenant;
      const profile = cachedTenant ? [{ id: SUBSCRIPTION, tenantId: cachedTenant }] : [];
      return { stdout: JSON.stringify(profile), stderr: '' };
    }
    if (command === TOKEN_COMMAND) return token('token-default');
    if (command === `${TOKEN_COMMAND} --tenant ${TENANT_A}`) return token('token-tenant-a');
    if (command === `${TOKEN_COMMAND} --tenant ${TENANT_B}`) return token('token-tenant-b');
    if (command === `${TOKEN_COMMAND} --subscription ${SUBSCRIPTION}`) {
      beforeSubscriptionToken?.();
      // Like Azure CLI, a subscription token needs a cached profile account and has its tenant.
      if (!cachedTenant) return { stdout: '', stderr: NOT_IN_PROFILE };
      return token('token-subscription', cachedTenant);
    }
    throw new Error(`Unexpected CLI command: az ${command}`);
  });
  mocks.fetch.mockImplementation(async (url: URL, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization;
    events.push(`fetch ${url.pathname} ${auth}`);
    if (url.pathname === '/tenants') {
      const value = [{ tenantId: TENANT_A, displayName: 'Tenant A' }, { tenantId: TENANT_B }];
      return json(200, { value });
    }
    if (url.pathname === '/subscriptions' && auth === 'Bearer token-tenant-a') {
      const subscription = {
        subscriptionId: SUBSCRIPTION,
        displayName: 'Sample',
        tenantId: TENANT_HOME,
        state: 'Enabled',
      };
      return json(200, { value: [subscription] });
    }
    // Tenant B's inventory listing keeps failing transiently until retries are exhausted.
    if (url.pathname === '/subscriptions' && auth === 'Bearer token-tenant-b') {
      return json(503, {}, { 'retry-after': '0' });
    }
    if (url.pathname.endsWith('/managedClusters') && auth === 'Bearer token-subscription') {
      return json(200, { value: [{ name: 'sample-cluster', id: CLUSTER_ID }] });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Asserts S's clusters are listed exactly once with its subscription-bound token. */
async function expectClusterListed() {
  const clusters = await getClusters();

  expect(events.filter(event => event.includes('/managedClusters'))).toEqual([CLUSTER_FETCH]);
  expect(clusters).toEqual([
    expect.objectContaining({
      name: 'sample-cluster',
      subscription: SUBSCRIPTION,
      resourceGroup: 'sample-rg',
      id: CLUSTER_ID,
    }),
  ]);
}

/** Asserts S's token was requested and failed with `reason`, and no cluster list was sent. */
async function expectSkipped(reason: string) {
  await expect(getClusters()).resolves.toEqual([]);
  expect(events).toContain(`${TOKEN_COMMAND} --subscription ${SUBSCRIPTION}`);
  expect(events.filter(event => event.includes('/managedClusters'))).toEqual([]);
  expect(console.warn).toHaveBeenCalledWith(
    `Could not list AKS clusters for subscription ${SUBSCRIPTION}:`,
    reason
  );
}

test("all-subscription discovery keeps S when its profile-tenant listing fails but S's profile-bound token succeeds", async () => {
  await expectClusterListed();
  expect(console.warn).toHaveBeenCalledWith(
    `Skipping subscriptions for tenant ${TENANT_B}:`,
    expect.stringContaining('503')
  );
});

test('uses the CLI account tenant from the refreshed profile', async () => {
  cachedTenant = undefined;

  await expectClusterListed();
  expect(events).toContain(PROFILE_COMMAND);
  expect(events).toContain(PROFILE_REFRESH_COMMAND);
});

test('rejects a subscription token from a tenant other than the recorded CLI account tenant', async () => {
  // Discovery records tenant B; the profile then moves S to the discovery tenant.
  beforeSubscriptionToken = () => (cachedTenant = TENANT_A);

  await expectSkipped(TENANT_MISMATCH);
});

test('skips the subscription with a warning when even the refreshed CLI profile does not know it', async () => {
  accountTenant = undefined;
  cachedTenant = undefined;

  await expectSkipped(NOT_IN_PROFILE);
  expect(events).toContain(PROFILE_COMMAND);
  expect(events).toContain(PROFILE_REFRESH_COMMAND);
});

describe('when the CLI profile learns the subscription only after discovery', () => {
  beforeEach(() => {
    accountTenant = undefined;
    cachedTenant = undefined;
  });

  test('accepts a token from the discovery tenant', async () => {
    beforeSubscriptionToken = () => (cachedTenant = TENANT_A);

    await expectClusterListed();
  });

  test('rejects a token from another tenant', async () => {
    beforeSubscriptionToken = () => (cachedTenant = TENANT_B);

    await expectSkipped(TENANT_MISMATCH);
  });
});

test("keeps the discovery tenant and records the CLI account's tenant beside it", async () => {
  const [subscription] = await getSubscriptions();

  expect(subscription).toMatchObject({
    id: SUBSCRIPTION,
    tenant: TENANT_A,
    tenantName: 'Tenant A',
    accountTenantId: TENANT_B,
  });
});
