// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../azure/az-http', async importOriginal => ({
  ...(await importOriginal<typeof import('../azure/az-http')>()),
  azRequest: mocks.request,
}));

import { AzureRequestError } from '../azure/az-http';
import { createLiveManagedNamespace } from './azureLiveKubernetesTestUtils';
import type { AzureLiveResourceGroup } from './azureLiveTestUtils';

const run: AzureLiveResourceGroup & { clusterName: string } = {
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  credential: {
    getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
  },
  resourceGroup: 'aksd-rest-e2e-namespace-test',
  resourceGroupId:
    '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/aksd-rest-e2e-namespace-test',
  nodeResourceGroup: 'aksd-rest-e2e-namespace-test-nodes',
  location: 'eastus2',
  runId: 'test-run',
  tags: { 'aks-desktop-test': 'rest-e2e' },
  clusterName: 'aks',
};
beforeEach(() => {
  mocks.request.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

test.each(['Keep', 'Delete'] as const)(
  'allows a two-minute initial PUT within the five-minute %s setup budget',
  async deletePolicy => {
    mocks.request
      .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
      .mockImplementationOnce(
        () => new Promise(resolve => setTimeout(() => resolve(undefined), 120_000))
      )
      .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } });
    const pending = createLiveManagedNamespace(run, 'test-ns', deletePolicy);
    await vi.advanceTimersByTimeAsync(125_000);
    expect(await pending).toBe(
      `${run.resourceGroupId}/providers/Microsoft.ContainerService/managedClusters/aks/managedNamespaces/test-ns`
    );
    expect(mocks.request.mock.calls[1][0]).toMatchObject({
      method: 'PUT',
      timeoutMs: 5 * 60_000 - 5000,
      body: { properties: { deletePolicy }, tags: run.tags },
    });
    expect(mocks.request.mock.calls[2][0].timeoutMs).toBe(3 * 60_000 - 5000);
  }
);

test.each(['Failed', 'Canceled', 'Cancelled'])('surfaces terminal setup state %s', async state => {
  mocks.request
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({
      properties: { provisioningState: state },
    });
  const pending = expect(createLiveManagedNamespace(run, 'test-ns', 'Keep')).rejects.toThrow(state);
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(mocks.request).toHaveBeenCalledTimes(3);
});

test('rejects invalid names before resource operations', async () => {
  await expect(createLiveManagedNamespace(run, '../other', 'Keep')).rejects.toThrow('Invalid');
  expect(mocks.request).not.toHaveBeenCalled();
});

test('polls pending setup without resetting the original five-minute budget', async () => {
  mocks.request
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ properties: { provisioningState: 'Creating' } })
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } });
  const pending = createLiveManagedNamespace(run, 'test-ns', 'Keep');
  await vi.advanceTimersByTimeAsync(6000);
  await pending;
  expect(mocks.request.mock.calls[3][0].timeoutMs).toBe(5 * 60_000 - 6000);
  expect(mocks.request).toHaveBeenCalledTimes(4);
});

test('stops polling when the setup deadline is exhausted', async () => {
  const started = Date.now();
  mocks.request
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(async () => {
      vi.setSystemTime(started + 5 * 60_000);
      return { properties: { provisioningState: 'Creating' } };
    });
  const pending = expect(createLiveManagedNamespace(run, 'test-ns', 'Keep')).rejects.toThrow(
    'timed out'
  );
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(mocks.request).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

test('waits for parent Updating to finish before sending any namespace PUT', async () => {
  mocks.request
    .mockResolvedValueOnce({ properties: { provisioningState: 'Updating' } })
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } });
  const pending = createLiveManagedNamespace(run, 'test-ns', 'Keep');
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(mocks.request.mock.calls.map(([request]) => request.method ?? 'GET')).toEqual([
    'GET',
    'GET',
    'PUT',
    'GET',
  ]);
  expect(mocks.request.mock.calls[2][0].timeoutMs).toBe(5 * 60_000 - 10_000);
});

test('retries only a server-rejected Updating race after another parent-readiness check', async () => {
  mocks.request
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
    .mockRejectedValueOnce(
      new AzureRequestError('The managed cluster aks is in Updating state', {
        status: 400,
        code: 'BadRequest',
      })
    )
    .mockResolvedValueOnce({ properties: { provisioningState: 'Updating' } })
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } });
  const pending = createLiveManagedNamespace(run, 'test-ns', 'Keep');
  await vi.advanceTimersByTimeAsync(15_000);
  await pending;
  expect(mocks.request.mock.calls.map(([request]) => request.method ?? 'GET')).toEqual([
    'GET',
    'PUT',
    'GET',
    'GET',
    'PUT',
    'GET',
  ]);
  expect(mocks.request.mock.calls[4][0].timeoutMs).toBe(5 * 60_000 - 15_000);
  expect(mocks.request.mock.calls[4][0].body).toEqual(mocks.request.mock.calls[1][0].body);
});

test.each([
  { status: 400, code: 'BadRequest', message: 'invalid quota' },
  { status: 400, code: 'BadRequest', message: 'The managed cluster aks is not in Updating state' },
  { status: 403, code: 'AuthorizationFailed', message: 'denied' },
  { status: undefined, code: undefined, message: 'Azure request failed before a response' },
])('does not replay unknown/other rejected writes: %j', async details => {
  const error = new AzureRequestError(details.message, details);
  mocks.request
    .mockResolvedValueOnce({ properties: { provisioningState: 'Succeeded' } })
    .mockRejectedValueOnce(error);
  const pending = expect(createLiveManagedNamespace(run, 'test-ns', 'Keep')).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(mocks.request).toHaveBeenCalledTimes(2);
});

test('fails before a namespace PUT when the parent reports a terminal failure', async () => {
  mocks.request.mockResolvedValueOnce({
    properties: {
      provisioningState: 'Failed',
      status: { provisioningError: { message: 'parent failed' } },
    },
  });
  const pending = expect(createLiveManagedNamespace(run, 'test-ns', 'Keep')).rejects.toThrow(
    'parent failed'
  );
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

test('bounds an indefinitely Updating parent without issuing a namespace write', async () => {
  mocks.request.mockResolvedValue({ properties: { provisioningState: 'Updating' } });
  const pending = expect(createLiveManagedNamespace(run, 'test-ns', 'Keep')).rejects.toThrow(
    'Timed out waiting'
  );
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  await pending;
  expect(mocks.request.mock.calls.every(([request]) => request.method !== 'PUT')).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
