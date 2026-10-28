// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, createTheme, ThemeProvider } from '@mui/material';
import type { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { Cluster, ClusterRecord, Insight } from '../../types/upgradeInsights';
import InventoryTable from './InventoryTable';

export default {
  title: 'UpgradeInsights/ReadinessInventory',
  component: InventoryTable,
} as Meta<typeof InventoryTable>;

function StoryInventory({ dark = false }: { dark?: boolean }) {
  const { t } = useTranslation();
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
    pools: [{ name: 'system', version: '1.33.4' }],
  };
  const ready: Insight = {
    name: 'controlPlaneAndAgentPools',
    properties: {
      upgradeType: 'ControlPlaneAndAgentPools',
      provisioningState: 'Succeeded',
      targetKubernetesVersion: '1.34.2',
      lastEvaluatedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 3_600_000).toISOString(),
      controlPlane: {
        currentKubernetesVersion: '1.33.4',
        evaluation: { status: 'Passed', evaluatedAt: new Date(now - 60_000).toISOString() },
      },
      agentPools: [
        {
          agentPoolName: 'system',
          currentKubernetesVersion: '1.33.4',
          evaluation: { status: 'Passed', evaluatedAt: new Date(now - 60_000).toISOString() },
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
          evaluatedAt: new Date(now - 60_000).toISOString(),
          detectedIssues: [{ issueType: 'PDBConstraint', severity: 'Blocking' }],
        },
      },
    },
  };
  const records: ClusterRecord[] = [
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
      error: t('Forbidden (Storybook fixture)'),
    },
  ];
  return (
    <ThemeProvider theme={createTheme({ palette: { mode: dark ? 'dark' : 'light' } })}>
      <Box sx={{ p: 3, bgcolor: 'background.default', color: 'text.primary' }}>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('Storybook visual fixtures only. No Azure requests or credentials are used.')}
        </Alert>
        <InventoryTable records={records} disabled={false} onSelect={() => {}} />
      </Box>
    </ThemeProvider>
  );
}

export const Light: StoryFn = () => <StoryInventory />;
export const Dark: StoryFn = () => <StoryInventory dark />;
