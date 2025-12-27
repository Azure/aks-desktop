// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import Deployment from '@kinvolk/headlamp-plugin/lib/lib/k8s/deployment';
import Pod from '@kinvolk/headlamp-plugin/lib/lib/k8s/pod';
import {
  Box,
  Card,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
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
import { getPrometheusEndpoint } from './getPrometheusEndpoint';
import { queryPrometheus } from './queryPrometheus';

interface MetricsTabProps {
  project: {
    clusters: string[];
    namespaces: string[];
    id: string;
  };
}

interface DeploymentInfo {
  name: string;
  namespace: string;
}

interface PodInfo {
  name: string;
  status: string;
  cpuUsage: string;
  memoryUsage: string;
  restarts: number;
}

interface MetricSummary {
  totalPods: number;
  requestRate: string;
  errorRate: string;
  cpuUsage: string;
  memoryUsage: string;
  projectStatus: string;
}

interface ChartDataPoint {
  timestamp: string;
  value: number;
}

interface ResponseTimeDataPoint {
  timestamp: string;
  responseTime: number;
}

type MemoryUnit = 'MB' | 'GB';

// helper to pick correct unit based on samples
function pickMemoryUnit(samples: number[]): MemoryUnit {
  const validSamples = samples.filter(value => Number.isFinite(value) && value >= 0);
  if (validSamples.length === 0) {
    return 'MB';
  }
  const maxBytes = Math.max(...validSamples);
  return maxBytes >= 1024 * 1024 * 1024 ? 'GB' : 'MB';
}

function convertBytesToUnit(bytes: number, unit: MemoryUnit): number {
  //safegaurd for return values
  if (!Number.isFinite(bytes)) {
    return 0;
  }
  const divisor = unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024;
  return bytes / divisor;
}

// helper used for formatting data from individual pod metrics
function formatMemoryBrief(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'N/A';
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const MetricsTab: React.FC<MetricsTabProps> = ({ project }) => {
  const [selectedDeployment, setSelectedDeployment] = useState<string>('');
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [summary, setSummary] = useState<MetricSummary>({
    totalPods: 0,
    requestRate: 'N/A',
    errorRate: 'N/A',
    cpuUsage: 'N/A',
    memoryUsage: 'N/A',
    projectStatus: 'Unknown',
  });
  const [cpuData, setCpuData] = useState<ChartDataPoint[]>([]);
  const [memoryData, setMemoryData] = useState<ChartDataPoint[]>([]);
  const [requestErrorData, setRequestErrorData] = useState<ChartDataPoint[]>([]);
  const [responseTimeData, setResponseTimeData] = useState<ResponseTimeDataPoint[]>([]);
  const [networkData, setNetworkData] = useState<ChartDataPoint[]>([]);
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryUnit, setMemoryUnit] = useState<MemoryUnit>('MB');

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
        (deploymentList: Deployment[]) => {
          const deploymentData = deploymentList.map((d: any) => ({
            name: d.metadata.name,
            namespace: d.metadata.namespace,
          }));

          setDeployments(deploymentData);

          // Auto-select first deployment
          if (deploymentData.length > 0 && !selectedDeployment) {
            setSelectedDeployment(deploymentData[0].name);
          }

          setLoading(false);
        },
        (error: any) => {
          console.error('MetricsTab: Error fetching deployments:', error);
          setError('Failed to fetch deployments');
          setLoading(false);
        },
        {
          namespace: namespace,
          cluster: cluster,
        }
      )();

      return cancel;
    } catch (err) {
      console.error('MetricsTab: Error in fetchDeployments:', err);
      setError('Failed to fetch deployments');
      setLoading(false);
    }
  }, [namespace, cluster, selectedDeployment]);

  // Fetch pods for selected deployment
  const fetchPods = useCallback(async () => {
    if (!namespace || !selectedDeployment) return;

    try {
      // First, fetch the Deployment to get its selector
      K8s.ResourceClasses.Deployment.apiGet(
        async (deployment: Deployment) => {
          // Get the selector from the deployment spec
          const selector = deployment.spec?.selector?.matchLabels;
          if (!selector) {
            console.error('MetricsTab: No selector found in deployment spec');
            setPods([]);
            return;
          }

          // Convert selector object to label selector string
          const labelSelector = Object.entries(selector)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');

          console.log('MetricsTab: Using label selector for pods:', labelSelector);

          // Now use the deployment's selector to find pods
          K8s.ResourceClasses.Pod.apiList(
            (podList: Pod[]) => {
              const podData: PodInfo[] = podList.map((p: any) => {
                const status = p.status?.phase || 'Unknown';
                const restarts =
                  p.status?.containerStatuses?.reduce(
                    (sum: number, cs: any) => sum + (cs.restartCount || 0),
                    0
                  ) || 0;

                return {
                  name: p.metadata.name,
                  status: status,
                  cpuUsage: 'N/A', // Will be updated from metrics
                  memoryUsage: 'N/A', // Will be updated from metrics
                  restarts: restarts,
                };
              });

              setPods(podData);
              setSummary(prev => ({
                ...prev,
                totalPods: podData.length,
                projectStatus: podData.every(p => p.status === 'Running') ? 'Healthy' : 'Degraded',
              }));
            },
            (error: any) => {
              console.error('MetricsTab: Error fetching pods:', error);
            },
            {
              namespace: namespace,
              cluster: cluster,
              queryParams: {
                labelSelector: labelSelector,
              },
            }
          )();
        },
        selectedDeployment,
        namespace,
        (err: any) => {
          console.error('MetricsTab: Error fetching deployment for pod selector:', err);
        },
        {
          cluster: cluster,
        }
      )();
    } catch (err) {
      console.error('MetricsTab: Error in fetchPods:', err);
    }
  }, [namespace, cluster, selectedDeployment]);

  // Fetch all metrics
  const fetchMetrics = useCallback(async () => {
    if (!namespace || !selectedDeployment || !subscription) return;

    setMetricsLoading(true);

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
      const cpuByPodQuery = `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", container!=""}[5m]))`;
      const cpuByPodResultsPromise = queryPrometheus(
        promEndpoint,
        cpuByPodQuery,
        start,
        end,
        step,
        subscription
      );

      // Query Memory usage (container_memory_usage_bytes seems to be giving issues)
      const memoryQuery = `sum by (namespace) (container_memory_working_set_bytes{namespace="${namespace}", container!=""})`;
      const memoryResultsPromise = queryPrometheus(
        promEndpoint,
        memoryQuery,
        start,
        end,
        step,
        subscription
      );
      const memoryByPodQuery = `sum by (pod) (container_memory_working_set_bytes{namespace="${namespace}", container!=""})`;
      const memoryByPodResultsPromise = queryPrometheus(
        promEndpoint,
        memoryByPodQuery,
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

      // Query response time (average)
      const responseTimeQuery = `sum by (namespace) (rate(http_request_duration_seconds_sum{namespace="${namespace}"}[5m])) / sum by (namespace) (rate(http_request_duration_seconds_count{namespace="${namespace}"}[5m]))`;
      const responseTimeResultsPromise = queryPrometheus(
        promEndpoint,
        responseTimeQuery,
        start,
        end,
        step,
        subscription
      );

      // Query network in/out
      const networkInQuery = `sum by (namespace) (rate(container_network_receive_bytes_total{namespace="${namespace}"}[5m]))`;
      const networkOutQuery = `sum by (namespace) (rate(container_network_transmit_bytes_total{namespace="${namespace}"}[5m]))`;
      const networkInResultsPromise = queryPrometheus(
        promEndpoint,
        networkInQuery,
        start,
        end,
        step,
        subscription
      );
      const networkOutResultsPromise = queryPrometheus(
        promEndpoint,
        networkOutQuery,
        start,
        end,
        step,
        subscription
      );

      const [
        cpuResults,
        cpuByPodResults,
        memoryResults,
        memoryByPodResults,
        requestResults,
        errorResults,
        responseTimeResults,
        networkInResults,
        networkOutResults,
      ] = await Promise.all([
        cpuResultsPromise,
        cpuByPodResultsPromise,
        memoryResultsPromise,
        memoryByPodResultsPromise,
        requestResultsPromise,
        errorResultsPromise,
        responseTimeResultsPromise,
        networkInResultsPromise,
        networkOutResultsPromise,
      ]);

      // Process CPU data
      if (cpuResults.length > 0 && cpuResults[0].values) {
        const chartData = cpuResults[0].values.map((v: [number, string]) => {
          const cores = parseFloat(v[1]);
          return {
            timestamp: new Date(v[0] * 1000).toLocaleTimeString(),
            value: parseFloat(cores.toFixed(4)),
          };
        });
        setCpuData(chartData);

        // Get latest value for summary
        const latestCpu = cpuResults[0].values[cpuResults[0].values.length - 1];
        if (latestCpu) {
          const latestCores = parseFloat(latestCpu[1]);
          setSummary(prev => ({
            ...prev,
            cpuUsage: `${latestCores.toFixed(3)} cores`,
          }));
        }
      }

      // Process Memory data
      if (memoryResults.length > 0 && memoryResults[0].values) {
        const bytesSamples = memoryResults[0].values.map((v: [number, string]) => parseFloat(v[1]));
        const unit = pickMemoryUnit(bytesSamples);
        const decimals = unit === 'GB' ? 3 : 2;

        const chartData = memoryResults[0].values.map((v: [number, string]) => {
          const bytes = parseFloat(v[1]);
          const converted = convertBytesToUnit(bytes, unit);
          return {
            timestamp: new Date(v[0] * 1000).toLocaleTimeString(),
            value: parseFloat(converted.toFixed(decimals)),
          };
        });
        setMemoryData(chartData);
        setMemoryUnit(unit);

        // Get latest value for summary
        const latestMem = memoryResults[0].values[memoryResults[0].values.length - 1];
        if (latestMem) {
          const latestBytes = parseFloat(latestMem[1]);
          const latestValue = convertBytesToUnit(latestBytes, unit);
          setSummary(prev => ({
            ...prev,
            memoryUsage: `${latestValue.toFixed(decimals)} ${unit}`,
          }));
        }
      }

      // Process per-pod cpu usage
      const podCpuUsage = new Map<string, string>();
      cpuByPodResults.forEach(result => {
        const podName = result.metric?.pod;
        const values = result.values;
        if (!podName || !values?.length) {
          return;
        }

        const latestSample = values[values.length - 1];
        const cores = parseFloat(latestSample[1]);
        if (Number.isFinite(cores)) {
          podCpuUsage.set(podName, `${cores.toFixed(3)} cores`);
        }
      });

      // Process per-pod memory usage
      const podMemoryUsage = new Map<string, string>();
      memoryByPodResults.forEach(result => {
        const podName = result.metric?.pod;
        const values = result.values;
        if (!podName || !values?.length) {
          return;
        }

        const latestSample = values[values.length - 1];
        const bytes = parseFloat(latestSample[1]);
        const formatted = formatMemoryBrief(bytes);
        if (formatted !== 'N/A') {
          podMemoryUsage.set(podName, formatted);
        }
      });

      if (podCpuUsage.size > 0 || podMemoryUsage.size > 0) {
        setPods(prevPods =>
          prevPods.map(pod => ({
            ...pod,
            cpuUsage: podCpuUsage.get(pod.name) ?? pod.cpuUsage,
            memoryUsage: podMemoryUsage.get(pod.name) ?? pod.memoryUsage,
          }))
        );
      }

      // Process Request & Error data (combined)
      const combinedData: any[] = [];
      if (requestResults.length > 0 && requestResults[0].values) {
        requestResults[0].values.forEach((v: [number, string], idx: number) => {
          const timestamp = new Date(v[0] * 1000).toLocaleTimeString();
          const requestRate = parseFloat(v[1]);
          const errorRate =
            errorResults.length > 0 && errorResults[0].values[idx]
              ? parseFloat(errorResults[0].values[idx][1])
              : 0;

          combinedData.push({
            timestamp,
            requestRate: parseFloat(requestRate.toFixed(2)),
            errorRate: parseFloat(errorRate.toFixed(2)),
          });
        });
        setRequestErrorData(combinedData);

        // Get latest values for summary
        if (combinedData.length > 0) {
          const latest = combinedData[combinedData.length - 1];
          setSummary(prev => ({
            ...prev,
            requestRate: `${latest.requestRate}/sec`,
            errorRate: `${latest.errorRate}%`,
          }));
        }
      }

      // Process Network data (combined in/out)
      const networkCombined: any[] = [];
      if (networkInResults.length > 0 && networkInResults[0].values) {
        networkInResults[0].values.forEach((v: [number, string], idx: number) => {
          const timestamp = new Date(v[0] * 1000).toLocaleTimeString();
          const networkIn = parseFloat(v[1]) / 1024; // Convert to KB/s
          const networkOut =
            networkOutResults.length > 0 && networkOutResults[0].values[idx]
              ? parseFloat(networkOutResults[0].values[idx][1]) / 1024
              : 0;

          networkCombined.push({
            timestamp,
            networkIn: parseFloat(networkIn.toFixed(2)),
            networkOut: parseFloat(networkOut.toFixed(2)),
          });
        });
        setNetworkData(networkCombined);
      }

      // Process Response Time data
      if (responseTimeResults.length > 0 && responseTimeResults[0].values) {
        const chartData = responseTimeResults[0].values.map((v: [number, string]) => ({
          timestamp: new Date(v[0] * 1000).toLocaleTimeString(),
          responseTime: parseFloat((parseFloat(v[1]) * 1000).toFixed(2)), // Convert to milliseconds
        }));
        setResponseTimeData(chartData);
      }
    } catch (error) {
      console.error('MetricsTab: Failed to fetch metrics:', error);
      setError('Failed to fetch metrics from Prometheus');
    } finally {
      setMetricsLoading(false);
    }
  }, [namespace, cluster, selectedDeployment, subscription, resourceGroupLabel]);

  // Load deployments on mount
  useEffect(() => {
    if (namespace) {
      fetchDeployments();
    }
  }, [namespace, fetchDeployments]);

  // Load pods when deployment is selected
  useEffect(() => {
    if (namespace && selectedDeployment) {
      fetchPods();
    }
  }, [namespace, selectedDeployment, fetchPods]);

  // Load metrics when deployment is selected
  useEffect(() => {
    fetchMetrics();

    // Refresh metrics every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [selectedDeployment, fetchMetrics, subscription]);

  const handleDeploymentChange = (event: any) => {
    setSelectedDeployment(event.target.value as string);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error && deployments.length === 0) {
    return (
      <Box p={3}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header with Deployment Selector */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Application Metrics
        </Typography>
        <FormControl sx={{ minWidth: 300 }}>
          <InputLabel shrink>Select Deployment</InputLabel>
          <Select
            value={selectedDeployment}
            onChange={handleDeploymentChange}
            label="Select Deployment"
            disabled={deployments.length === 0}
            displayEmpty
            notched
          >
            <MenuItem value="" disabled>
              {deployments.length === 0 ? 'No deployments available' : 'Select a deployment'}
            </MenuItem>
            {deployments.map(dep => (
              <MenuItem key={dep.name} value={dep.name}>
                {dep.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {deployments.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center">
            <Icon
              icon="mdi:chart-box-outline"
              style={{ marginBottom: 16, color: '#ccc', fontSize: 64 }}
            />
            <Typography variant="h6" color="textSecondary" gutterBottom>
              No Deployments Found
            </Typography>
            <Typography color="textSecondary" variant="body2">
              There are no deployments in this project namespace yet.
            </Typography>
            <Typography color="textSecondary" variant="body2">
              Deploy an application to start viewing metrics.
            </Typography>
          </Box>
        </Card>
      ) : !selectedDeployment ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center">
            <Icon
              icon="mdi:chart-box-outline"
              style={{ marginBottom: 16, color: '#ccc', fontSize: 64 }}
            />
            <Typography color="textSecondary" variant="body1">
              Please select a deployment to view metrics
            </Typography>
          </Box>
        </Card>
      ) : (
        <>
          {/* Summary Cards - Compact Single Row */}
          <Card sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1.5 }}>
              Application Metrics
            </Typography>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <Box sx={{ minWidth: '100px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Project Status
                </Typography>
                <Typography
                  variant="body1"
                  fontWeight="bold"
                  sx={{
                    color: summary.projectStatus === 'Healthy' ? 'success.main' : 'warning.main',
                  }}
                >
                  {summary.projectStatus}
                </Typography>
              </Box>
              <Box sx={{ minWidth: '80px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Total Pods
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {summary.totalPods}
                </Typography>
              </Box>
              <Box sx={{ minWidth: '100px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Request Rate
                </Typography>
                <Typography variant="body1" fontWeight="bold" sx={{ color: 'success.main' }}>
                  {summary.requestRate}
                </Typography>
              </Box>
              <Box sx={{ minWidth: '80px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Error Rate
                </Typography>
                <Typography variant="body1" fontWeight="bold" sx={{ color: 'error.main' }}>
                  {summary.errorRate}
                </Typography>
              </Box>
              <Box sx={{ minWidth: '100px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  CPU Usage
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {summary.cpuUsage}
                </Typography>
              </Box>
              <Box sx={{ minWidth: '100px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Memory Usage
                </Typography>
                <Typography variant="body1" fontWeight="bold">
                  {summary.memoryUsage}
                </Typography>
              </Box>
            </Box>
          </Card>

          {/* Application Health Section */}
          <Typography variant="h6" sx={{ mb: 2 }}>
            Application Health
          </Typography>

          {metricsLoading && cpuData.length === 0 ? (
            <>
              {/* Loading Indicator */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  Loading metrics...
                </Typography>
              </Box>

              {/* Loading Skeletons */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Skeleton variant="text" width={200} height={30} sx={{ mb: 1 }} />
                    <Skeleton variant="rectangular" height={200} />
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Skeleton variant="text" width={200} height={30} sx={{ mb: 1 }} />
                    <Skeleton variant="rectangular" height={200} />
                  </Card>
                </Grid>
              </Grid>
              <Typography variant="h6" sx={{ mb: 2, mt: 3 }}>
                Resource Usage
              </Typography>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Skeleton variant="text" width={150} height={30} sx={{ mb: 1 }} />
                    <Skeleton variant="rectangular" height={200} />
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Skeleton variant="text" width={150} height={30} sx={{ mb: 1 }} />
                    <Skeleton variant="rectangular" height={200} />
                  </Card>
                </Grid>
              </Grid>
            </>
          ) : (
            <>
              {/* Top Row: CPU and Memory */}
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      Request & error rate
                    </Typography>
                    {requestErrorData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={requestErrorData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="timestamp" />
                          <YAxis
                            label={{
                              value: 'Rate',
                              angle: -90,
                              position: 'insideLeft',
                              offset: 10,
                            }}
                          />
                          <Tooltip />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="requestRate"
                            stroke="#4caf50"
                            name="Request Rate"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="errorRate"
                            stroke="#f44336"
                            name="Error Rate"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <Typography color="text.secondary">No data available</Typography>
                    )}
                  </Card>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      Response Time
                    </Typography>
                    {responseTimeData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={responseTimeData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="timestamp" />
                          <YAxis
                            label={{ value: 'ms', angle: -90, position: 'insideLeft', offset: 10 }}
                          />
                          <Tooltip />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="responseTime"
                            stroke="#9c27b0"
                            name="Avg Response Time"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <Typography color="text.secondary">
                        No response time data available
                      </Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>

              {/* Resource Usage Section */}
              <Typography variant="h6" sx={{ mb: 2, mt: 3 }}>
                Resource Usage
              </Typography>

              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      CPU Usage
                    </Typography>
                    {cpuData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={cpuData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="timestamp" />
                          <YAxis
                            label={{
                              value: 'Cores',
                              angle: -90,
                              position: 'insideLeft',
                              offset: 10,
                            }}
                          />
                          <Tooltip />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#2196f3"
                            name="Absolute usage"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <Typography color="text.secondary">No data available</Typography>
                    )}
                  </Card>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      Memory utilization
                    </Typography>
                    {memoryData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={memoryData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="timestamp" />
                          <YAxis
                            label={{
                              value: memoryUnit,
                              angle: -90,
                              position: 'insideLeft',
                              offset: 10,
                            }}
                          />
                          <Tooltip />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#ff9800"
                            name="Absolute usage"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <Typography color="text.secondary">No data available</Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>

              {/* Network Usage - 4th Graph */}
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} md={6}>
                  <Card sx={{ p: 2 }}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      Network I/O
                    </Typography>
                    {networkData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={networkData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="timestamp" />
                          <YAxis
                            label={{
                              value: 'KB/s',
                              angle: -90,
                              position: 'insideLeft',
                              offset: 10,
                            }}
                          />
                          <Tooltip />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="networkIn"
                            stroke="#9c27b0"
                            name="Network In"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="networkOut"
                            stroke="#e91e63"
                            name="Network Out"
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <Typography color="text.secondary">No data available</Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>
            </>
          )}

          {/* Pod Details Table */}
          <Typography variant="h6" sx={{ mb: 2, mt: 3 }}>
            Pod Details - {selectedDeployment}
          </Typography>
          <Card>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Pod Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>CPU</TableCell>
                  <TableCell>Memory</TableCell>
                  <TableCell>Restarts</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pods.length > 0 ? (
                  pods.map(pod => (
                    <TableRow key={pod.name}>
                      <TableCell>{pod.name}</TableCell>
                      <TableCell>
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            color:
                              pod.status === 'Running'
                                ? 'success.main'
                                : pod.status === 'Pending'
                                ? 'warning.main'
                                : pod.status === 'Failed'
                                ? 'error.main'
                                : 'text.secondary',
                          }}
                        >
                          {pod.status === 'Running' && '● '}
                          {pod.status === 'Pending' && '◐ '}
                          {pod.status === 'Failed' && '● '}
                          {pod.status}
                        </Box>
                      </TableCell>
                      <TableCell>{pod.cpuUsage}</TableCell>
                      <TableCell>{pod.memoryUsage}</TableCell>
                      <TableCell>{pod.restarts}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      No pods found for deployment "{selectedDeployment}"
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </Box>
  );
};

export default MetricsTab;
