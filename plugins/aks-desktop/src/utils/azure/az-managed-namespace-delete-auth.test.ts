// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { deleteManagedNamespace } from './az-namespaces';
import { ARM_SCOPE, getSubscriptionCredential } from './az-token';

const subscriptionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const tenantId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const cloud = { endpoint: '', audience: '' };
const coordinates = {
  subscriptionId,
  tenantId,
  resourceGroup: 'rg',
  clusterName: 'aks',
  namespaceName: 'project',
};
beforeEach(() => {
  window.dispatchEvent(new CustomEvent('azure-auth-update'));
  cloud.endpoint = 'https://management.azure.com';
  cloud.audience = 'https://management.azure.com';
  getSubscriptionCredential(subscriptionId).clearCache();
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
      async () =>
        new Response(JSON.stringify({ error: { code: 'ResourceNotFound' } }), { status: 404 })
    );
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

test.each([undefined, tenantId])(
  'uses the selected subscription and cached production credential for tenant %s',
  async selectedTenant => {
    const options = {
      subscriptionId,
      tenantId: selectedTenant,
      resourceGroup: 'rg',
      clusterName: 'aks',
      namespaceName: 'project',
    };
    expect(await deleteManagedNamespace(options)).toMatchObject({ success: true });
    expect(await deleteManagedNamespace(options)).toMatchObject({ success: true });
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
          subscriptionId,
        ],
      ],
    ]);
    expect(mocks.command).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][1].method).toBe('DELETE');
  }
);

test('rejects a wrong-tenant token before sending DELETE', async () => {
  expect(
    await deleteManagedNamespace({
      subscriptionId,
      tenantId: '00000000-0000-0000-0000-000000000002',
      resourceGroup: 'rg',
      clusterName: 'aks',
      namespaceName: 'project',
    })
  ).toMatchObject({ success: false, error: expect.stringMatching(/tenant/i) });
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
])('deletes through configured cloud defaults without explicit overrides: %j', async configured => {
  Object.assign(cloud, configured);
  expect(await deleteManagedNamespace(coordinates)).toMatchObject({ success: true });
  expect(String(mocks.fetch.mock.calls[0][0]).startsWith(`${cloud.endpoint}/`)).toBe(true);
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
});

test('uses the resolved cloud origin for trusted asynchronous operation polling', async () => {
  cloud.endpoint = 'https://management.usgovcloudapi.net';
  cloud.audience = 'https://management.core.usgovcloudapi.net/';
  mocks.fetch
    .mockResolvedValueOnce(
      new Response(null, {
        status: 202,
        headers: {
          'azure-asyncoperation': `${cloud.endpoint}/operations/delete`,
          'retry-after': '0',
        },
      })
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Succeeded' })));
  expect(await deleteManagedNamespace(coordinates)).toMatchObject({ success: true });
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  for (const [url] of mocks.fetch.mock.calls)
    expect(String(url).startsWith(`${cloud.endpoint}/`)).toBe(true);
});

test('rejects a public ARM operation link returned from a non-public resource request', async () => {
  cloud.endpoint = 'https://management.usgovcloudapi.net';
  cloud.audience = 'https://management.core.usgovcloudapi.net/';
  mocks.fetch.mockResolvedValueOnce(
    new Response(null, {
      status: 202,
      headers: {
        'azure-asyncoperation': 'https://management.azure.com/operations/delete',
      },
    })
  );
  expect(await deleteManagedNamespace(coordinates)).toMatchObject({
    success: false,
    error: expect.stringContaining('untrusted host'),
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

test('preserves explicit endpoint/scope pairs without reading local cloud configuration', async () => {
  const overrides = {
    endpoint: 'https://override.example.test',
    scope: 'https://tokens.example.test/.default',
  };
  expect(await deleteManagedNamespace({ ...coordinates, ...overrides })).toMatchObject({
    success: true,
  });
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('az', [
    'account',
    'get-access-token',
    '--scope',
    overrides.scope,
    '-o',
    'json',
    '--subscription',
    subscriptionId,
  ]);
});

test.each([
  { endpoint: 'https://override.example.test' },
  { scope: 'https://tokens.example.test/.default' },
])('keeps individual overrides while filling missing cloud defaults: %j', async overrides => {
  cloud.endpoint = 'https://management.usgovcloudapi.net';
  cloud.audience = 'https://management.core.usgovcloudapi.net/';
  expect(await deleteManagedNamespace({ ...coordinates, ...overrides })).toMatchObject({
    success: true,
  });
  expect(
    String(mocks.fetch.mock.calls[0][0]).startsWith(`${overrides.endpoint ?? cloud.endpoint}/`)
  ).toBe(true);
  expect(mocks.command).toHaveBeenCalledWith(
    'az',
    expect.arrayContaining(['--scope', overrides.scope ?? `${cloud.audience}/.default`])
  );
});

test('fails closed when cloud configuration is unavailable', async () => {
  mocks.command.mockResolvedValue({ stdout: '', stderr: 'ERROR: cloud configuration unavailable' });
  expect(await deleteManagedNamespace(coordinates)).toMatchObject({
    success: false,
    error: expect.stringContaining('cloud configuration unavailable'),
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('cancels cloud resolution before any metadata or token command', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  expect(await deleteManagedNamespace({ ...coordinates, signal: controller.signal })).toMatchObject(
    {
      success: false,
      error: expect.stringContaining('cancelled'),
    }
  );
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('bounds cloud metadata discovery by the same overall deletion deadline', async () => {
  mocks.command.mockReturnValue(new Promise(() => {}));
  expect(await deleteManagedNamespace({ ...coordinates, timeoutMs: 10 })).toMatchObject({
    success: false,
    error: expect.stringContaining('Managed namespace deletion timed out'),
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
