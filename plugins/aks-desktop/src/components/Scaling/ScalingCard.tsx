// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Typography } from '@mui/material';
import React from 'react';
import { DeploymentSelector } from './components/DeploymentSelector';
import { ScalingChart } from './components/ScalingChart';
import { ScalingMetrics } from './components/ScalingMetrics';
import { useChartData } from './hooks/useChartData';
import { useDeployments } from './hooks/useDeployments';
import { useHPAInfo } from './hooks/useHPAInfo';

/**
 * Defines the structure of a project for scaling operations.
 */
export interface ProjectDefinition {
  /** Unique identifier for the project. */
  id: string;
  /** List of Kubernetes namespaces associated with the project. */
  namespaces: string[];
  /** List of cluster names/identifiers where the project can be deployed. */
  clusters: string[];
}

/** Alias for ProjectDefinition. */
type Project = ProjectDefinition;

/**
 * Props for the {@link ScalingCard} component.
 */
interface ScalingCardProps {
  /** The project whose first cluster and namespace are used to fetch deployments. */
  project: Project;
}

/**
 * Displays scaling metrics and charts for a selected Kubernetes deployment.
 *
 * @param props.project - The project whose first cluster and namespace are used to fetch deployments.
 */
function ScalingCard({ project }: ScalingCardProps) {
  const { t } = useTranslation();
  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  // Get subscription and resource group from namespace labels
  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });
  const subscription =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-subscription'];
  const resourceGroupLabel =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-resource-group'];

  // Fetch real deployments from Kubernetes API
  const { deployments, selectedDeployment, loading, error, setSelectedDeployment } = useDeployments(
    namespace,
    cluster
  );
  // Find HPA that targets the selected deployment
  const { hpaInfo } = useHPAInfo(selectedDeployment, namespace, cluster);
  // Fetch real chart data from Prometheus
  const {
    chartData,
    loading: chartLoading,
    error: chartError,
  } = useChartData(selectedDeployment, namespace, cluster, subscription, resourceGroupLabel);

  const handleDeploymentChange = (deploymentName: string) => {
    setSelectedDeployment(deploymentName);
  };

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
        <Typography variant="h6">{t('Scaling')}</Typography>
        <DeploymentSelector
          selectedDeployment={selectedDeployment}
          deployments={deployments}
          loading={loading}
          onDeploymentChange={handleDeploymentChange}
        />
      </Box>

      {error && (
        <Box mb={2}>
          <Alert severity="warning">
            <Typography variant="body2">{error}</Typography>
          </Alert>
        </Box>
      )}

      {selectedDeployment && (
        <>
          {/* Metrics Overview */}
          <ScalingMetrics
            hpaInfo={hpaInfo}
            selectedDeployment={selectedDeployment}
            deployments={deployments}
          />
          {/* Chart */}
          <Box sx={{ height: 400, width: '100%' }}>
            <ScalingChart chartData={chartData} loading={chartLoading} error={chartError} />
          </Box>
        </>
      )}

      {!selectedDeployment && (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          flex={1}
        >
          <Icon icon="mdi:chart-line" style={{ marginBottom: 16, color: '#ccc', fontSize: 48 }} />
          <Typography color="textSecondary" variant="body1">
            {t('Select a deployment to view scaling metrics')}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default ScalingCard;
