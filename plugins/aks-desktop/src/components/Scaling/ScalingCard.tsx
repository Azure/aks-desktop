// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { DeploymentSelector } from './components/DeploymentSelector';
import { ScalingChart } from './components/ScalingChart';
import { ScalingMetrics } from './components/ScalingMetrics';
import { useChartData } from './hooks/useChartData';
import { useDeployments } from './hooks/useDeployments';
import { useHPAInfo } from './hooks/useHPAInfo';

export interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

type Project = ProjectDefinition;

interface ScalingCardProps {
  project: Project;
}

function ScalingCard({ project }: ScalingCardProps) {
  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  // Fetch real deployments from Kubernetes API
  const { deployments, selectedDeployment, loading, error, setSelectedDeployment } = useDeployments(
    namespace,
    cluster
  );
  // Find HPA that targets the selected deployment
  const { hpaInfo } = useHPAInfo(selectedDeployment, namespace, cluster);
  // Generate chart data based on the selected deployment and HPA info
  const chartData = useChartData(selectedDeployment, deployments, hpaInfo);

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
        <Typography variant="h6">Scaling</Typography>
        <DeploymentSelector
          selectedDeployment={selectedDeployment}
          deployments={deployments}
          loading={loading}
          onDeploymentChange={handleDeploymentChange}
        />
      </Box>

      {error && (
        <Box mb={2}>
          <Typography color="error" variant="body2">
            {error}
          </Typography>
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
            <ScalingChart chartData={chartData} />
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
            Select a deployment to view scaling metrics
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default ScalingCard;
