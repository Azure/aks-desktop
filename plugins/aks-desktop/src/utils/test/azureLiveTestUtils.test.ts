// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn().mockReturnValue({ status: 1 }),
  fetch: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));

import {
  AZURE_TEST_RESOURCE_PREFIX,
  getLiveAzureContext,
  listAzureTestResources,
  withAzureTestResourceGroup,
} from './azureLiveTestUtils';

const context = {
  subscriptionId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  credential: {
    getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const missing = () => json({ error: { code: 'ResourceGroupNotFound' } }, 404);

beforeEach(() => {
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubEnv('AZ_LIVE_SUBSCRIPTION', '');
  mocks.spawnSync.mockReset();
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation((_url, init: RequestInit) =>
    Promise.resolve(init.method === 'PUT' ? json({}) : missing())
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Azure live test isolation', () => {
  test('defaults token acquisition to Cloud Native Tools, not the ambient subscription', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        accessToken: 'test-token',
        expires_on: Math.floor(Date.now() / 1000) + 3600,
        subscription: context.subscriptionId,
        tenant: context.tenantId,
      }),
    });
    expect(getLiveAzureContext().subscriptionId).toBe(context.subscriptionId);
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        '--subscription',
        process.platform === 'win32' ? '"Cloud Native Tools"' : 'Cloud Native Tools',
      ]),
      expect.any(Object)
    );
    expect(mocks.spawnSync).toHaveBeenCalledTimes(1);
  });

  test('quotes the friendly subscription name for Windows cmd.exe token bootstrap', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        accessToken: 'test-token',
        expires_on: Math.floor(Date.now() / 1000) + 3600,
        subscription: context.subscriptionId,
        tenant: context.tenantId,
      }),
    });
    getLiveAzureContext('win32');
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['--subscription', '"Cloud Native Tools"']),
      expect.objectContaining({ shell: true })
    );
  });

  test('tags and uniquely names every run, and cleans both groups after success', async () => {
    const names: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      await withAzureTestResourceGroup('provider', context, async run => {
        expect(run.resourceGroup.startsWith(AZURE_TEST_RESOURCE_PREFIX)).toBe(true);
        expect(run.tags['aks-desktop-test-run']).toBe(run.runId);
        names.push(run.resourceGroup);
      });
    }
    expect(new Set(names).size).toBe(2);
    const writes = mocks.fetch.mock.calls.filter(([, init]) => init.method === 'PUT');
    expect(JSON.parse(writes[0][1].body).tags['aks-desktop-test']).toBe('rest-e2e');
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(4);
  });

  test('refreshes an expired token once so long-running test cleanup can authenticate', async () => {
    vi.useFakeTimers();
    const response = (accessToken: string, seconds: number) => ({
      status: 0,
      stdout: JSON.stringify({
        accessToken,
        expires_on: Math.floor(Date.now() / 1000) + seconds,
        subscription: context.subscriptionId,
        tenant: context.tenantId,
      }),
    });
    mocks.spawnSync.mockReturnValueOnce(response('initial', 10));
    const live = getLiveAzureContext();
    await vi.advanceTimersByTimeAsync(11_000);
    mocks.spawnSync.mockReturnValueOnce(response('refreshed', 3600));
    expect(await live.credential.getToken('https://management.azure.com/.default')).toMatchObject({
      token: 'refreshed',
    });
    await live.credential.getToken('https://management.azure.com/.default');
    expect(mocks.spawnSync).toHaveBeenCalledTimes(2);
  });

  test('cleans up after an assertion failure', async () => {
    const failure = new Error('assertion failed');
    await expect(
      withAzureTestResourceGroup('failed-test', context, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(2);
  });

  test('observes deletion after an accepted DELETE before finishing cleanup', async () => {
    vi.useFakeTimers();
    const observed = new Set<string>();
    mocks.fetch.mockImplementation((url, init: RequestInit) => {
      if (init.method === 'PUT') return Promise.resolve(json({}));
      if (init.method === 'DELETE') return Promise.resolve(new Response(null, { status: 202 }));
      const key = String(url);
      if (observed.has(key)) return Promise.resolve(missing());
      observed.add(key);
      return Promise.resolve(json({ properties: { provisioningState: 'Deleting' } }));
    });
    const result = withAzureTestResourceGroup('poll-cleanup', context, async () => {});
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(4);
  });

  test('allows slow AKS group cleanup beyond twenty minutes and still observes absence', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    let firstRead = true;
    mocks.fetch.mockImplementation((url, init: RequestInit) => {
      if (init.method === 'PUT') return Promise.resolve(json({}));
      if (String(url).includes('-nodes')) return Promise.resolve(missing());
      if (init.method === 'DELETE') return Promise.resolve(new Response(null, { status: 202 }));
      if (firstRead) {
        firstRead = false;
        vi.setSystemTime(started + 25 * 60_000);
        return Promise.resolve(json({ properties: { provisioningState: 'Deleting' } }));
      }
      return Promise.resolve(missing());
    });
    const result = withAzureTestResourceGroup('slow-cleanup', context, async () => {});
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(Date.now() - started).toBeGreaterThan(20 * 60_000);
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(2);
  });

  test('retries idempotent group cleanup after a transport failure', async () => {
    vi.useFakeTimers();
    let failed = false;
    mocks.fetch.mockImplementation((_url, init: RequestInit) => {
      if (init.method === 'PUT') return Promise.resolve(json({}));
      if (init.method === 'DELETE' && !failed) {
        failed = true;
        return Promise.reject(new TypeError('network temporarily unavailable'));
      }
      return Promise.resolve(missing());
    });
    const result = withAzureTestResourceGroup('retry-cleanup', context, async () => {});
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(3);
  });

  test('attempts cleanup even when group creation fails after an uncertain write', async () => {
    mocks.fetch.mockImplementation((_url, init: RequestInit) =>
      Promise.resolve(
        init.method === 'PUT'
          ? json({ error: { code: 'AuthorizationFailed', message: 'denied' } }, 403)
          : missing()
      )
    );
    const body = vi.fn();
    await expect(withAzureTestResourceGroup('setup-failed', context, body)).rejects.toThrow(
      'AuthorizationFailed'
    );
    expect(body).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(2);
  });

  test('reports cleanup failures alongside the original failure and attempts both groups', async () => {
    mocks.fetch.mockImplementation((url, init: RequestInit) =>
      Promise.resolve(
        init.method === 'PUT'
          ? json({})
          : String(url).includes('-nodes')
          ? missing()
          : json({ error: { code: 'ScopeLocked', message: 'locked' } }, 409)
      )
    );
    await expect(
      withAzureTestResourceGroup('cleanup-failed', context, async () => {
        throw new Error('original failure');
      })
    ).rejects.toMatchObject({
      name: 'AzureLiveTestError',
      errors: [
        expect.objectContaining({ message: 'original failure' }),
        expect.objectContaining({ code: 'ScopeLocked' }),
      ],
    });
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(2);
  });

  test('inventory lists only test and node groups and uses no resource CLI commands', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json({
          value: [
            { name: `${AZURE_TEST_RESOURCE_PREFIX}run`, tags: { 'aks-desktop-test': 'rest-e2e' } },
            { name: `${AZURE_TEST_RESOURCE_PREFIX}run-nodes` },
            { name: 'production' },
          ],
        })
      )
      .mockResolvedValueOnce(
        json({
          value: [
            { name: 'test-identity', type: 'Microsoft.ManagedIdentity/userAssignedIdentities' },
          ],
        })
      )
      .mockResolvedValueOnce(json({ value: [] }));
    const groups = await listAzureTestResources(context);
    expect(groups.map(group => group.name)).toEqual([
      `${AZURE_TEST_RESOURCE_PREFIX}run`,
      `${AZURE_TEST_RESOURCE_PREFIX}run-nodes`,
    ]);
    expect(groups[0].resources[0].name).toBe('test-identity');
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});
