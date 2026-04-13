// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, AlertTitle, Box, CircularProgress, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import React from 'react';
import { DeploymentSelector } from '../shared/DeploymentSelector';
import { EmptyStateCard } from './components/EmptyStateCard';
import { MetricsChartsGrid } from './components/MetricsChartsGrid';
import { MetricsLoadingSkeleton } from './components/MetricsLoadingSkeleton';
import { MetricsSummaryBar } from './components/MetricsSummaryBar';
import { PodDetailsTable } from './components/PodDetailsTable';
import { useDeployments } from './hooks/useDeployments';
import { useNamespaceLabels } from './hooks/useNamespaceLabels';
import { usePods } from './hooks/usePods';
import { usePrometheusMetrics } from './hooks/usePrometheusMetrics';

/** Props for the {@link MetricsTab} component. */
export interface MetricsTabProps {
  /** AKS Managed Project **/
  project: {
    /** List of clusters in the project **/
    clusters: string[];
    /** List of namespaces in the project **/
    namespaces: string[];
    /** ID/Name of project **/
    id: string;
  };
}

/**
 * Top-level component for the metrics tab.
 *
 * Composes necessary hooks and components to display metrics
 * for the selected deployment
 */
const MetricsTab: React.FC<MetricsTabProps> = ({ project }) => {
  const { t } = useTranslation();
  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  const { subscription, resourceGroupLabel } = useNamespaceLabels(namespace, cluster);
  const { deployments, selectedDeployment, loading, error, setSelectedDeployment } = useDeployments(
    namespace,
    cluster
  );
  const { pods, setPods, totalPods, projectStatus } = usePods(
    selectedDeployment,
    namespace,
    cluster
  );
  const {
    summary: metricsSummary,
    cpuData,
    memoryData,
    requestErrorData,
    responseTimeData,
    networkData,
    memoryUnit,
    metricsLoading,
    hasFetchedMetrics,
    error: metricsError,
  } = usePrometheusMetrics(
    namespace,
    cluster,
    selectedDeployment,
    subscription,
    resourceGroupLabel,
    setPods
  );

  // Merge pod-level status with the metrics summary
  const summary = {
    ...metricsSummary,
    totalPods,
    projectStatus,
  };

  const handleDeploymentChange = (deploymentName: string) => {
    setSelectedDeployment(deploymentName);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if ((error || metricsError) && deployments.length === 0) {
    return (
      <Box p={3}>
        <Alert severity="warning">
          <AlertTitle>{t('Metrics Unavailable')}</AlertTitle>
          <Typography variant="body2">{error ?? metricsError}</Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5">{t('Application Metrics')}</Typography>
        <DeploymentSelector
          selectedDeployment={selectedDeployment}
          deployments={deployments}
          onDeploymentChange={handleDeploymentChange}
        />
      </Box>

      {/* Always-mounted consolidated live region for empty chart announcements */}
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {selectedDeployment && !metricsLoading && hasFetchedMetrics
          ? [
              requestErrorData.length === 0 &&
                `${t('Request & error rate')}: ${t('No data available')}`,
              responseTimeData.length === 0 && `${t('Response Time')}: ${t('No data available')}`,
              cpuData.length === 0 && `${t('CPU Usage')}: ${t('No data available')}`,
              memoryData.length === 0 && `${t('Memory utilization')}: ${t('No data available')}`,
              networkData.length === 0 && `${t('Network I/O')}: ${t('No data available')}`,
            ]
              .filter(Boolean)
              .join('. ')
          : ''}
      </Box>

      {deployments.length === 0 ? (
        <EmptyStateCard
          message={t('No Deployments Found')}
          subMessages={[
            t('There are no deployments in this project namespace yet.'),
            t('Deploy an application to start viewing metrics.'),
          ]}
        />
      ) : !selectedDeployment ? (
        <EmptyStateCard
          message={t('Please select a deployment to view metrics')}
          messageVariant="body1"
        />
      ) : (
        <>
          <MetricsSummaryBar summary={summary} />

          {/* Application Health Section */}
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('Application Health')}
          </Typography>

          {metricsLoading && cpuData.length === 0 ? (
            <MetricsLoadingSkeleton />
          ) : (
            <MetricsChartsGrid
              cpuData={cpuData}
              memoryData={memoryData}
              requestErrorData={requestErrorData}
              responseTimeData={responseTimeData}
              networkData={networkData}
              memoryUnit={memoryUnit}
            />
          )}

          <PodDetailsTable pods={pods} selectedDeployment={selectedDeployment} />
        </>
      )}
    </Box>
  );
};

export default MetricsTab;
