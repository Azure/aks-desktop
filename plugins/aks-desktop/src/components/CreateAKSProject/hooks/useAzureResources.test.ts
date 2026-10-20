// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetClusters = vi.hoisted(() => vi.fn());
const mockGetConnectedClusters = vi.hoisted(() => vi.fn());
const mockGetClusterCount = vi.hoisted(() => vi.fn());
const mockIsExtensionInstalled = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/azure/az-clusters', () => ({
  getClusters: mockGetClusters,
  getConnectedClusters: mockGetConnectedClusters,
}));
vi.mock('../../../utils/azure/az-resource-graph', () => ({
  getClusterCount: mockGetClusterCount,
}));
vi.mock('../../../utils/azure/az-extensions', () => ({
  isExtensionInstalled: mockIsExtensionInstalled,
}));
vi.mock('../../../utils/azure/az-subscriptions', () => ({
  getSubscriptions: vi.fn(),
}));

import { useAzureResources } from './useAzureResources';

describe('useAzureResources', () => {
  beforeEach(() => {
    mockGetClusters.mockResolvedValue([
      {
        name: 'managed',
        resourceGroup: 'rg-managed',
        status: 'Succeeded',
      },
    ]);
    mockGetConnectedClusters.mockResolvedValue([]);
    mockGetClusterCount.mockResolvedValue(1);
    mockIsExtensionInstalled.mockResolvedValue({ installed: false });
  });

  it('preserves managed clusters and reports unavailable Arc discovery', async () => {
    const { result } = renderHook(() => useAzureResources());

    await act(async () => {
      await result.current.fetchClusters('subscription-id');
    });

    expect(result.current.clusters).toEqual([
      expect.objectContaining({ name: 'managed', clusterType: 'aks' }),
    ]);
    expect(result.current.arcDiscoveryUnavailable).toBe(true);
    expect(mockIsExtensionInstalled).toHaveBeenCalledWith('connectedk8s');
  });
});
