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

import { getClustersViaGraph } from './az-resource-graph';

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
