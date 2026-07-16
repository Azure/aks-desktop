// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockRunCommandAsync = vi.hoisted(() => vi.fn());

// `getConnectedClusters` runs `az connectedk8s list` through the shared command
// runner; mock it so we can feed representative discovery output.
vi.mock('../shared/runCommandAsync', () => ({
  runCommandAsync: mockRunCommandAsync,
}));

import { getConnectedClusters } from './az-clusters';

// A realistic `az connectedk8s list` payload mixing AKS-Arc (kind
// "ProvisionedCluster") and generic Arc clusters (kind null).
const LIST_OUTPUT = [
  {
    name: 'santhosh-new-bm-aks',
    resourceGroup: 'santhosh-new-bm-aks',
    kind: 'ProvisionedCluster',
    distribution: 'aks_workload',
    infrastructure: 'BareMetalLinux',
    connectivityStatus: 'Connected',
  },
  {
    name: 'onpremk8s05',
    resourceGroup: 'rg-generic',
    kind: null,
    distribution: 'kind',
    infrastructure: 'generic',
    connectivityStatus: 'Connected',
  },
  {
    name: '37068816-5842-439f-9488-287464ea1d03',
    resourceGroup: 'rg-hci',
    kind: null,
    distribution: '',
    infrastructure: 'azure_stack_hci',
    connectivityStatus: 'Connected',
  },
];

describe('getConnectedClusters — only AKS-Arc (ProvisionedCluster) clusters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns only clusters with kind "ProvisionedCluster", tagged aksarc', async () => {
    mockRunCommandAsync.mockResolvedValue({ stdout: JSON.stringify(LIST_OUTPUT), stderr: '' });

    const result = await getConnectedClusters('sub-a');

    expect(result.map(c => c.name)).toEqual(['santhosh-new-bm-aks']);
    expect(result[0].clusterType).toBe('aksarc');
    // Generic Arc clusters (kind null) are excluded entirely.
    expect(result.some(c => c.name === 'onpremk8s05')).toBe(false);
  });

  test('returns an empty list when only generic Arc clusters are present', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stdout: JSON.stringify(LIST_OUTPUT.filter(c => c.kind !== 'ProvisionedCluster')),
      stderr: '',
    });

    const result = await getConnectedClusters('sub-a');
    expect(result).toEqual([]);
  });

  test('is resilient: returns empty on a failed/empty connectedk8s call', async () => {
    mockRunCommandAsync.mockResolvedValue({ stdout: '', stderr: 'ERROR: extension missing' });
    const result = await getConnectedClusters('sub-a');
    expect(result).toEqual([]);
  });
});
