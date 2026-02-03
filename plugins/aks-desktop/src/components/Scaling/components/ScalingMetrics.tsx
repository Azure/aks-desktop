// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Grid, Typography } from '@mui/material';
import React from 'react';
import type { DeploymentInfo } from '../hooks/useDeployments';
import type { HPAInfo } from '../hooks/useHPAInfo';

interface ScalingMetricsProps {
  selectedDeployment: string;
  deployments: DeploymentInfo[];
  hpaInfo: HPAInfo | null;
}

/**
 * Displays scaling metrics overview (mode, replica count, bounds, CPU usage)
 */
export const ScalingMetrics: React.FC<ScalingMetricsProps> = ({
  selectedDeployment,
  deployments,
  hpaInfo,
}) => {
  const { t } = useTranslation();

  return (
    <Box sx={{ mb: 2 }}>
      <Grid container spacing={2}>
        <Grid item xs={3}>
          <Typography variant="body2" color="textSecondary" sx={{ fontSize: '0.75rem' }}>
            {t('Scaling Mode')}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
            {/* Show HPA if autoscaler is configured, otherwise Manual */}
            {hpaInfo ? t('HPA') : t('Manual')}
          </Typography>
        </Grid>
        <Grid item xs={3}>
          <Typography variant="body2" color="textSecondary" sx={{ fontSize: '0.75rem' }}>
            {t('Replica Count')}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
            {/* Use HPA current replicas if available, otherwise fall back to deployment ready replicas */}
            {hpaInfo?.currentReplicas ??
              deployments.find(d => d.name === selectedDeployment)?.readyReplicas ??
              'N/A'}
          </Typography>
        </Grid>
        <Grid item xs={3}>
          <Typography variant="body2" color="textSecondary" sx={{ fontSize: '0.75rem' }}>
            {t('Replica Bounds')}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
            {/* Only show bounds if HPA is configured */}
            {hpaInfo?.minReplicas !== undefined && hpaInfo?.maxReplicas !== undefined
              ? `${hpaInfo.minReplicas}-${hpaInfo.maxReplicas}`
              : 'N/A'}
          </Typography>
        </Grid>
        <Grid item xs={3}>
          <Typography variant="body2" color="textSecondary" sx={{ fontSize: '0.75rem' }}>
            {t('CPU Usage')}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
            {hpaInfo?.currentCPUUtilization !== null && hpaInfo?.currentCPUUtilization !== undefined
              ? `${hpaInfo.currentCPUUtilization}%`
              : 'N/A'}
          </Typography>
        </Grid>
      </Grid>
    </Box>
  );
};
