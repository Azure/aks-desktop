// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Card, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { DeploymentSelector } from '../shared/DeploymentSelector';
import { ScalingChart } from './components/ScalingChart';
import { ScalingEditDialog } from './components/ScalingEditDialog';
import { ScalingMetrics } from './components/ScalingMetrics';
import { useChartData } from './hooks/useChartData';
import { useDeployments } from './hooks/useDeployments';
import { useEditDialog } from './hooks/useEditDialog';
import { useHPAInfo } from './hooks/useHPAInfo';

/**
 * Props for the {@link ScalingTab} component.
 */
interface ScalingTabProps {
  /** The project whose first cluster and namespace are used to fetch deployments. */
  project: {
    clusters: string[];
    namespaces: string[];
    id: string;
  };
}

// 24 hours at 1-hour resolution (24 data points)
const TIME_RANGE_SECS = 86400;
const STEP_SECS = 3600;

/**
 * Full-page tab for viewing and editing scaling configuration for a deployment.
 *
 * Displays a deployment selector, scaling overview with an edit dialog (HPA or manual),
 * and a Prometheus-backed scaling history chart for the last 24 hours.
 *
 * @param props.project - The project whose first cluster and namespace are used.
 */
const ScalingTab: React.FC<ScalingTabProps> = ({ project }) => {
  const { t } = useTranslation();

  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });
  const subscription =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-subscription'];
  const resourceGroupLabel =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-resource-group'];

  const { deployments, selectedDeployment, loading, error, setSelectedDeployment } = useDeployments(
    namespace,
    cluster
  );

  const { hpaInfo } = useHPAInfo(selectedDeployment, namespace, cluster);

  const {
    chartData,
    loading: chartLoading,
    error: chartError,
  } = useChartData(
    selectedDeployment,
    namespace,
    cluster,
    subscription,
    resourceGroupLabel,
    TIME_RANGE_SECS,
    STEP_SECS
  );

  const {
    editDialogOpen,
    editValues,
    saving,
    saveError,
    handleEditClick,
    handleClose,
    setEditValues,
    handleSave,
  } = useEditDialog(selectedDeployment, deployments, hpaInfo, namespace, cluster, () => {
    // Data refreshes automatically via the live K8s watchers in useDeployments and useHPAInfo
  });

  if (loading && deployments.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5">{t('Scaling')}</Typography>
        <DeploymentSelector
          selectedDeployment={selectedDeployment}
          deployments={deployments}
          loading={loading}
          onDeploymentChange={setSelectedDeployment}
        />
      </Box>

      {(error || saveError) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error ?? saveError}
        </Alert>
      )}

      {!selectedDeployment ? (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          minHeight="400px"
        >
          <Icon icon="mdi:chart-line" style={{ marginBottom: 16, color: '#ccc', fontSize: 64 }} />
          <Typography color="textSecondary" variant="h6">
            {t('Select a deployment to view scaling metrics')}
          </Typography>
        </Box>
      ) : (
        <>
          {/* Scaling Overview */}
          <Card sx={{ p: 2, mb: 3 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 1.5,
              }}
            >
              <Typography variant="h6">{t('Scaling Overview')}</Typography>
              <Button
                variant="contained"
                size="small"
                startIcon={<Icon icon="mdi:pencil" />}
                onClick={handleEditClick}
              >
                {t('Edit Configuration')}
              </Button>
            </Box>
            <ScalingMetrics
              hpaInfo={hpaInfo}
              selectedDeployment={selectedDeployment}
              deployments={deployments}
            />
          </Card>

          {/* Scaling History Chart */}
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              {t('Scaling History (Last 24 Hours)')}
            </Typography>
            <Box sx={{ height: 500, width: '100%', mt: 2 }}>
              <ScalingChart chartData={chartData} loading={chartLoading} error={chartError} />
            </Box>
          </Card>
        </>
      )}

      {/* Edit Dialog */}
      <ScalingEditDialog
        open={editDialogOpen}
        hpaInfo={hpaInfo}
        editValues={editValues}
        saving={saving}
        onEditValuesChange={setEditValues}
        onClose={handleClose}
        onSave={handleSave}
      />
    </Box>
  );
};

export default ScalingTab;
