// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCommandAsync: vi.fn(),
}));

vi.mock('./az-cli-core', () => ({
  debugLog: vi.fn(),
  isAzError: () => false,
  isValidGuid: () => true,
  needsRelogin: () => false,
  runCommandAsync: mocks.runCommandAsync,
}));

import { getClusterResourceGroupViaGraph, getClustersViaGraph } from './az-resource-graph';

const SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';

function queryOf(): string {
  return (mocks.runCommandAsync.mock.calls[0][1] as string[]).join(' ');
}

describe('getClustersViaGraph', () => {
  beforeEach(() => vi.clearAllMocks());

  test('preserves the explicit Azure RBAC value', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        data: [
          {
            name: 'rbac-enabled',
            resourceGroup: 'rg-1',
            location: 'eastus',
            version: '1.32.0',
            status: 'Succeeded',
            powerState: 'Running',
            nodeCount: 3,
            azureRbacEnabled: true,
          },
          {
            name: 'rbac-disabled',
            resourceGroup: 'rg-2',
            location: 'westus',
            version: '1.31.0',
            status: 'Succeeded',
            powerState: 'Running',
            nodeCount: 2,
            azureRbacEnabled: false,
          },
        ],
      }),
      stderr: '',
    });

    const clusters = await getClustersViaGraph('sub-1');

    expect(clusters.map(cluster => cluster.aadProfile)).toEqual([
      { enableAzureRbac: true },
      { enableAzureRbac: false },
    ]);
  });
});

describe('getClusterResourceGroupViaGraph', () => {
  beforeEach(() => vi.clearAllMocks());

  test('resolves the resource group when the name is unambiguous', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({ data: [{ resourceGroup: 'rg-a' }] }),
      stderr: '',
    });

    await expect(getClusterResourceGroupViaGraph('solo', SUBSCRIPTION_ID)).resolves.toBe('rg-a');
  });

  test('deduplicates resource groups before applying the ambiguity limit', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        data: [{ resourceGroup: 'rg-a' }, { resourceGroup: 'rg-b' }],
      }),
      stderr: '',
    });

    await expect(getClusterResourceGroupViaGraph('shared', SUBSCRIPTION_ID)).resolves.toBeNull();
    expect(queryOf()).toContain('summarize by resourceGroup');
    expect(queryOf().indexOf('summarize by resourceGroup')).toBeLessThan(
      queryOf().indexOf('| limit 2')
    );
  });

  test('restricts the query to one provider when the kind is known', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({ data: [{ resourceGroup: 'rg-b' }] }),
      stderr: '',
    });

    await expect(
      getClusterResourceGroupViaGraph('shared', SUBSCRIPTION_ID, 'aksarc')
    ).resolves.toBe('rg-b');
    expect(queryOf()).toContain('microsoft.kubernetes/connectedclusters');
    expect(queryOf()).not.toContain('microsoft.containerservice/managedclusters');
  });
});
