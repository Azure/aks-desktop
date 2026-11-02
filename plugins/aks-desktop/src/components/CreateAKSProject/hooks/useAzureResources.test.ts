// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetClusters = vi.hoisted(() => vi.fn());
const mockGetConnectedClusters = vi.hoisted(() => vi.fn());
const mockGetClusterCount = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/azure/az-clusters', () => ({
  getClusters: mockGetClusters,
  getConnectedClusters: mockGetConnectedClusters,
}));
vi.mock('../../../utils/azure/az-resource-graph', () => ({
  getClusterCount: mockGetClusterCount,
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
    mockGetConnectedClusters.mockResolvedValue({ clusters: [] });
    mockGetClusterCount.mockResolvedValue(1);
  });

  it('preserves managed clusters and reports the Arc discovery error', async () => {
    mockGetConnectedClusters.mockResolvedValue({ clusters: [], error: 'AuthorizationFailed' });
    const { result } = renderHook(() => useAzureResources());

    await act(async () => {
      await result.current.fetchClusters('subscription-id');
    });

    expect(result.current.clusters).toEqual([
      expect.objectContaining({ name: 'managed', clusterType: 'aks' }),
    ]);
    expect(result.current.arcDiscoveryUnavailable).toBe('AuthorizationFailed');
  });

  it('adds AKS Hybrid & Edge clusters and counts them in the total', async () => {
    mockGetConnectedClusters.mockResolvedValue({
      clusters: [
        {
          name: 'hybrid-edge',
          subscription: 'subscription-id',
          resourceGroup: 'rg-arc',
          location: 'westus',
          version: '1.31.2',
          status: 'Succeeded',
          powerState: 'Offline',
          connectivityStatus: 'Offline',
          nodeCount: 0,
          clusterType: 'aksarc',
          azureRbacEnabled: true,
        },
      ],
    });
    const { result } = renderHook(() => useAzureResources());

    await act(async () => {
      await result.current.fetchClusters('subscription-id');
    });

    expect(result.current.clusters).toEqual([
      expect.objectContaining({ name: 'managed', clusterType: 'aks' }),
      {
        name: 'hybrid-edge',
        location: 'westus',
        version: '1.31.2',
        nodeCount: 0,
        status: 'Succeeded',
        resourceGroup: 'rg-arc',
        powerState: 'Offline',
        clusterType: 'aksarc',
        connectivityStatus: 'Offline',
        azureRbacEnabled: true,
      },
    ]);
    expect(result.current.totalClusterCount).toBe(2);
    expect(result.current.arcDiscoveryUnavailable).toBeNull();
  });
});
