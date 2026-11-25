// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createManagedNamespace } from './az-namespaces';

const command = vi.hoisted(() => vi.fn());
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: command }));

const options = {
  subscriptionId: '11111111-2222-3333-4444-555555555555',
  resourceGroup: 'my group',
  clusterName: 'aks',
  namespaceName: 'project',
  cpuRequest: 250,
  cpuLimit: 1500,
  memoryRequest: 128,
  memoryLimit: 1536,
  credential: {
    getToken: async () => ({ token: 'token', expiresOnTimestamp: Date.now() + 60_000 }),
  },
  endpoint: 'https://management.example.test',
};
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const cluster = () => json({ location: 'eastus2', properties: {} });
const state = (provisioningState: string) => json({ properties: { provisioningState } });
const accepted = () => new Response(null, { status: 202 });
const methods = () => fetchMock.mock.calls.map(([, init]) => init?.method);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(command).not.toHaveBeenCalled();
});

test('writes the parent location, project metadata, quotas and policies to the named namespace', async () => {
  const labels = {
    'headlamp.dev/project-id': 'project',
    'headlamp.dev/project-managed-by': 'aks-desktop',
    'aks-desktop/project-subscription': options.subscriptionId,
    'aks-desktop/project-resource-group': 'rg',
  };
  const annotations = { 'example.com/owner': 'team=a' };
  fetchMock.mockResolvedValueOnce(cluster()).mockResolvedValueOnce(state('Succeeded'));
  expect(
    await createManagedNamespace({
      ...options,
      labels,
      annotations,
      ingressPolicy: 'DenyAll',
      egressPolicy: 'AllowSameNamespace',
    })
  ).toEqual({ success: true, stdout: '', stderr: '' });
  const parent = `${options.endpoint}/subscriptions/${options.subscriptionId}/resourceGroups/my%20group/providers/Microsoft.ContainerService/managedClusters/aks`;
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    `${parent}?api-version=2026-01-01`,
    `${parent}/managedNamespaces/project?api-version=2026-01-01`,
  ]);
  expect(methods()).toEqual(['GET', 'PUT']);
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
    location: 'eastus2',
    properties: {
      labels,
      annotations,
      adoptionPolicy: 'Never',
      deletePolicy: 'Keep',
      defaultNetworkPolicy: { ingress: 'DenyAll', egress: 'AllowSameNamespace' },
      defaultResourceQuota: {
        cpuRequest: '250m',
        cpuLimit: '1500m',
        memoryRequest: '128Mi',
        memoryLimit: '1536Mi',
      },
    },
  });
});

test('uses CLI defaults and retries only reads while the namespace becomes visible', async () => {
  fetchMock
    .mockResolvedValueOnce(cluster())
    .mockResolvedValueOnce(accepted())
    .mockResolvedValueOnce(json({ error: { code: 'ResourceNotFound' } }, 404))
    .mockResolvedValueOnce(json({}, 503))
    .mockResolvedValueOnce(state('Creating'))
    .mockResolvedValueOnce(state('Succeeded'));
  const result = createManagedNamespace(options);
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ success: true });
  expect(methods()).toEqual(['GET', 'PUT', 'GET', 'GET', 'GET', 'GET']);
  const [[target]] = fetchMock.mock.calls.slice(1);
  expect(fetchMock.mock.calls.slice(2).every(([url]) => String(url) === String(target))).toBe(true);
  expect(
    JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).properties.defaultNetworkPolicy
  ).toEqual({ ingress: 'AllowSameNamespace', egress: 'AllowAll' });
});

test.each(['Failed', 'Canceled', 'Cancelled'])(
  'stops polling when ARM reports %s',
  async terminal => {
    fetchMock
      .mockResolvedValueOnce(cluster())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(state(terminal));
    const result = createManagedNamespace(options);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({
      success: false,
      error: expect.stringContaining(terminal.toLowerCase()),
    });
    expect(methods()).toEqual(['GET', 'PUT', 'GET']);
  }
);

test('surfaces an ambiguous write failure without replaying the PUT', async () => {
  fetchMock
    .mockResolvedValueOnce(cluster())
    .mockResolvedValueOnce(json({ error: { code: 'ServiceUnavailable' } }, 503));
  const result = createManagedNamespace(options);
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({
    success: false,
    error: expect.stringContaining('ServiceUnavailable'),
  });
  expect(methods()).toEqual(['GET', 'PUT']);
});

test.each([
  ['ResourceGroupNotFound', 404],
  ['AuthorizationFailed', 403],
] as const)('does not treat %s as namespace propagation', async (code, status) => {
  fetchMock
    .mockResolvedValueOnce(cluster())
    .mockResolvedValueOnce(accepted())
    .mockResolvedValueOnce(json({ error: { code } }, status));
  const result = createManagedNamespace(options);
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ success: false, error: expect.stringContaining(code) });
  expect(methods()).toEqual(['GET', 'PUT', 'GET']);
});

test('stops waiting when the wizard cancels an accepted create', async () => {
  fetchMock.mockResolvedValueOnce(cluster()).mockResolvedValueOnce(accepted());
  const controller = new AbortController();
  const result = createManagedNamespace({ ...options, signal: controller.signal });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(new Error('Wizard closed'));
  expect(await result).toMatchObject({
    success: false,
    error: expect.stringContaining('Wizard closed'),
  });
  expect(methods()).toEqual(['GET', 'PUT']);
  expect(vi.getTimerCount()).toBe(0);
});

test('bounds all status reads by one deadline', async () => {
  fetchMock
    .mockResolvedValueOnce(cluster())
    .mockResolvedValueOnce(accepted())
    .mockImplementation(async () => state('Creating'));
  const result = createManagedNamespace({ ...options, timeoutMs: 2500 });
  await vi.advanceTimersByTimeAsync(2500);
  expect(await result).toMatchObject({
    success: false,
    error: expect.stringContaining('timed out'),
  });
  expect(methods()).toEqual(['GET', 'PUT', 'GET', 'GET']);
  expect(vi.getTimerCount()).toBe(0);
});

test('does not write when the parent cluster has no location', async () => {
  fetchMock.mockResolvedValueOnce(json({ properties: {} }));
  expect(await createManagedNamespace(options)).toMatchObject({
    success: false,
    error: expect.stringContaining('location'),
  });
  expect(methods()).toEqual(['GET']);
});
