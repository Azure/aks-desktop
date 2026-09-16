// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Typography } from '@mui/material';
import React from 'react';
import type { DeploymentInfo } from '../hooks/useDeployments';
import type { HPAInfo } from '../hooks/useHPAInfo';

interface ScalingMetricsProps {
  /** Name of the currently selected deployment. */
  selectedDeployment: string;
  /** Full list of deployments (used to look up replica counts for the selected deployment). */
  deployments: DeploymentInfo[];
  /** Current HPA state, or null if the deployment is not HPA-managed. */
  hpaInfo: HPAInfo | null;
}

function MetricTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: '5rem', flex: '1 1 5rem' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body1" fontWeight="bold">
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Displays scaling metrics overview (mode, replica count, bounds, CPU usage).
 *
 * Labels and values adapt based on whether an HPA is active:
 * - Scaling mode shows an icon (HPA autorenew vs manual account)
 * - Replica label switches between "Desired Replicas" and "Configured Replicas"
 * - Bounds label switches between "Replica Bounds" and "Available Replicas"
 * - CPU shows "current% / target%" for HPA, "N/A" for manual
 */
export const ScalingMetrics: React.FC<ScalingMetricsProps> = ({
  selectedDeployment,
  deployments,
  hpaInfo,
}) => {
  const { t } = useTranslation();
  const currentDeployment = deployments.find(d => d.name === selectedDeployment);

  const cpuValue =
    hpaInfo?.currentCPUUtilization !== undefined && hpaInfo?.targetCPUUtilization !== undefined
      ? `${hpaInfo.currentCPUUtilization}% / ${hpaInfo.targetCPUUtilization}%`
      : 'N/A';

  const boundsValue = hpaInfo
    ? hpaInfo.minReplicas !== undefined && hpaInfo.maxReplicas !== undefined
      ? `${hpaInfo.minReplicas}-${hpaInfo.maxReplicas}`
      : 'N/A'
    : currentDeployment?.availableReplicas ?? 'N/A';

  return (
    <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {/* Scaling Mode */}
      <Box sx={{ minWidth: '5rem', flex: '1 1 5rem' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {t('Scaling Mode')}
        </Typography>
        <Box display="flex" alignItems="center" gap={0.5}>
          <Icon
            icon={hpaInfo ? 'mdi:autorenew' : 'mdi:account'}
            style={{ fontSize: 18, flexShrink: 0, color: hpaInfo ? '#66BB6A' : '#42A5F5' }}
            aria-hidden="true"
          />
          <Typography variant="body1" fontWeight="bold">
            {hpaInfo ? 'HPA' : t('Manual')}
          </Typography>
        </Box>
      </Box>

      <MetricTile
        label={t('Current Replicas')}
        value={hpaInfo?.currentReplicas ?? currentDeployment?.readyReplicas ?? 'N/A'}
      />
      <MetricTile
        label={hpaInfo ? t('Desired Replicas') : t('Configured Replicas')}
        value={hpaInfo?.desiredReplicas ?? currentDeployment?.replicas ?? 'N/A'}
      />
      <MetricTile
        label={hpaInfo ? t('Replica Bounds') : t('Available Replicas')}
        value={boundsValue}
      />
      <MetricTile label={hpaInfo ? t('CPU Usage / Target') : t('CPU Usage')} value={cpuValue} />
    </Box>
  );
};
