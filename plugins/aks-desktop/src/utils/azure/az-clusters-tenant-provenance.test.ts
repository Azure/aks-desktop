// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

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
const CLUSTER_ID = `/subscriptions/${SUBSCRIPTION}/resourceGroups/sample-rg/providers/Microsoft.ContainerService/managedClusters/sample-cluster`;
const CLUSTER_FETCH = `fetch /subscriptions/${SUBSCRIPTION}/providers/Microsoft.ContainerService/managedClusters Bearer token-subscription`;

let events: string[];
/** The CLI profile's tenant for the subscription, or undefined when the profile omits it. */
let profileTenant: string | undefined;
/** When set, only the refreshed CLI profile knows the subscription. */
let staleProfile: boolean;
let subscriptionTokenTenant: string;

/** Synthetic token output; the subscription-bound token reports the CLI account's tenant. */
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
  profileTenant = TENANT_B;
  staleProfile = false;
  subscriptionTokenTenant = TENANT_B;
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
      const known = profileTenant && (command === PROFILE_REFRESH_COMMAND || !staleProfile);
      const profile = known ? [{ id: SUBSCRIPTION, tenantId: profileTenant }] : [];
      return { stdout: JSON.stringify(profile), stderr: '' };
    }
    if (command === TOKEN_COMMAND) return token('token-default');
    if (command === `${TOKEN_COMMAND} --tenant ${TENANT_A}`) return token('token-tenant-a');
    if (command === `${TOKEN_COMMAND} --tenant ${TENANT_B}`) return token('token-tenant-b');
    if (command === `${TOKEN_COMMAND} --subscription ${SUBSCRIPTION}`) {
      return token('token-subscription', subscriptionTokenTenant);
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

/** Asserts S's token was requested and refused for its tenant, and no cluster list was sent. */
async function expectTenantRefusal() {
  await expect(getClusters()).resolves.toEqual([]);
  expect(events).toContain(`${TOKEN_COMMAND} --subscription ${SUBSCRIPTION}`);
  expect(events.filter(event => event.includes('/managedClusters'))).toEqual([]);
  expect(console.warn).toHaveBeenCalledWith(
    `Could not list AKS clusters for subscription ${SUBSCRIPTION}:`,
    TENANT_MISMATCH
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
  staleProfile = true;

  await expectClusterListed();
  expect(events).toContain(PROFILE_COMMAND);
  expect(events).toContain(PROFILE_REFRESH_COMMAND);
});

test("still rejects a subscription token from a tenant other than the CLI account's", async () => {
  // The discovery tenant is not accepted in place of the CLI account's tenant.
  subscriptionTokenTenant = TENANT_A;

  await expectTenantRefusal();
});

test('keeps the discovery-tenant check when the CLI profile does not know the subscription', async () => {
  profileTenant = undefined;

  await expectTenantRefusal();
  expect(events).toContain(PROFILE_COMMAND);
  expect(events).toContain(PROFILE_REFRESH_COMMAND);
});

test('accepts a discovery-tenant token when the CLI profile does not know the subscription', async () => {
  profileTenant = undefined;
  subscriptionTokenTenant = TENANT_A;

  await expectClusterListed();
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
