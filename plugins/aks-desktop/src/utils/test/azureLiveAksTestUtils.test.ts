// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../azure/az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('../azure/az-http')>()),
  azRequest: mocks.request,
}));

import { createLiveAksCluster } from './azureLiveAksTestUtils';
import type { AzureLiveResourceGroup } from './azureLiveTestUtils';

const run: AzureLiveResourceGroup = {
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  credential: {
    getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
  },
  resourceGroup: 'aksd-rest-e2e-cluster-test',
  resourceGroupId:
    '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/aksd-rest-e2e-cluster-test',
  nodeResourceGroup: 'aksd-rest-e2e-cluster-test-nodes',
  location: 'eastus2',
  runId: 'test-run',
  tags: { 'aks-desktop-test': 'rest-e2e' },
};

beforeEach(() => {
  mocks.request.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

test('allows an initial PUT beyond one minute while subtracting it from the whole setup budget', async () => {
  mocks.request
    .mockImplementationOnce(
      () => new Promise(resolve => setTimeout(() => resolve(undefined), 120_000))
    )
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } });
  const pending = createLiveAksCluster(run);
  await vi.advanceTimersByTimeAsync(125_000);
  expect(await pending).toMatchObject({ clusterName: 'aks' });
  expect(mocks.request.mock.calls[0][0]).toMatchObject({ method: 'PUT', timeoutMs: 20 * 60_000 });
  expect(mocks.request.mock.calls[1][0].timeoutMs).toBe(20 * 60_000 - 125_000);
  expect(vi.getTimerCount()).toBe(0);
});

test('surfaces terminal provisioning failure without continuing to poll', async () => {
  mocks.request.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
    properties: {
      provisioningState: 'Failed',
      status: { provisioningError: { message: 'invalid test setup' } },
    },
  });
  const pending = expect(createLiveAksCluster(run)).rejects.toThrow('invalid test setup');
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
