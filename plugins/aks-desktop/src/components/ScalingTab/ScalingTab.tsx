// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getClusterResourceIdAndGroup } from '../../utils/azure/az-cli';
import { getPrometheusEndpoint } from '../MetricsTab/getPrometheusEndpoint';
import { queryPrometheus } from '../MetricsTab/queryPrometheus';

// Headers for Kubernetes PATCH requests (merge patch)
const MERGE_PATCH_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/merge-patch+json',
};

interface ScalingTabProps {
  project: {
    clusters: string[];
    namespaces: string[];
    id: string;
  };
}

interface HPAInfo {
  name: string;
  namespace: string;
  minReplicas: number;
  maxReplicas: number;
  targetCPUUtilization: number;
  currentCPUUtilization: number;
  currentReplicas: number;
  desiredReplicas: number;
}

interface Deployment {
  name: string;
  namespace: string;
  replicas: number;
  availableReplicas: number;
  readyReplicas: number;
}

interface ChartDataPoint {
  time: string;
  Replicas: number;
  CPU: number;
}

const ScalingTab: React.FC<ScalingTabProps> = ({ project }) => {
  const [selectedDeployment, setSelectedDeployment] = useState<string>('');
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [hpaInfo, setHpaInfo] = useState<HPAInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState<boolean>(false);
  const [editValues, setEditValues] = useState({
    minReplicas: 1,
    maxReplicas: 10,
    targetCPU: 50,
    replicas: 1,
  });
  const [saving, setSaving] = useState<boolean>(false);
  const [chartDataLoading, setChartDataLoading] = useState<boolean>(false);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  const namespace = project.namespaces?.[0];
  const cluster = project.clusters?.[0];

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });
  const subscription =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-subscription'];
  const resourceGroupLabel =
    namespaceInstance?.jsonData?.metadata?.labels?.['aks-desktop/project-resource-group'];

  // Fetch real deployments from Kubernetes API
  const fetchDeployments = useCallback(async () => {
    if (!namespace) return;

    setLoading(true);
    setError(null);

    try {
      const cancel = K8s.ResourceClasses.Deployment.apiList(
        deploymentList => {
          const deployments = deploymentList
            .filter(deployment => deployment.getNamespace() === namespace)
            .map(deployment => ({
              name: deployment.getName(),
              namespace: deployment.getNamespace(),
              replicas: deployment.spec?.replicas || 0,
              availableReplicas: deployment.status?.availableReplicas || 0,
              readyReplicas: deployment.status?.readyReplicas || 0,
            }));

          setDeployments(deployments);

          // Auto-select first deployment if none selected
          if (deployments.length > 0 && !selectedDeployment) {
            setSelectedDeployment(deployments[0].name);
          }
          setLoading(false);
        },
        (error: any) => {
          console.error('Error fetching deployments:', error);
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
      console.error('Error in fetchDeployments:', err);
      setError('Failed to fetch deployments');
      setLoading(false);
    }
  }, [namespace, cluster, selectedDeployment]);

  // Fetch HPA info
  const fetchHPAInfo = useCallback(
    async (deploymentName: string) => {
      if (!deploymentName || !namespace) return;

      try {
        K8s.ResourceClasses.HorizontalPodAutoscaler.apiList(
          hpaList => {
            const hpa = hpaList.find(
              hpa =>
                hpa.getNamespace() === namespace &&
                hpa.spec?.scaleTargetRef?.name === deploymentName
            );

            if (hpa) {
              // Parse HPA CPU metrics from spec.metrics[] and status.currentMetrics[] arrays
              const hpaJson = (hpa as any).jsonData;
              const targetMetric = hpaJson?.spec?.metrics?.find(
                (m: any) => m.type === 'Resource' && m.resource?.name === 'cpu'
              );
              const targetCPU = targetMetric?.resource?.target?.averageUtilization;

              const currentMetric = hpaJson?.status?.currentMetrics?.find(
                (m: any) => m.type === 'Resource' && m.resource?.name === 'cpu'
              );
              const currentCPU = currentMetric?.resource?.current?.averageUtilization;

              const hpaData: HPAInfo = {
                name: hpa.getName(),
                namespace: hpa.getNamespace(),
                minReplicas: hpa.spec?.minReplicas,
                maxReplicas: hpa.spec?.maxReplicas,
                targetCPUUtilization: targetCPU,
                currentCPUUtilization: currentCPU,
                currentReplicas: hpa.status?.currentReplicas,
                desiredReplicas: hpa.status?.desiredReplicas,
              };
              setHpaInfo(hpaData);
            } else {
              setHpaInfo(null);
            }
          },
          (error: any) => {
            console.error('Error fetching HPA info:', error);
            setHpaInfo(null);
          },
          {
            namespace: namespace,
            cluster: cluster,
          }
        )();
      } catch (error) {
        console.error('Error in fetchHPAInfo:', error);
        setHpaInfo(null);
      }
    },
    [namespace, cluster]
  );

  // Fetch real chart data from Prometheus
  const fetchChartData = useCallback(async () => {
    if (!namespace || !selectedDeployment || !cluster || !subscription) return;

    setChartDataLoading(true);
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
      const start = end - 7200; // Last 2 hours
      const step = 60;

      // Query replica count history
      const replicaQuery = `kube_deployment_spec_replicas{deployment="${selectedDeployment}",namespace="${namespace}"}`;
      const replicaResults = await queryPrometheus(
        promEndpoint,
        replicaQuery,
        start,
        end,
        step,
        subscription
      );

      // Query CPU usage (as percentage of limits)
      const cpuQuery = `100 * (sum by (namespace) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"${selectedDeployment}-.*", container!=""}[5m])) / sum by (namespace) (kube_pod_container_resource_limits{namespace="${namespace}", pod=~"${selectedDeployment}-.*", resource="cpu"}))`;
      const cpuResults = await queryPrometheus(
        promEndpoint,
        cpuQuery,
        start,
        end,
        step,
        subscription
      );

      // Merge replica and CPU data by timestamp
      const mergedData: ChartDataPoint[] = [];
      const replicaValues = replicaResults[0]?.values || [];
      const cpuValues = cpuResults[0]?.values || [];

      // Create a map of timestamps to CPU values for easier lookup
      const cpuMap = new Map<number, number>();
      cpuValues.forEach(([timestamp, value]: [number, string]) => {
        cpuMap.set(timestamp, parseFloat(value));
      });

      // Iterate through replica values and match with CPU
      replicaValues.forEach(([timestamp, replicaValue]: [number, string]) => {
        const timeString = new Date(timestamp * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        const replicas = parseInt(replicaValue);
        const cpu = cpuMap.get(timestamp) || 0;

        mergedData.push({
          time: timeString,
          Replicas: replicas,
          CPU: Math.round(cpu),
        });
      });

      setChartData(mergedData);
    } catch (error) {
      console.error('Failed to fetch chart data from Prometheus:', error);
      setChartData([]);
    } finally {
      setChartDataLoading(false);
    }
  }, [namespace, selectedDeployment, cluster, subscription, resourceGroupLabel]);

  // Handle edit button click
  const handleEditClick = () => {
    const currentDeployment = deployments.find(d => d.name === selectedDeployment);

    if (hpaInfo) {
      // HPA mode
      setEditValues({
        minReplicas: hpaInfo.minReplicas,
        maxReplicas: hpaInfo.maxReplicas,
        targetCPU: hpaInfo.targetCPUUtilization,
        replicas: currentDeployment?.replicas || 1,
      });
    } else {
      // Manual mode
      setEditValues({
        minReplicas: 1,
        maxReplicas: 10,
        targetCPU: 50,
        replicas: currentDeployment?.replicas || 1,
      });
    }

    setEditDialogOpen(true);
  };

  // Handle save
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const currentDeployment = deployments.find(d => d.name === selectedDeployment);
      if (!currentDeployment) {
        setError(`Deployment "${selectedDeployment}" not found in deployments list`);
        setSaving(false);
        return;
      }

      if (hpaInfo) {
        // Update HPA using clusterRequest
        const hpaPatchData = {
          spec: {
            minReplicas: editValues.minReplicas,
            maxReplicas: editValues.maxReplicas,
            targetCPUUtilizationPercentage: editValues.targetCPU,
          },
        };

        const hpaUrl = `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/${hpaInfo.name}`;

        await clusterRequest(hpaUrl, {
          method: 'PATCH',
          body: JSON.stringify(hpaPatchData),
          headers: MERGE_PATCH_HEADERS,
          cluster: cluster,
        });
      } else {
        // Update deployment replicas using clusterRequest
        const deploymentPatchData = {
          spec: {
            replicas: editValues.replicas,
          },
        };

        const deploymentUrl = `/apis/apps/v1/namespaces/${namespace}/deployments/${selectedDeployment}`;

        await clusterRequest(deploymentUrl, {
          method: 'PATCH',
          body: JSON.stringify(deploymentPatchData),
          headers: MERGE_PATCH_HEADERS,
          cluster: cluster,
        });
      }

      setEditDialogOpen(false);

      // Refresh data after a short delay to allow Kubernetes to update
      setTimeout(() => {
        fetchDeployments();
        if (selectedDeployment) {
          fetchHPAInfo(selectedDeployment);
        }
      }, 1000);
    } catch (error) {
      console.error('Error saving scaling configuration:', error);
      setError(
        `Failed to save scaling configuration: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (namespace) {
      fetchDeployments();
    }
  }, [namespace, fetchDeployments]);

  useEffect(() => {
    if (selectedDeployment) {
      fetchHPAInfo(selectedDeployment);
      fetchChartData();
    }
  }, [selectedDeployment, fetchHPAInfo, fetchChartData]);

  const handleDeploymentChange = (event: any) => {
    setSelectedDeployment(event.target.value as string);
  };

  const currentDeployment = deployments.find(d => d.name === selectedDeployment);

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
        <Typography variant="h5">Scaling</Typography>
        <FormControl sx={{ minWidth: 300 }}>
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
            Select a deployment to view scaling metrics
          </Typography>
        </Box>
      ) : (
        <>
          {/* Summary Cards */}
          <Card sx={{ p: 2, mb: 3 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 1.5,
              }}
            >
              <Typography variant="h6">Scaling Overview</Typography>
              <Button
                variant="contained"
                size="small"
                startIcon={<Icon icon="mdi:pencil" />}
                onClick={handleEditClick}
              >
                Edit Configuration
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Box sx={{ minWidth: '100px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Scaling Mode
                </Typography>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <Icon
                    icon={hpaInfo ? 'mdi:autorenew' : 'mdi:account'}
                    style={{ fontSize: 18, color: hpaInfo ? '#66BB6A' : '#42A5F5' }}
                  />
                  <Typography variant="body1" fontWeight="bold">
                    {hpaInfo ? 'HPA' : 'Manual'}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ minWidth: '100px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Current Replicas
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {hpaInfo?.currentReplicas ?? currentDeployment?.readyReplicas ?? 'N/A'}
                </Typography>
              </Box>

              <Box sx={{ minWidth: '120px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {hpaInfo ? 'Desired Replicas' : 'Configured Replicas'}
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {hpaInfo?.desiredReplicas ?? currentDeployment?.replicas ?? 'N/A'}
                </Typography>
              </Box>

              <Box sx={{ minWidth: '120px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {hpaInfo ? 'Replica Bounds' : 'Available Replicas'}
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {hpaInfo
                    ? hpaInfo.minReplicas !== undefined && hpaInfo.maxReplicas !== undefined
                      ? `${hpaInfo.minReplicas}-${hpaInfo.maxReplicas}`
                      : 'N/A'
                    : currentDeployment?.availableReplicas ?? 'N/A'}
                </Typography>
              </Box>

              <Box sx={{ minWidth: '120px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {hpaInfo ? 'CPU Usage / Target' : 'CPU Usage'}
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {hpaInfo
                    ? hpaInfo.currentCPUUtilization !== null &&
                      hpaInfo.currentCPUUtilization !== undefined &&
                      hpaInfo.targetCPUUtilization !== null &&
                      hpaInfo.targetCPUUtilization !== undefined
                      ? `${hpaInfo.currentCPUUtilization}% / ${hpaInfo.targetCPUUtilization}%`
                      : 'N/A'
                    : 'N/A'}
                </Typography>
              </Box>
            </Box>
          </Card>

          {/* Scaling History Chart */}
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Scaling History (Last 2 Hours)
            </Typography>
            <Box sx={{ height: 500, width: '100%', mt: 2 }}>
              {chartDataLoading ? (
                <Box
                  display="flex"
                  flexDirection="column"
                  alignItems="center"
                  justifyContent="center"
                  height="100%"
                >
                  <CircularProgress size={48} sx={{ mb: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    Loading scaling metrics from Prometheus...
                  </Typography>
                </Box>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 30,
                      left: 20,
                      bottom: 30,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                    <XAxis
                      dataKey="time"
                      stroke="#888"
                      fontSize={12}
                      tick={{ fontSize: 12 }}
                      tickLine={{ stroke: '#e0e0e0' }}
                      interval={2}
                    />
                    <YAxis
                      stroke="#888"
                      fontSize={12}
                      tick={{ fontSize: 12 }}
                      tickLine={{ stroke: '#e0e0e0' }}
                      domain={[0, 'dataMax + 1']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        fontSize: '13px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '14px', paddingTop: '10px' }} />
                    <Line
                      type="monotone"
                      dataKey="Replicas"
                      stroke="#66BB6A"
                      strokeWidth={3}
                      dot={{ fill: '#66BB6A', strokeWidth: 0, r: 3 }}
                      activeDot={{ r: 5, stroke: '#66BB6A', strokeWidth: 2, fill: '#fff' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="CPU"
                      stroke="#42A5F5"
                      strokeWidth={3}
                      dot={{ fill: '#42A5F5', strokeWidth: 0, r: 3 }}
                      activeDot={{ r: 5, stroke: '#42A5F5', strokeWidth: 2, fill: '#fff' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                  <Typography color="textSecondary" variant="body1">
                    No scaling data available
                  </Typography>
                </Box>
              )}
            </Box>
          </Card>
        </>
      )}

      {/* Edit Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {hpaInfo ? 'Edit HPA Configuration' : 'Edit Manual Scaling Configuration'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            {hpaInfo ? (
              <>
                <TextField
                  label="Minimum Replicas"
                  type="number"
                  fullWidth
                  value={editValues.minReplicas}
                  onChange={e =>
                    setEditValues({ ...editValues, minReplicas: parseInt(e.target.value) })
                  }
                  sx={{ mb: 2 }}
                  inputProps={{ min: 1 }}
                />
                <TextField
                  label="Maximum Replicas"
                  type="number"
                  fullWidth
                  value={editValues.maxReplicas}
                  onChange={e =>
                    setEditValues({ ...editValues, maxReplicas: parseInt(e.target.value) })
                  }
                  sx={{ mb: 2 }}
                  inputProps={{ min: editValues.minReplicas }}
                />
                <TextField
                  label="Target CPU Utilization (%)"
                  type="number"
                  fullWidth
                  value={editValues.targetCPU}
                  onChange={e =>
                    setEditValues({ ...editValues, targetCPU: parseInt(e.target.value) })
                  }
                  inputProps={{ min: 1, max: 100 }}
                />
              </>
            ) : (
              <>
                <TextField
                  label="Number of Replicas"
                  type="number"
                  fullWidth
                  value={editValues.replicas}
                  onChange={e =>
                    setEditValues({ ...editValues, replicas: parseInt(e.target.value) })
                  }
                  inputProps={{ min: 0 }}
                  helperText="Set the desired number of pod replicas for this deployment"
                />
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ScalingTab;
