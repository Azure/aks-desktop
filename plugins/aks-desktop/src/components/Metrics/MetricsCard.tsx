// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { getClusterResourceIdAndGroup } from '../../utils/azure/az-cli';
import { getPrometheusEndpoint } from '../MetricsTab/getPrometheusEndpoint';
import { queryPrometheus } from '../MetricsTab/queryPrometheus';

export interface ProjectDefinition {
  id: string;
  namespaces: string[];
  clusters: string[];
}

type Project = ProjectDefinition;

interface MetricsCardProps {
  project: Project;
}

interface Deployment {
  name: string;
  namespace: string;
}

interface MetricData {
  cpuUsage: string;
  memoryUsage: string;
  requestRate: string;
  errorRate: string;
}

// helper to properly format memory values
function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'N/A';
  }

  const gig = 1024 * 1024 * 1024;
  if (bytes >= gig) {
    return `${(bytes / gig).toFixed(2)} GB`;
  }

  const oneMB = 1024 * 1024;
  return `${(bytes / oneMB).toFixed(2)} MB`;
}

function MetricsCard({ project }: MetricsCardProps) {
  const [selectedDeployment, setSelectedDeployment] = useState<string>('');
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [metrics, setMetrics] = useState<MetricData>({
    cpuUsage: 'N/A',
    memoryUsage: 'N/A',
    requestRate: 'N/A',
    errorRate: 'N/A',
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const theme = useTheme();

  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });
  const subscription =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-subscription'];
  const resourceGroupLabel =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-resource-group'];

  // Fetch deployments
  const fetchDeployments = useCallback(async () => {
    if (!namespace) return;

    setLoading(true);
    setError(null);

    try {
      const cancel = K8s.ResourceClasses.Deployment.apiList(
        (deploymentList: K8s.Deployment[]) => {
          const deployments = deploymentList
            .filter((deployment: K8s.Deployment) => deployment.getNamespace() === namespace)
            .map((deployment: K8s.Deployment) => ({
              name: deployment.getName(),
              namespace: deployment.getNamespace(),
            }));

          setDeployments(deployments);

          if (deployments.length > 0 && !selectedDeployment) {
            setSelectedDeployment(deployments[0].name);
          }
          setLoading(false);
        },
        (error: any) => {
          console.error('MetricsCard: Error fetching deployments:', error);
          setError('Failed to fetch deployments');
          setDeployments([]);
          setLoading(false);
        },
        {
          namespace: namespace,
          cluster: cluster,
        }
      )();

      return cancel;
    } catch (err) {
      console.error('MetricsCard: Error in fetchDeployments:', err);
      setError('Failed to fetch deployments');
      setLoading(false);
    }
  }, [namespace, cluster, selectedDeployment]);

  // Fetch metrics from Prometheus
  const fetchMetrics = useCallback(async () => {
    if (!namespace || !selectedDeployment || !subscription) return;

    // Only show loading on initial fetch, not on 30s refreshes
    if (isInitialLoad) {
      setMetricsLoading(true);
    }

    try {
      // Extract resource group from label if available, otherwise fetch
      let resourceGroup = resourceGroupLabel;

      if (!resourceGroup) {
        const result = await getClusterResourceIdAndGroup(cluster, subscription);
        resourceGroup = result.resourceGroup;

        if (!resourceGroup) {
          throw new Error('Could not find resource group for cluster');
        }
      }

      const promEndpoint = await getPrometheusEndpoint(resourceGroup, cluster, subscription);

      const end = Math.floor(Date.now() / 1000);
      const start = end - 300; // Last 5 minutes
      const step = 60;

      // Query CPU usage
      const cpuQuery = `sum by (namespace) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", container!=""}[5m]))`;
      const cpuResultsPromise = queryPrometheus(
        promEndpoint,
        cpuQuery,
        start,
        end,
        step,
        subscription
      );

      // Query Memory usage
      // NOTE: Use container_memory_working_set_bytes (not container_memory_usage_bytes)
      // working_set is the actual memory metric available in Azure Monitor Prometheus
      const memoryQuery = `sum by (namespace) (container_memory_working_set_bytes{namespace="${namespace}", container!=""})`;
      const memoryResultsPromise = queryPrometheus(
        promEndpoint,
        memoryQuery,
        start,
        end,
        step,
        subscription
      );

      // Query HTTP request rate
      const requestQuery = `sum by (namespace) (rate(http_requests_total{namespace="${namespace}"}[5m]))`;
      const requestResultsPromise = queryPrometheus(
        promEndpoint,
        requestQuery,
        start,
        end,
        step,
        subscription
      );

      // Query error rate
      const errorQuery = `100 * (sum by (namespace) (rate(http_requests_total{namespace="${namespace}", status=~"4..|5.."}[5m])) / sum by (namespace) (rate(http_requests_total{namespace="${namespace}"}[5m])))`;
      const errorResultsPromise = queryPrometheus(
        promEndpoint,
        errorQuery,
        start,
        end,
        step,
        subscription
      );

      const [cpuResults, memoryResults, requestResults, errorResults] = await Promise.all([
        cpuResultsPromise,
        memoryResultsPromise,
        requestResultsPromise,
        errorResultsPromise,
      ]);

      // Parse results
      const newMetrics: MetricData = {
        cpuUsage: 'N/A',
        memoryUsage: 'N/A',
        requestRate: 'N/A',
        errorRate: 'N/A',
      };

      // CPU - convert to cores
      if (cpuResults.length > 0 && cpuResults[0].values?.length > 0) {
        const latestValue = cpuResults[0].values[cpuResults[0].values.length - 1];
        const cpuCores = parseFloat(latestValue[1]);
        newMetrics.cpuUsage = `${cpuCores.toFixed(3)} cores`;
      }

      // Memory - convert to MB
      if (memoryResults.length > 0 && memoryResults[0].values?.length > 0) {
        const latestValue = memoryResults[0].values[memoryResults[0].values.length - 1];
        const memoryBytes = parseFloat(latestValue[1]);
        newMetrics.memoryUsage = formatMemory(memoryBytes);
      }

      // Request rate - requests per second
      if (requestResults.length > 0 && requestResults[0].values?.length > 0) {
        const latestValue = requestResults[0].values[requestResults[0].values.length - 1];
        const reqRate = parseFloat(latestValue[1]);
        newMetrics.requestRate = `${reqRate.toFixed(2)} req/s`;
      }

      // Error rate - percentage
      if (errorResults.length > 0 && errorResults[0].values?.length > 0) {
        const latestValue = errorResults[0].values[errorResults[0].values.length - 1];
        const errRate = parseFloat(latestValue[1]);
        newMetrics.errorRate = `${errRate.toFixed(1)}%`;
      }

      setMetrics(newMetrics);

      // After first successful fetch, disable initial load state
      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
    } catch (error) {
      console.error('MetricsCard: Failed to fetch Prometheus metrics:', error);
      // Keep showing N/A values on error
    } finally {
      if (isInitialLoad) {
        setMetricsLoading(false);
      }
    }
  }, [namespace, cluster, selectedDeployment, isInitialLoad, subscription, resourceGroupLabel]);

  // Load deployments on mount
  useEffect(() => {
    if (namespace) {
      fetchDeployments();
    }
  }, [namespace, fetchDeployments]);

  // Load metrics when deployment is selected
  useEffect(() => {
    fetchMetrics();

    // Refresh metrics every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [selectedDeployment, subscription, fetchMetrics]);

  const handleDeploymentChange = (event: any) => {
    setSelectedDeployment(event.target.value as string);
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
        <Typography variant="h6">Metrics</Typography>
        <FormControl sx={{ minWidth: 200 }} size="small" variant="outlined">
          <InputLabel>Select Deployment</InputLabel>
          <Select
            value={selectedDeployment || ''}
            onChange={handleDeploymentChange}
            label="Select Deployment"
            disabled={loading || deployments.length === 0}
          >
            {loading ? (
              <MenuItem disabled>
                <CircularProgress size={16} style={{ marginRight: 8 }} />
                Loading deployments...
              </MenuItem>
            ) : deployments.length === 0 ? (
              <MenuItem disabled>No deployments found</MenuItem>
            ) : (
              deployments.map(deployment => (
                <MenuItem key={deployment.name} value={deployment.name}>
                  {deployment.name}
                </MenuItem>
              ))
            )}
          </Select>
        </FormControl>
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
          {/* Metrics Grid */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 2,
              mb: 2,
            }}
          >
            {/* CPU Usage */}
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                background: theme.palette.background.muted,
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Box display="flex" alignItems="center" mb={1}>
                <Icon
                  icon="mdi:cpu-64-bit"
                  style={{ fontSize: 24, marginRight: 8, color: '#2196f3' }}
                />
                <Typography variant="caption" color="textSecondary">
                  CPU Usage
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                {metricsLoading ? 'Loading...' : metrics.cpuUsage}
              </Typography>
            </Box>

            {/* Memory Usage */}
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                background: theme.palette.background.muted,
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Box display="flex" alignItems="center" mb={1}>
                <Icon
                  icon="mdi:memory"
                  style={{
                    fontSize: 24,
                    marginRight: 8,
                    color: theme.palette.success.main,
                  }}
                />
                <Typography variant="caption" color="textSecondary">
                  Memory Usage
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                {metricsLoading ? 'Loading...' : metrics.memoryUsage}
              </Typography>
            </Box>

            {/* Request Rate */}
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                background: theme.palette.background.muted,
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Box display="flex" alignItems="center" mb={1}>
                <Icon
                  icon="mdi:chart-line"
                  style={{
                    fontSize: 24,
                    marginRight: 8,
                    color: theme.palette.warning.main,
                  }}
                />
                <Typography variant="caption" color="textSecondary">
                  Request Rate
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                {metricsLoading ? 'Loading...' : metrics.requestRate}
              </Typography>
            </Box>

            {/* Error Rate */}
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                background: theme.palette.background.muted,
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Box display="flex" alignItems="center" mb={1}>
                <Icon
                  icon="mdi:alert-circle"
                  style={{
                    fontSize: 24,
                    marginRight: 8,
                    color: theme.palette.error.main,
                  }}
                />
                <Typography variant="caption" color="textSecondary">
                  Error Rate
                </Typography>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                {metricsLoading ? 'Loading...' : metrics.errorRate}
              </Typography>
            </Box>
          </Box>

          <Typography variant="caption" color="textSecondary" sx={{ textAlign: 'center', mt: 1 }}>
            Metrics refreshed every 30 seconds
          </Typography>
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
            Select a deployment to view metrics
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default MetricsCard;
