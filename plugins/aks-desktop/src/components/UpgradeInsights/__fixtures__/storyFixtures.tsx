// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box } from '@mui/material';
import React from 'react';
import type {
  Cluster,
  ClusterRecord,
  Insight,
  InsightsProvider,
} from '../../../types/upgradeInsights';

export function StoryFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 3, bgcolor: 'background.default', color: 'text.primary' }}>
      <Alert severity="info" sx={{ mb: 2 }}>
        {t('Storybook visual fixtures only. No Azure requests or credentials are used.')}
      </Alert>
      {children}
    </Box>
  );
}

export function storyRecords(): ClusterRecord[] {
  const now = Date.now();
  const cluster: Cluster = {
    id: '/subscriptions/storybook/resourceGroups/visual-review/providers/Microsoft.ContainerService/managedClusters/payments',
    name: 'payments',
    subscription: 'storybook',
    resourceGroup: 'visual-review',
    location: 'eastus',
    kubernetesVersion: '1.33.4',
    poolInventoryKnown: true,
    fleetMembershipKnown: false,
    pools: [{ name: 'system', version: '1.33.4', nodeImageVersion: 'image-old' }],
  };
  const evaluatedAt = new Date(now - 60_000).toISOString();
  const ready: Insight = {
    name: 'controlPlaneAndAgentPools',
    properties: {
      upgradeType: 'ControlPlaneAndAgentPools',
      provisioningState: 'Succeeded',
      targetKubernetesVersion: '1.34.2',
      lastEvaluatedAt: evaluatedAt,
      expiresAt: new Date(now + 3_600_000).toISOString(),
      controlPlane: {
        currentKubernetesVersion: '1.33.4',
        evaluation: { status: 'Passed', evaluatedAt },
      },
      agentPools: [
        {
          agentPoolName: 'system',
          currentKubernetesVersion: '1.33.4',
          evaluation: { status: 'Passed', evaluatedAt },
        },
      ],
    },
  };
  const blocked: Insight = {
    ...ready,
    properties: {
      ...ready.properties,
      controlPlane: {
        ...ready.properties.controlPlane,
        evaluation: {
          status: 'Failed',
          evaluatedAt,
          detectedIssues: [
            {
              issueType: 'PDBConstraint',
              severity: 'Blocking',
              message: 'A workload disruption budget prevents draining.',
              impactedResources: [
                { kind: 'PodDisruptionBudget', namespace: 'payments', name: 'api-budget' },
              ],
              recommendedActions: [
                {
                  title: 'Review workload disruption budgets',
                  details: 'Inspect replica availability before changing the disruption policy.',
                  documentationLink:
                    'https://learn.microsoft.com/azure/aks/operator-best-practices-scheduler',
                },
              ],
            },
          ],
        },
      },
    },
  };
  return [
    { cluster, insights: [blocked] },
    { cluster: { ...cluster, id: `${cluster.id}-ready`, name: 'search' }, insights: [ready] },
    {
      cluster: { ...cluster, id: `${cluster.id}-expired`, name: 'inventory' },
      insights: [
        {
          ...ready,
          properties: { ...ready.properties, expiresAt: new Date(now - 1).toISOString() },
        },
      ],
    },
    {
      cluster: { ...cluster, id: `${cluster.id}-denied`, name: 'restricted' },
      insights: [],
      error: 'Forbidden (Storybook fixture)',
    },
  ];
}

export function storyProvider(
  records: ClusterRecord[],
  overrides: Partial<InsightsProvider> = {}
): InsightsProvider {
  return {
    mode: 'demo',
    invalidateInsights: () => {},
    listClusters: async () => ({
      clusters: records.map(record => record.cluster),
      warnings: [],
      fleetWarnings: [],
    }),
    listInsights: async cluster => {
      const record = records.find(record => record.cluster.id === cluster.id);
      if (!record) throw new Error('Cluster is absent from the Storybook fixture');
      if (record.error) throw new Error(record.error);
      return record.insights;
    },
    getInsight: async (cluster, id) => {
      const insight = records
        .find(record => record.cluster.id === cluster.id)
        ?.insights.find(insight => insight.id === id);
      if (!insight) throw new Error('Insight is absent from the Storybook fixture');
      return insight;
    },
    listUpgradeTargets: async () => ['1.34.2'],
    generate: async (cluster, request) => {
      const ready = storyRecords()[1].insights[0];
      const poolName = 'agentPoolName' in request ? request.agentPoolName : undefined;
      const name = `${request.upgradeType}-${poolName ?? 'cluster'}`;
      const insight: Insight = {
        name,
        id: `${cluster.id}/upgradeInsights/${name}`,
        properties: {
          ...ready.properties,
          ...request,
          targetKubernetesVersion:
            request.upgradeType === 'NodeImage' ? undefined : request.targetKubernetesVersion,
          targetNodeImageVersion:
            request.upgradeType === 'NodeImage'
              ? request.targetNodeImageVersion ?? 'image-new'
              : undefined,
          currentKubernetesVersion: cluster.kubernetesVersion,
          currentNodeImageVersion: cluster.pools.find(pool => pool.name === poolName)
            ?.nodeImageVersion,
          controlPlane:
            request.upgradeType === 'ControlPlaneAndAgentPools'
              ? ready.properties.controlPlane
              : undefined,
          agentPools:
            request.upgradeType === 'ControlPlaneAndAgentPools'
              ? ready.properties.agentPools
              : undefined,
          evaluation: ready.properties.controlPlane?.evaluation,
        },
      };
      const record = records.find(record => record.cluster.id === cluster.id);
      if (!record) throw new Error('Cluster is absent from the Storybook fixture');
      record.insights = [insight, ...record.insights.filter(item => item.name !== name)];
      return insight;
    },
    ...overrides,
  };
}
