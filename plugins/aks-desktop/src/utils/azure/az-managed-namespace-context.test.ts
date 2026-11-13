// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));
vi.mock('./az-cli-path', () => ({ getAzCommand: () => 'az' }));

import { getManagedNamespaceDetails, updateManagedNamespace } from './az-namespaces';

const first = '11111111-2222-3333-4444-555555555555';
const second = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const tenant = '22222222-3333-4444-5555-666666666666';
const scope = {
  subscriptionId: first,
  resourceGroup: 'group',
  clusterName: 'cluster',
  namespaceName: 'namespace',
};
const resource = {
  id: '/namespace',
  name: 'namespace',
  type: 'Microsoft.ContainerService/managedClusters/managedNamespaces',
  location: 'test',
  properties: { provisioningState: 'Succeeded', labels: { keep: 'value' } },
};
const clouds: Record<string, { endpoint: string; audience: string }> = {
  AzureCloud: {
    endpoint: 'https://management.azure.com/',
    audience: 'https://management.core.windows.net/',
  },
  AzureUSGovernment: {
    endpoint: 'https://management.usgovcloudapi.net/',
    audience: 'https://management.core.usgovcloudapi.net/',
  },
  AzureChinaCloud: {
    endpoint: 'https://management.chinacloudapi.cn/',
    audience: 'https://management.core.chinacloudapi.cn/',
  },
  CustomCloud: {
    endpoint: 'https://arm.example.test/',
    audience: 'https://audience.example.test/resource/',
  },
};
let cloudName = 'AzureCloud';

function response(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.dispatchEvent(new CustomEvent('azure-auth-update'));
  cloudName = 'AzureCloud';
  mocks.command.mockReset().mockImplementation(async (_command, args: string[]) => {
    if (args[0] === 'cloud') {
      expect(args).toEqual(['cloud', 'show', '--name', cloudName, '--output', 'json']);
      const cloud = clouds[cloudName];
      return {
        stdout: JSON.stringify({
          endpoints: {
            resourceManager: cloud.endpoint,
            activeDirectoryResourceId: cloud.audience,
          },
        }),
        stderr: '',
      };
    }
    expect(args[0]).toBe('account');
    const subscription = args[args.indexOf('--subscription') + 1];
    if (args[1] === 'show') {
      return {
        stdout: JSON.stringify({
          id: subscription,
          tenantId: tenant,
          cloudName,
          user: { name: `${subscription}@example.test` },
        }),
        stderr: '',
      };
    }
    expect(args[1]).toBe('get-access-token');
    expect(args).not.toContain('--tenant');
    expect([first, second]).toContain(subscription);
    expect(args[args.indexOf('--scope') + 1]).toBe(`${clouds[cloudName].audience}/.default`);
    return {
      stdout: JSON.stringify({
        accessToken: `identity-${subscription}`,
        expires_on: Math.floor(Date.now() / 1000) + 3600,
        tenant,
      }),
      stderr: '',
    };
  });
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each(Object.keys(clouds))(
  'routes all namespace requests and tokens through selected %s configuration',
  async name => {
    cloudName = name;
    mocks.fetch
      .mockResolvedValueOnce(response(200, resource))
      .mockResolvedValueOnce(response(202, undefined, { 'azure-asyncoperation': '/operations/op' }))
      .mockResolvedValueOnce(response(200, { status: 'Succeeded' }))
      .mockResolvedValueOnce(response(200, resource));
    const pending = updateManagedNamespace(scope);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(resource);
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    for (const [url, init] of mocks.fetch.mock.calls) {
      expect(new URL(String(url)).origin).toBe(new URL(clouds[name].endpoint).origin);
      expect(init.headers.Authorization).toBe(`Bearer identity-${first}`);
    }
    const tokens = mocks.command.mock.calls.filter(([, args]) => args[1] === 'get-access-token');
    expect(tokens).toHaveLength(1);
    expect(String(mocks.fetch.mock.calls[2][0])).toContain('/operations/op');
  }
);

test('keeps two signed-in identities in the same tenant bound to their subscription', async () => {
  mocks.fetch.mockImplementation(() => Promise.resolve(response(200, resource)));
  await getManagedNamespaceDetails(scope);
  await updateManagedNamespace({ ...scope, subscriptionId: second });
  expect(mocks.fetch.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([
    `Bearer identity-${first}`,
    `Bearer identity-${second}`,
    `Bearer identity-${second}`,
    `Bearer identity-${second}`,
  ]);
  expect(
    mocks.command.mock.calls.filter(([, args]) => args[1] === 'get-access-token')
  ).toHaveLength(2);
});

test.each(['azure-asyncoperation', 'location'])(
  'rejects a public Azure %s continuation from a Government update',
  async header => {
    cloudName = 'AzureUSGovernment';
    mocks.fetch
      .mockResolvedValueOnce(response(200, resource))
      .mockResolvedValueOnce(
        response(202, undefined, { [header]: 'https://management.azure.com/operations/op' })
      );
    await expect(updateManagedNamespace(scope)).rejects.toThrow('untrusted');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(
      mocks.command.mock.calls.filter(([, args]) => args[1] === 'get-access-token')
    ).toHaveLength(1);
  }
);

test('fails before token acquisition or HTTP when cloud configuration is missing', async () => {
  const normal = mocks.command.getMockImplementation()!;
  mocks.command.mockImplementation((command, args) =>
    args[0] === 'cloud'
      ? Promise.resolve({ stdout: '{"endpoints":{}}', stderr: '' })
      : normal(command, args)
  );
  await expect(updateManagedNamespace(scope)).rejects.toThrow('endpoint is missing');
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.command.mock.calls.some(([, args]) => args[1] === 'get-access-token')).toBe(false);
});
