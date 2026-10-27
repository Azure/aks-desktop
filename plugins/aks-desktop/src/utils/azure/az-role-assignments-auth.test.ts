// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { getManagedNamespaceResourceId } from './az-identity';
import { createAzureRoleAssignment } from './az-role-assignments';
import { ARM_SCOPE, getSubscriptionCredential } from './az-token';

const subscriptionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const registrySubscription = '11111111-2222-3333-4444-555555555555';
const tenantId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const cloud = { endpoint: '', audience: '' };
const assignment = {
  subscriptionId,
  tenantId,
  scope: `/subscriptions/${subscriptionId}/resourceGroups/rg`,
  principalId: '00000000-0000-0000-0000-000000000001',
  principalType: 'ServicePrincipal' as const,
  role: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
};
const namespace = {
  subscriptionId,
  tenantId,
  resourceGroup: 'rg',
  clusterName: 'aks',
  namespaceName: 'project',
};
const namespaceId = `/subscriptions/${subscriptionId}/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/aks/managedNamespaces/project`;

beforeEach(() => {
  window.dispatchEvent(new CustomEvent('azure-auth-update'));
  cloud.endpoint = 'https://management.azure.com';
  cloud.audience = 'https://management.azure.com';
  for (const id of [subscriptionId, registrySubscription]) {
    getSubscriptionCredential(id).clearCache();
  }
  mocks.command.mockReset().mockImplementation((_command: string, args: string[]) => ({
    stdout: JSON.stringify(
      args[0] === 'cloud'
        ? {
            endpoints: {
              resourceManager: cloud.endpoint,
              activeDirectoryResourceId: cloud.audience,
            },
          }
        : {
            accessToken: 'test-token',
            expires_on: Math.floor(Date.now() / 1000) + 3600,
            tenant: tenantId,
          }
    ),
    stderr: '',
  }));
  mocks.fetch
    .mockReset()
    .mockImplementation(
      async (url: URL) =>
        new Response(
          JSON.stringify(
            url.pathname.endsWith('/managedNamespaces/project') ? { id: namespaceId } : {}
          )
        )
    );
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

test.each([subscriptionId, registrySubscription])(
  'binds default credentials to the assignment scope subscription %s',
  async scopeSubscription => {
    const options = {
      subscriptionId,
      tenantId,
      scope: `/subscriptions/${scopeSubscription}/resourceGroups/rg`,
      principalId: '00000000-0000-0000-0000-000000000001',
      principalType: 'ServicePrincipal' as const,
      role: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
    };
    await createAzureRoleAssignment(options);
    await createAzureRoleAssignment(options);
    expect(mocks.command.mock.calls.filter(([, args]) => args[0] === 'account')).toEqual([
      [
        'az',
        [
          'account',
          'get-access-token',
          '--scope',
          ARM_SCOPE,
          '-o',
          'json',
          '--subscription',
          scopeSubscription,
        ],
      ],
    ]);
    expect(mocks.command).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(`/subscriptions/${scopeSubscription}/`);
  }
);

test('rejects a token from the wrong tenant before creating any assignment', async () => {
  await expect(
    createAzureRoleAssignment({
      subscriptionId,
      tenantId: '00000000-0000-0000-0000-000000000002',
      scope: `/subscriptions/${subscriptionId}/resourceGroups/rg`,
      principalId: '00000000-0000-0000-0000-000000000001',
      principalType: 'ServicePrincipal',
      role: 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
    })
  ).rejects.toThrow(/tenant/i);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test.each([
  {
    endpoint: 'https://management.usgovcloudapi.net',
    audience: 'https://management.core.usgovcloudapi.net/',
  },
  {
    endpoint: 'https://management.chinacloudapi.cn',
    audience: 'https://management.core.chinacloudapi.cn/',
  },
  { endpoint: 'https://arm.example.test', audience: 'https://identity.example.test/resources/arm' },
])(
  'uses configured cloud defaults for role creation and namespace lookup: %j',
  async configured => {
    Object.assign(cloud, configured);
    await createAzureRoleAssignment(assignment);
    expect(await getManagedNamespaceResourceId(namespace)).toEqual({
      success: true,
      resourceId: namespaceId,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const [url] of mocks.fetch.mock.calls)
      expect(new URL(String(url)).origin).toBe(new URL(cloud.endpoint).origin);
    expect(mocks.command).toHaveBeenCalledWith('az', [
      'account',
      'get-access-token',
      '--scope',
      `${cloud.audience}/.default`,
      '-o',
      'json',
      '--subscription',
      subscriptionId,
    ]);
    expect(mocks.command).toHaveBeenCalledWith('az', ['cloud', 'show', '--output', 'json']);
  }
);

test('preserves explicit endpoint/audience pairs without reading local cloud configuration', async () => {
  const overrides = {
    endpoint: 'https://override.example.test',
    audience: 'https://tokens.example.test/.default',
  };
  await createAzureRoleAssignment({ ...assignment, ...overrides });
  expect(await getManagedNamespaceResourceId({ ...namespace, ...overrides })).toMatchObject({
    success: true,
  });
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('az', [
    'account',
    'get-access-token',
    '--scope',
    overrides.audience,
    '-o',
    'json',
    '--subscription',
    subscriptionId,
  ]);
  for (const [url] of mocks.fetch.mock.calls)
    expect(String(url).startsWith(`${overrides.endpoint}/`)).toBe(true);
});

test.each([
  { endpoint: 'https://override.example.test' },
  { audience: 'https://tokens.example.test/.default' },
])('keeps individual overrides while filling missing cloud defaults: %j', async overrides => {
  cloud.endpoint = 'https://management.usgovcloudapi.net';
  cloud.audience = 'https://management.core.usgovcloudapi.net/';
  await createAzureRoleAssignment({ ...assignment, ...overrides });
  await getManagedNamespaceResourceId({ ...namespace, ...overrides });
  for (const [url] of mocks.fetch.mock.calls)
    expect(String(url).startsWith(`${overrides.endpoint ?? cloud.endpoint}/`)).toBe(true);
  expect(mocks.command).toHaveBeenCalledWith(
    'az',
    expect.arrayContaining(['--scope', overrides.audience ?? `${cloud.audience}/.default`])
  );
});

test('never falls back to public ARM when cloud lookup fails', async () => {
  mocks.command.mockResolvedValue({ stdout: '', stderr: 'ERROR: cloud configuration unavailable' });
  await expect(createAzureRoleAssignment(assignment)).rejects.toThrow(
    'cloud configuration unavailable'
  );
  expect(await getManagedNamespaceResourceId(namespace)).toMatchObject({
    success: false,
    error: expect.stringContaining('cloud configuration unavailable'),
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.command.mock.calls.every(([, args]) => args[0] === 'cloud')).toBe(true);
});

test('cancels cloud lookup before any metadata/token command or resource request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(
    createAzureRoleAssignment({ ...assignment, signal: controller.signal })
  ).rejects.toThrow('cancelled');
  expect(
    await getManagedNamespaceResourceId({ ...namespace, signal: controller.signal })
  ).toMatchObject({
    success: false,
    error: expect.stringContaining('cancelled'),
  });
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('bounds cold cloud discovery before role creation without changing later per-request budgets', async () => {
  mocks.command.mockReturnValue(new Promise(() => {}));
  await expect(createAzureRoleAssignment({ ...assignment, timeoutMs: 10 })).rejects.toThrow(
    'Azure request timed out after 10 ms'
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('bounds the same shared cold discovery used by managed namespace lookup', async () => {
  mocks.command.mockReturnValue(new Promise(() => {}));
  expect(await getManagedNamespaceResourceId({ ...namespace, timeoutMs: 10 })).toMatchObject({
    success: false,
    error: expect.stringContaining('Azure request timed out after 10 ms'),
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
