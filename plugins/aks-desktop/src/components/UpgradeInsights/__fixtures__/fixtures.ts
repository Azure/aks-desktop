// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { vi } from 'vitest';
import type { Cluster, Insight, InsightsProvider } from '../../../types/upgradeInsights';

export const cluster: Cluster = {
  id: '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/cluster',
  name: 'cluster',
  subscription: '00000000-0000-0000-0000-000000000001',
  resourceGroup: 'rg',
  location: 'eastus',
  kubernetesVersion: '1.33.4',
  poolInventoryKnown: true,
  pools: [
    { name: 'system', version: '1.33.4', nodeImageVersion: 'image-old' },
    { name: 'workloads', version: '1.33.4', nodeImageVersion: 'image-old' },
  ],
};

export function passed(): Insight {
  const time = new Date(Date.now() - 60_000).toISOString();
  return {
    name: 'controlPlaneAndAgentPools',
    id: `${cluster.id}/upgradeInsights/controlPlaneAndAgentPools`,
    properties: {
      upgradeType: 'ControlPlaneAndAgentPools',
      provisioningState: 'Succeeded',
      lastEvaluatedAt: time,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      targetKubernetesVersion: '1.34.2',
      controlPlane: {
        currentKubernetesVersion: cluster.kubernetesVersion,
        evaluation: { status: 'Passed', evaluatedAt: time },
      },
      agentPools: cluster.pools.map(pool => ({
        agentPoolName: pool.name,
        currentKubernetesVersion: pool.version,
        evaluation: { status: 'Passed', evaluatedAt: time },
      })),
    },
  };
}

export function provider(overrides: Partial<InsightsProvider> = {}): InsightsProvider {
  return {
    mode: 'live',
    invalidateInsights: vi.fn(),
    listClusters: vi
      .fn()
      .mockResolvedValue({ clusters: [cluster], warnings: [], fleetWarnings: [] }),
    listInsights: vi.fn().mockResolvedValue([passed()]),
    getInsight: vi.fn().mockResolvedValue(passed()),
    listUpgradeTargets: vi.fn().mockResolvedValue(['1.34.2']),
    generate: vi.fn().mockResolvedValue(passed()),
    ...overrides,
  };
}

export function translate(text: string, values?: Record<string, unknown>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? ''));
}
