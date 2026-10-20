// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClustersViaGraph: vi.fn(),
  runAzCommand: vi.fn(),
  runCommandAsync: vi.fn(),
}));

vi.mock('./az-cli-core', () => ({
  debugLog: vi.fn(),
  isAzError: () => false,
  needsRelogin: () => false,
  runAzCommand: mocks.runAzCommand,
  runCommandAsync: mocks.runCommandAsync,
}));

vi.mock('./az-resource-graph', () => ({
  getClusterResourceGroupViaGraph: vi.fn(),
  getClustersViaGraph: mocks.getClustersViaGraph,
}));

vi.mock('./az-subscriptions', () => ({ getSubscriptions: vi.fn() }));

import { getClusters, getConnectedClusters } from './az-clusters';

describe('getClusters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  test('preserves the AAD profile from the CLI fallback', async () => {
    mocks.getClustersViaGraph.mockRejectedValue(new Error('graph unavailable'));
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify([
        {
          name: 'cluster-1',
          resourceGroup: 'rg-1',
          location: 'eastus',
          kubernetesVersion: '1.32.0',
          provisioningState: 'Succeeded',
          aadProfile: { enableAzureRbac: true },
        },
      ]),
      stderr: '',
    });

    await expect(getClusters('sub-1')).resolves.toEqual([
      expect.objectContaining({ aadProfile: { enableAzureRbac: true } }),
    ]);
  });
});

describe('getConnectedClusters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns only ProvisionedCluster resources tagged as aksarc', async () => {
    mocks.runAzCommand.mockResolvedValue({
      success: true,
      data: [
        {
          name: 'hybrid-edge',
          resourceGroup: 'arc-rg',
          kind: 'ProvisionedCluster',
          connectivityStatus: 'Connected',
        },
        {
          name: 'generic-arc',
          resourceGroup: 'generic-rg',
          kind: null,
          connectivityStatus: 'Connected',
        },
      ],
    });

    await expect(getConnectedClusters('sub-1')).resolves.toEqual([
      expect.objectContaining({
        name: 'hybrid-edge',
        clusterType: 'aksarc',
        connectivityStatus: 'Connected',
      }),
    ]);
  });

  test('returns an empty list when connectedk8s discovery fails', async () => {
    mocks.runAzCommand.mockResolvedValue({ success: false, error: 'extension missing' });

    await expect(getConnectedClusters('sub-1')).resolves.toEqual([]);
  });
});
