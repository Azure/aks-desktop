// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn(), fetch: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { getAzureCloudEndpoints } from './az-cloud';
import { registerContainerServiceProvider } from './az-resource-providers';

const credential = {
  getToken: vi.fn(async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 })),
};
const metadata = (resourceManager: string, activeDirectoryResourceId: string, name?: string) => ({
  stdout: JSON.stringify({ name, endpoints: { resourceManager, activeDirectoryResourceId } }),
  stderr: '',
});
beforeEach(() => {
  window.dispatchEvent(new CustomEvent('azure-auth-update'));
  mocks.command.mockReset();
  mocks.fetch
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ registrationState: 'Registered' })))
    );
  credential.getToken.mockClear();
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('selected account Azure cloud registration', () => {
  test.each([
    ['AzureCloud', 'https://management.azure.com/', 'https://management.core.windows.net/'],
    [
      'AzureUSGovernment',
      'https://management.usgovcloudapi.net/',
      'https://management.core.usgovcloudapi.net/',
    ],
    [
      'AzureChinaCloud',
      'https://management.chinacloudapi.cn/',
      'https://management.core.chinacloudapi.cn/',
    ],
    ['CustomCloud', 'https://management.custom.example/', 'https://audience.custom.example/'],
  ])('uses the configured %s ARM endpoint and audience', async (cloudName, endpoint, audience) => {
    mocks.command.mockResolvedValue(metadata(endpoint, audience));
    const options = { cloudName, tenantId: 'selected-tenant', credential };
    expect(await registerContainerServiceProvider('selected-sub', options)).toMatchObject({
      success: true,
    });
    expect(await registerContainerServiceProvider('selected-sub', options)).toMatchObject({
      success: true,
    });
    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(mocks.command).toHaveBeenCalledWith('az', [
      'cloud',
      'show',
      '--name',
      cloudName,
      '--output',
      'json',
    ]);
    expect(mocks.fetch.mock.calls.map(([url]) => String(url))).toEqual(
      Array(2).fill(
        `${endpoint}subscriptions/selected-sub/providers/Microsoft.ContainerService/register?api-version=2021-04-01`
      )
    );
    expect(credential.getToken).toHaveBeenCalledWith(
      `${audience}/.default`,
      expect.objectContaining({ tenantId: 'selected-tenant' })
    );
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'POST')).toBe(true);
  });

  test.each([
    'https://management.core.windows.net/',
    'https://management.core.windows.net',
    'https://audience.custom.example/resource/',
  ])('preserves the configured audience exactly when forming its scope: %s', async audience => {
    mocks.command.mockResolvedValue(metadata('https://management.azure.com/', audience));
    expect(await getAzureCloudEndpoints('ConfiguredAudience')).toEqual({
      name: 'ConfiguredAudience',
      endpoint: 'https://management.azure.com',
      scope: `${audience}/.default`,
    });
  });

  test('never falls back to public Azure after cloud metadata failure and allows a later retry', async () => {
    mocks.command
      .mockResolvedValueOnce({ stdout: '', stderr: 'ERROR: cloud configuration unavailable' })
      .mockResolvedValueOnce(
        metadata(
          'https://management.usgovcloudapi.net/',
          'https://management.core.usgovcloudapi.net/'
        )
      );
    const options = { credential, cloudName: 'AzureUSGovernment' };
    expect(await registerContainerServiceProvider('sub', options)).toMatchObject({
      success: false,
      error: expect.stringContaining('cloud configuration unavailable'),
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(await registerContainerServiceProvider('sub', options)).toMatchObject({ success: true });
    expect(mocks.command).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['http://management.example/', 'https://audience.example/'],
    ['https://management.example/', undefined],
  ])(
    'rejects invalid cloud configuration instead of selecting public Azure',
    async (endpoint, audience) => {
      mocks.command.mockResolvedValue({
        stdout: JSON.stringify({
          endpoints: { resourceManager: endpoint, activeDirectoryResourceId: audience },
        }),
        stderr: '',
      });
      expect(
        await registerContainerServiceProvider('sub', { credential, cloudName: 'BadCloud' })
      ).toMatchObject({ success: false, error: expect.any(String) });
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test('cancels a pending metadata read without starting registration', async () => {
    let release!: (result: { stdout: string; stderr: string }) => void;
    mocks.command.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );
    const controller = new AbortController();
    const pending = registerContainerServiceProvider('sub', {
      credential,
      cloudName: 'AzureUSGovernment',
      signal: controller.signal,
    });
    controller.abort(new Error('subscription changed'));
    expect(await pending).toMatchObject({
      success: false,
      error: expect.stringContaining('subscription changed'),
    });
    release(
      metadata(
        'https://management.usgovcloudapi.net/',
        'https://management.core.usgovcloudapi.net/'
      )
    );
    await Promise.resolve();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('reads the active CLI cloud when no cloud name is given', async () => {
    mocks.command.mockResolvedValue(
      metadata(
        'https://management.chinacloudapi.cn/',
        'https://management.core.chinacloudapi.cn/',
        'AzureChinaCloud'
      )
    );
    expect(await getAzureCloudEndpoints()).toEqual({
      name: 'AzureChinaCloud',
      endpoint: 'https://management.chinacloudapi.cn',
      scope: 'https://management.core.chinacloudapi.cn//.default',
    });
    expect(mocks.command).toHaveBeenCalledWith('az', ['cloud', 'show', '--output', 'json']);
  });

  test.each([undefined, '--bad'])(
    'rejects an active cloud with a missing or invalid name: %s',
    async name => {
      mocks.command.mockResolvedValue(
        metadata('https://management.azure.com/', 'https://management.core.windows.net/', name)
      );
      await expect(getAzureCloudEndpoints()).rejects.toThrow('Azure cloud name');
    }
  );

  test('invalidates cached local cloud metadata after an account change', async () => {
    mocks.command.mockResolvedValue(
      metadata('https://management.azure.com/', 'https://management.core.windows.net/')
    );
    await getAzureCloudEndpoints('AzureCloud');
    window.dispatchEvent(new CustomEvent('azure-auth-update'));
    await getAzureCloudEndpoints('AzureCloud');
    expect(mocks.command).toHaveBeenCalledTimes(2);
  });
});
