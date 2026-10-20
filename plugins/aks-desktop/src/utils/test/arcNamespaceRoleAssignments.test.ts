// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockRun = vi.fn();

vi.mock('../azure/az-cli-core', () => ({
  runCommandAsync: (...args: any[]) => mockRun(...args),
  debugLog: () => {},
  isAzError: (s: string) => s.includes('ERROR'),
  needsRelogin: (s: string) => s.includes('az login'),
}));

import { listNamespaceRoleAssignments } from '../azure/az-namespace-access';

const SUB = 'e049fcf1-c84b-4de4-ba9a-a168a4cbab7a';
const ARC_SCOPE =
  `/subscriptions/${SUB}/resourceGroups/rg-bm` +
  '/providers/Microsoft.Kubernetes/connectedClusters/bm-cluster/namespaces/proj';

describe('listNamespaceRoleAssignments on an Arc cluster', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockRun.mockResolvedValue({ stdout: '[]', stderr: '' });
  });

  const call = (overrides = {}) =>
    listNamespaceRoleAssignments({
      clusterName: 'bm-cluster',
      resourceGroup: 'rg-bm',
      namespaceName: 'proj',
      subscriptionId: SUB,
      isArcCluster: true,
      ...overrides,
    });

  test('constructs a connectedClusters namespace scope', async () => {
    await call();
    const args = mockRun.mock.calls[0][1];
    expect(args[args.indexOf('--scope') + 1]).toBe(ARC_SCOPE);
  });

  test('never calls `az aks namespace show` — Arc has no namespace resource', async () => {
    await call();
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][1].slice(0, 3)).toEqual(['role', 'assignment', 'list']);
  });

  test('fails clearly without a subscription, which the scope requires', async () => {
    await expect(call({ subscriptionId: undefined })).resolves.toMatchObject({
      success: false,
      error: 'Missing subscription for Arc cluster',
    });
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('returns the parsed assignments', async () => {
    mockRun.mockResolvedValue({
      stdout: JSON.stringify([
        {
          principalName: 'someone@contoso.com',
          principalType: 'User',
          roleDefinitionName: 'Azure Arc Kubernetes Writer',
          scope: ARC_SCOPE,
        },
      ]),
      stderr: '',
    });
    await expect(call()).resolves.toMatchObject({
      success: true,
      assignments: [{ roleDefinitionName: 'Azure Arc Kubernetes Writer', principalType: 'User' }],
    });
  });

  test('managed AKS still resolves the namespace resource first', async () => {
    mockRun
      .mockResolvedValueOnce({ stdout: '/subscriptions/x/managedNamespace-id', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' });
    await listNamespaceRoleAssignments({
      clusterName: 'aks',
      resourceGroup: 'rg',
      namespaceName: 'proj',
      subscriptionId: SUB,
    });
    expect(mockRun.mock.calls[0][1].slice(0, 3)).toEqual(['aks', 'namespace', 'show']);
    const roleArgs = mockRun.mock.calls[1][1];
    expect(roleArgs[roleArgs.indexOf('--scope') + 1]).toBe('/subscriptions/x/managedNamespace-id');
  });
});
