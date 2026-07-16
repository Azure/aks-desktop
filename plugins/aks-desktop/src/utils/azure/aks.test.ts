// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetClusters = vi.hoisted(() => vi.fn());
const mockGetConnectedClusters = vi.hoisted(() => vi.fn());

vi.mock('./az-clusters', () => ({
  getClusters: mockGetClusters,
  getConnectedClusters: mockGetConnectedClusters,
}));

vi.mock('./az-subscriptions', () => ({
  getSubscriptions: vi.fn(),
}));

import { getAKSClusters } from './aks';

describe('getAKSClusters — merges AKS and AKS Hybrid & Edge clusters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('tags managed clusters as aks and connected clusters as aksarc', async () => {
    mockGetClusters.mockResolvedValue([
      {
        name: 'managed',
        resourceGroup: 'rg1',
        location: 'eastus',
        version: '1.30',
        status: 'Succeeded',
      },
    ]);
    mockGetConnectedClusters.mockResolvedValue([
      {
        name: 'aks-hybrid-edge',
        resourceGroup: 'rg2',
        location: 'westus',
        version: '1.29',
        status: 'Connected',
        clusterType: 'aksarc',
      },
    ]);

    const result = await getAKSClusters('sub-1');
    expect(result.success).toBe(true);
    expect(result.clusters).toHaveLength(2);

    const managed = result.clusters!.find(c => c.name === 'managed');
    const hybridEdge = result.clusters!.find(c => c.name === 'aks-hybrid-edge');
    expect(managed?.clusterType).toBe('aks');
    expect(hybridEdge?.clusterType).toBe('aksarc');
  });

  test('an AKS Hybrid & Edge discovery failure never breaks the AKS list (review bug #1)', async () => {
    mockGetClusters.mockResolvedValue([
      {
        name: 'managed',
        resourceGroup: 'rg1',
        location: 'eastus',
        version: '1.30',
        status: 'Succeeded',
      },
    ]);
    mockGetConnectedClusters.mockRejectedValue(new Error('connectedk8s exploded'));

    const result = await getAKSClusters('sub-1');
    expect(result.success).toBe(true);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters![0].name).toBe('managed');
    expect(result.clusters![0].clusterType).toBe('aks');
  });

  test('propagates a failure when the AKS list itself fails', async () => {
    mockGetClusters.mockRejectedValue(new Error('az aks list failed'));
    mockGetConnectedClusters.mockResolvedValue([]);

    const result = await getAKSClusters('sub-1');
    expect(result.success).toBe(false);
    expect(result.message).toContain('az aks list failed');
  });
});
