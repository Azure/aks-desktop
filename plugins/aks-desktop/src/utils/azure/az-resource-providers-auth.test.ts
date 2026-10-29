// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { registerContainerServiceProvider } from './az-resource-providers';
import { getSubscriptionCredential } from './az-token';

const subscriptions = [
  '11111111-2222-3333-4444-555555555555',
  'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
];
const tenantId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(() => {
  window.dispatchEvent(new CustomEvent('azure-auth-update'));
  for (const id of subscriptions) getSubscriptionCredential(id).clearCache();
  mocks.command.mockReset().mockImplementation(async (_command: string, args: string[]) => ({
    stdout: JSON.stringify({
      accessToken: `token-for-${args[args.indexOf('--subscription') + 1]}`,
      expires_on: Math.floor(Date.now() / 1000) + 3600,
      tenant: tenantId,
    }),
    stderr: '',
  }));
  mocks.fetch
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ registrationState: 'Registered' })))
    );
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

test('default CLI-backed registration keeps distinct selected accounts in the same tenant', async () => {
  for (const subscription of [...subscriptions, ...subscriptions]) {
    expect(await registerContainerServiceProvider(subscription, { tenantId })).toMatchObject({
      success: true,
    });
  }
  expect(mocks.command).toHaveBeenCalledTimes(2);
  for (const [command, args] of mocks.command.mock.calls) {
    expect(command).toBe('az');
    expect(args.slice(0, 2)).toEqual(['account', 'get-access-token']);
    expect(args).not.toContain('--tenant');
    expect(subscriptions).toContain(args[args.indexOf('--subscription') + 1]);
  }
  for (const [index, [url, init]] of mocks.fetch.mock.calls.entries()) {
    const subscription = subscriptions[index % subscriptions.length];
    expect(String(url)).toContain(
      `/subscriptions/${subscription}/providers/Microsoft.ContainerService/register`
    );
    expect(init.headers.Authorization).toBe(`Bearer token-for-${subscription}`);
  }
});

test('default credential preserves the configured trailing-slash resource in the CLI scope', async () => {
  mocks.command.mockImplementation(async (_command: string, args: string[]) => {
    if (args[0] === 'cloud' && args[1] === 'show') {
      return {
        stdout: JSON.stringify({
          endpoints: {
            resourceManager: 'https://management.azure.com/',
            activeDirectoryResourceId: 'https://management.core.windows.net/',
          },
        }),
        stderr: '',
      };
    }
    if (args[0] !== 'account' || args[1] !== 'get-access-token') {
      throw new Error('Resource-specific CLI calls are forbidden');
    }
    return {
      stdout: JSON.stringify({
        accessToken: 'selected-account-token',
        expires_on: Math.floor(Date.now() / 1000) + 3600,
        tenant: tenantId,
      }),
      stderr: '',
    };
  });
  expect(
    await registerContainerServiceProvider(subscriptions[0], {
      tenantId,
      cloudName: 'ConfiguredPublicCloud',
    })
  ).toMatchObject({ success: true });
  expect(mocks.command).toHaveBeenCalledWith('az', [
    'account',
    'get-access-token',
    '--scope',
    'https://management.core.windows.net//.default',
    '-o',
    'json',
    '--subscription',
    subscriptions[0],
  ]);
  expect(mocks.command).toHaveBeenCalledTimes(2);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

test('does not send registration with a token from a different tenant', async () => {
  mocks.command.mockResolvedValueOnce({
    stdout: JSON.stringify({
      accessToken: 'wrong-token',
      expires_on: Math.floor(Date.now() / 1000) + 3600,
      tenant: 'cccccccc-dddd-eeee-ffff-000000000001',
    }),
    stderr: '',
  });
  expect(await registerContainerServiceProvider(subscriptions[0], { tenantId })).toMatchObject({
    success: false,
    error: expect.stringContaining('requested tenant'),
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
