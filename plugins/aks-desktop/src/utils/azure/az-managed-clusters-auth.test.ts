// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { getManagedClusterDetails } from './az-managed-clusters';
import { ARM_SCOPE, getSubscriptionCredential } from './az-token';

const subscriptionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const cloud = { endpoint: '', audience: '' };
const coordinates = { subscriptionId, resourceGroup: 'rg', clusterName: 'aks' };
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
            tenant: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          }
    ),
    stderr: '',
  }));
  mocks.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ properties: {} })));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each([undefined, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'])(
  'authenticates a non-injected read with supported selectors for tenant %s',
  async tenantId => {
    await expect(
      getManagedClusterDetails({
        subscriptionId,
        tenantId,
        resourceGroup: 'rg',
        clusterName: 'aks',
      })
    ).resolves.toEqual({ properties: {} });
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
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(`/subscriptions/${subscriptionId}/`);
  }
);

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
])('uses configured cloud defaults without explicit overrides: %j', async configured => {
  Object.assign(cloud, configured);
  await getManagedClusterDetails(coordinates);
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

test('preserves explicit endpoint/scope pairs without reading local cloud configuration', async () => {
  const overrides = {
    endpoint: 'https://override.example.test',
    scope: 'https://tokens.example.test/.default',
  };
  await getManagedClusterDetails({ ...coordinates, ...overrides });
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
  expect(String(mocks.fetch.mock.calls[0][0]).startsWith(`${overrides.endpoint}/`)).toBe(true);
});

test.each([
  { endpoint: 'https://override.example.test' },
  { scope: 'https://tokens.example.test/.default' },
])('keeps individual overrides while filling missing cloud defaults: %j', async overrides => {
  cloud.endpoint = 'https://management.usgovcloudapi.net';
  cloud.audience = 'https://management.core.usgovcloudapi.net/';
  await getManagedClusterDetails({ ...coordinates, ...overrides });
  expect(
    String(mocks.fetch.mock.calls[0][0]).startsWith(`${overrides.endpoint ?? cloud.endpoint}/`)
  ).toBe(true);
  expect(mocks.command).toHaveBeenCalledWith(
    'az',
    expect.arrayContaining(['--scope', overrides.scope ?? `${cloud.audience}/.default`])
  );
});

test('never falls back to public ARM when cloud configuration fails', async () => {
  mocks.command.mockResolvedValue({ stdout: '', stderr: 'ERROR: cloud configuration unavailable' });
  await expect(getManagedClusterDetails(coordinates)).rejects.toThrow(
    'cloud configuration unavailable'
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('cancels the configured-cloud lookup before commands or resource requests', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(
    getManagedClusterDetails({ ...coordinates, signal: controller.signal })
  ).rejects.toThrow('cancelled');
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('rejects an invalid production subscription before local cloud metadata lookup', async () => {
  await expect(
    getManagedClusterDetails({ ...coordinates, subscriptionId: 'invalid' })
  ).rejects.toThrow('Invalid subscription ID');
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('times out a pending cold-cache cloud lookup before issuing HTTP', async () => {
  mocks.command.mockReturnValue(new Promise(() => {}));
  await expect(getManagedClusterDetails({ ...coordinates, timeoutMs: 10 })).rejects.toThrow(
    'Azure request timed out after 10 ms'
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test('shares the original deadline between cloud discovery and the later HTTP request', async () => {
  vi.useFakeTimers();
  mocks.command.mockImplementationOnce(
    () =>
      new Promise(resolve =>
        setTimeout(
          () =>
            resolve({
              stdout: JSON.stringify({
                endpoints: {
                  resourceManager: cloud.endpoint,
                  activeDirectoryResourceId: cloud.audience,
                },
              }),
              stderr: '',
            }),
          40
        )
      )
  );
  mocks.fetch.mockImplementation(
    (_url, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      })
  );
  const pending = getManagedClusterDetails({ ...coordinates, timeoutMs: 50 });
  const rejected = expect(pending).rejects.toThrow('Azure request timed out after 50 ms');
  await vi.advanceTimersByTimeAsync(40);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

test('disposes metadata and HTTP deadline timers after a successful read', async () => {
  vi.useFakeTimers();
  await getManagedClusterDetails(coordinates);
  expect(vi.getTimerCount()).toBe(0);
});
