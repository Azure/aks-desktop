// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, CircularProgress, Typography, useTheme } from '@mui/material';
import React from 'react';
import { DeploymentSelector } from '../shared/DeploymentSelector';
import { MetricStatCard } from './components/MetricStatCard';
import { useCardMetrics } from './hooks/useCardMetrics';
import { useDeployments } from './hooks/useDeployments';
import { useNamespaceLabels } from './hooks/useNamespaceLabels';

/** Props for {@link MetricsCard}. */
export interface MetricsCardProps {
  /** AKS Managed Project */
  project: {
    id: string;
    namespaces: string[];
    clusters: string[];
  };
}

/**
 * Compact card displaying summary of basic Prometheus metrics
 * for the selected deployment (CPU, Memory, Request Rate, & Error Rate).
 */
function MetricsCard({ project }: MetricsCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  const { subscription, resourceGroupLabel } = useNamespaceLabels(namespace, cluster);
  const { deployments, selectedDeployment, loading, error, setSelectedDeployment } = useDeployments(
    namespace,
    cluster
  );
  const { metrics, metricsLoading } = useCardMetrics(
    namespace,
    cluster,
    selectedDeployment,
    subscription,
    resourceGroupLabel
  );

  return (
    <Box
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 0, '&:last-child': { pb: 0 } }}
    >
      {/* Header with title and deployment selector */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Typography variant="h6">{t('Metrics')}</Typography>
        <DeploymentSelector
          selectedDeployment={selectedDeployment}
          deployments={deployments}
          loading={loading}
          onDeploymentChange={setSelectedDeployment}
        />
      </Box>

      {error && (
        <Box mb={2}>
          <Typography color="error" variant="body2">
            {error}
          </Typography>
        </Box>
      )}

      {selectedDeployment ? (
        <>
          {metricsLoading ? (
            <Box
              display="flex"
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              flex={1}
              minHeight={200}
            >
              <CircularProgress size={32} sx={{ mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                {t('Loading metrics from Prometheus')}...
              </Typography>
            </Box>
          ) : (
            <>
              {/* Metrics Grid */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 2,
                  mb: 2,
                }}
              >
                <MetricStatCard
                  icon="mdi:cpu-64-bit"
                  iconColor="#2196f3"
                  label={t('CPU Usage')}
                  value={metrics.cpuUsage}
                />
                <MetricStatCard
                  icon="mdi:memory"
                  iconColor={theme.palette.success.main}
                  label={t('Memory Usage')}
                  value={metrics.memoryUsage}
                />
                <MetricStatCard
                  icon="mdi:chart-line"
                  iconColor={theme.palette.warning.main}
                  label={t('Request Rate')}
                  value={metrics.requestRate}
                />
                <MetricStatCard
                  icon="mdi:alert-circle"
                  iconColor={theme.palette.error.main}
                  label={t('Error Rate')}
                  value={metrics.errorRate}
                />
              </Box>

              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ textAlign: 'center', mt: 1 }}
              >
                {t('Metrics refreshed every 30 seconds')}
              </Typography>
            </>
          )}
        </>
      ) : (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          flex={1}
        >
          <Icon
            icon="mdi:chart-box-outline"
            style={{
              marginBottom: 16,
              color: theme.palette.text.secondary,
              fontSize: 48,
            }}
          />
          <Typography color="textSecondary" variant="body1">
            {t('Select a deployment to view metrics')}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default MetricsCard;
