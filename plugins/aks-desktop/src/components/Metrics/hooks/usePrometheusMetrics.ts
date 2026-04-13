// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getClusterResourceIdAndGroup } from '../../../utils/azure/az-clusters';
import {
  METRICS_REFRESH_INTERVAL_MS,
  PROMETHEUS_CHART_RANGE_SECONDS,
  PROMETHEUS_STEP_SECONDS,
} from '../../../utils/constants/timing';
import { getPrometheusEndpoint } from '../../../utils/prometheus/getPrometheusEndpoint';
import { queryPrometheus } from '../../../utils/prometheus/queryPrometheus';
import {
  type ChartDataPoint,
  convertBytesToUnit,
  defaultMetricSummary,
  formatMemoryBrief,
  type MemoryUnit,
  type MetricSummary,
  type NetworkDataPoint,
  pickMemoryUnit,
  type RequestErrorDataPoint,
  type ResponseTimeDataPoint,
  safeParseFloat,
} from '../utils';
import type { PodInfo } from './usePods';

/** Cached snapshot of all MetricsTab data. */
interface MetricsSnapshot {
  summary: MetricSummary;
  cpuData: ChartDataPoint[];
  memoryData: ChartDataPoint[];
  requestErrorData: RequestErrorDataPoint[];
  responseTimeData: ResponseTimeDataPoint[];
  networkData: NetworkDataPoint[];
  memoryUnit: MemoryUnit;
}

const metricsTabCache = new Map<string, { data: MetricsSnapshot; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Prometheus endpoint cache. */
const promEndpointCache = new Map<string, string>();

/** Clears all metric tab caches. */
export function clearMetricsTabCaches(): void {
  metricsTabCache.clear();
  promEndpointCache.clear();
}

/** Metrics returned by {@link usePrometheusMetrics}. */
export interface UsePrometheusMetricsResult {
  /** Combined summary of all metrics. */
  summary: MetricSummary;
  /** CPU usage data points. */
  cpuData: ChartDataPoint[];
  /** Memory usage data points. */
  memoryData: ChartDataPoint[];
  /** Request error rate data points. */
  requestErrorData: RequestErrorDataPoint[];
  /** Response time data points. */
  responseTimeData: ResponseTimeDataPoint[];
  /** Network I/O data points. */
  networkData: NetworkDataPoint[];
  /** Memory unit used for displaying memory metrics. */
  memoryUnit: MemoryUnit;
  /** Indicates if metrics are currently being loaded. */
  metricsLoading: boolean;
  /** Indicates if metrics have been successfully fetched at least once. */
  hasFetchedMetrics: boolean;
  /** Error message if any is encountered while fetching metrics. */
  error: string | null;
}

/**
 * Fetches and processes Prometheus metrics for the selected deployment.
 *
 * Runs 9 PromQL queries in parallel (CPU, memory, request rate, error rate,
 * response time, network I/O, and per-pod breakdowns), then transforms the
 * results into data for the charts & aggregated summaries. Polls every 30 seconds.
 *
 * @param namespace - Managed namespace for the selected deployment.
 * @param cluster - Name of target cluster.
 * @param selectedDeployment - Name of the currently selected deployment.
 * @param subscription - Azure subscription ID.
 * @param resourceGroupLabel - Resource group label from namespace metadata, if available.
 * @param setPods - Setter used to enrich pod rows with per-pod CPU/memory data.
 */
export function usePrometheusMetrics(
  namespace: string | undefined,
  cluster: string | undefined,
  selectedDeployment: string,
  subscription: string | undefined,
  resourceGroupLabel: string | undefined,
  setPods: React.Dispatch<React.SetStateAction<PodInfo[]>>
): UsePrometheusMetricsResult {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<MetricSummary>(defaultMetricSummary);
  const [cpuData, setCpuData] = useState<ChartDataPoint[]>([]);
  const [memoryData, setMemoryData] = useState<ChartDataPoint[]>([]);
  const [requestErrorData, setRequestErrorData] = useState<RequestErrorDataPoint[]>([]);
  const [responseTimeData, setResponseTimeData] = useState<ResponseTimeDataPoint[]>([]);
  const [networkData, setNetworkData] = useState<NetworkDataPoint[]>([]);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [hasFetchedMetrics, setHasFetchedMetrics] = useState<boolean>(false);
  const [memoryUnit, setMemoryUnit] = useState<MemoryUnit>('MB');
  const [error, setError] = useState<string | null>(null);
  const prevDeploymentRef = useRef<string>(selectedDeployment);
  const latestRequestIdRef = useRef<number>(0);

  /** Restore state from a given cached snapshot. */
  const restoreFromCache = useCallback((snapshot: MetricsSnapshot) => {
    setSummary(snapshot.summary);
    setCpuData(snapshot.cpuData);
    setMemoryData(snapshot.memoryData);
    setRequestErrorData(snapshot.requestErrorData);
    setResponseTimeData(snapshot.responseTimeData);
    setNetworkData(snapshot.networkData);
    setMemoryUnit(snapshot.memoryUnit);
  }, []);

  // Handle deployment switching; Restore from cache if within window, or show loading
  useEffect(() => {
    if (selectedDeployment && selectedDeployment !== prevDeploymentRef.current) {
      const cacheKey = `${selectedDeployment}:${namespace}:${cluster}:${subscription}`;
      const cached = metricsTabCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        restoreFromCache(cached.data);
        setError(null);
        setMetricsLoading(false);
      } else {
        setSummary(defaultMetricSummary);
        setCpuData([]);
        setMemoryData([]);
        setRequestErrorData([]);
        setResponseTimeData([]);
        setNetworkData([]);
        setMetricsLoading(true);
      }
      prevDeploymentRef.current = selectedDeployment;
    }
  }, [selectedDeployment, namespace, cluster, subscription, restoreFromCache]);

  const fetchMetrics = useCallback(async () => {
    if (!namespace || !selectedDeployment || !subscription || !cluster) return;

    const cacheKey = `${selectedDeployment}:${namespace}:${cluster}:${subscription}`;
    const requestId = ++latestRequestIdRef.current;
    setError(null);

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

      const promEndpointKey = `${resourceGroup}:${cluster}:${subscription}`;
      let promEndpoint = promEndpointCache.get(promEndpointKey);
      if (!promEndpoint) {
        promEndpoint = await getPrometheusEndpoint(resourceGroup, cluster, subscription);
        promEndpointCache.set(promEndpointKey, promEndpoint);
      }

      const end = Math.floor(Date.now() / 1000);
      const start = end - PROMETHEUS_CHART_RANGE_SECONDS;
      const step = PROMETHEUS_STEP_SECONDS;

      // Escape regex metacharacters in deployment name for PromQL pod matcher
      const escapedDeployment = selectedDeployment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const podPattern = `${escapedDeployment}-[a-z0-9]+-[a-z0-9]+`;

      // Query CPU usage
      const cpuQuery = `sum by (namespace) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"${podPattern}", container!=""}[5m]))`;
      const cpuResultsPromise = queryPrometheus(
        promEndpoint,
        cpuQuery,
        start,
        end,
        step,
        subscription
      );
      const cpuByPodQuery = `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"${podPattern}", container!=""}[5m]))`;
      const cpuByPodResultsPromise = queryPrometheus(
        promEndpoint,
        cpuByPodQuery,
        start,
        end,
        step,
        subscription
      );

      // Query Memory usage (container_memory_usage_bytes seems to be giving issues)
      const memoryQuery = `sum by (namespace) (container_memory_working_set_bytes{namespace="${namespace}", pod=~"${podPattern}", container!=""})`;
      const memoryResultsPromise = queryPrometheus(
        promEndpoint,
        memoryQuery,
        start,
        end,
        step,
        subscription
      );
      const memoryByPodQuery = `sum by (pod) (container_memory_working_set_bytes{namespace="${namespace}", pod=~"${podPattern}", container!=""})`;
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
      const networkInQuery = `sum by (namespace) (rate(container_network_receive_bytes_total{namespace="${namespace}", pod=~"${podPattern}"}[5m]))`;
      const networkOutQuery = `sum by (namespace) (rate(container_network_transmit_bytes_total{namespace="${namespace}", pod=~"${podPattern}"}[5m]))`;
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

      // Discard results if a newer request has been issued
      if (requestId !== latestRequestIdRef.current) return;

      /** Snapshot to cache alongside state updates */
      const snapshot: MetricsSnapshot = {
        summary: { ...defaultMetricSummary },
        cpuData: [],
        memoryData: [],
        requestErrorData: [],
        responseTimeData: [],
        networkData: [],
        memoryUnit: 'MB',
      };

      // Process CPU data
      if (cpuResults.length > 0 && cpuResults[0].values) {
        snapshot.cpuData = cpuResults[0].values.map((v: [number, string]) => {
          const cores = safeParseFloat(v[1]);
          return {
            timestamp: new Date(v[0] * 1000).toLocaleTimeString(),
            value: parseFloat(cores.toFixed(4)),
          };
        });
        setCpuData(snapshot.cpuData);

        // Get latest value for summary
        const latestCpu = cpuResults[0].values[cpuResults[0].values.length - 1];
        if (latestCpu) {
          const latestCores = safeParseFloat(latestCpu[1]);
          snapshot.summary.cpuUsage = `${latestCores.toFixed(3)} cores`;
        }
      }

      // Process Memory data
      if (memoryResults.length > 0 && memoryResults[0].values) {
        const bytesSamples = memoryResults[0].values.map((v: [number, string]) =>
          safeParseFloat(v[1])
        );
        const unit = pickMemoryUnit(bytesSamples);
        const decimals = unit === 'GB' ? 3 : 2;
        snapshot.memoryUnit = unit;

        snapshot.memoryData = memoryResults[0].values.map((v: [number, string]) => {
          const bytes = safeParseFloat(v[1]);
          const converted = convertBytesToUnit(bytes, unit);
          return {
            timestamp: new Date(v[0] * 1000).toLocaleTimeString(),
            value: parseFloat(converted.toFixed(decimals)),
          };
        });
        setMemoryData(snapshot.memoryData);
        setMemoryUnit(unit);

        // Get latest value for summary
        const latestMem = memoryResults[0].values[memoryResults[0].values.length - 1];
        if (latestMem) {
          const latestBytes = safeParseFloat(latestMem[1]);
          const latestValue = convertBytesToUnit(latestBytes, unit);
          snapshot.summary.memoryUsage = `${latestValue.toFixed(decimals)} ${unit}`;
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
        const cores = safeParseFloat(latestSample[1]);
        if (isFinite(cores)) {
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
        const bytes = safeParseFloat(latestSample[1]);
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
      if (requestResults.length > 0 && requestResults[0].values) {
        requestResults[0].values.forEach((v: [number, string], idx: number) => {
          const timestamp = new Date(v[0] * 1000).toLocaleTimeString();
          const requestRate = safeParseFloat(v[1]);
          const errorRate =
            errorResults.length > 0 && errorResults[0].values[idx]
              ? safeParseFloat(errorResults[0].values[idx][1])
              : 0;

          snapshot.requestErrorData.push({
            timestamp,
            requestRate: parseFloat(requestRate.toFixed(2)),
            errorRate: parseFloat(errorRate.toFixed(2)),
          });
        });
        setRequestErrorData(snapshot.requestErrorData);

        // Get latest values for summary
        if (snapshot.requestErrorData.length > 0) {
          const latest = snapshot.requestErrorData[snapshot.requestErrorData.length - 1];
          snapshot.summary.requestRate = `${latest.requestRate}/sec`;
          snapshot.summary.errorRate = `${latest.errorRate}%`;
        }
      }

      // Process Network data (combined in/out)
      if (networkInResults.length > 0 && networkInResults[0].values) {
        networkInResults[0].values.forEach((v: [number, string], idx: number) => {
          const timestamp = new Date(v[0] * 1000).toLocaleTimeString();
          const networkIn = safeParseFloat(v[1]) / 1024; // Convert to KB/s
          const networkOut =
            networkOutResults.length > 0 && networkOutResults[0].values[idx]
              ? safeParseFloat(networkOutResults[0].values[idx][1]) / 1024
              : 0;

          snapshot.networkData.push({
            timestamp,
            networkIn: parseFloat(networkIn.toFixed(2)),
            networkOut: parseFloat(networkOut.toFixed(2)),
          });
        });
        setNetworkData(snapshot.networkData);
      }

      // Process Response Time data
      if (responseTimeResults.length > 0 && responseTimeResults[0].values) {
        snapshot.responseTimeData = responseTimeResults[0].values.map((v: [number, string]) => ({
          timestamp: new Date(v[0] * 1000).toLocaleTimeString(),
          responseTime: parseFloat((safeParseFloat(v[1]) * 1000).toFixed(2)), // Convert to milliseconds
        }));
        setResponseTimeData(snapshot.responseTimeData);
      }

      setSummary(snapshot.summary);
      metricsTabCache.set(cacheKey, { data: snapshot, timestamp: Date.now() });
    } catch (error) {
      if (requestId !== latestRequestIdRef.current) return;
      console.error('MetricsTab: Failed to fetch metrics:', error);
      const errorMessage =
        error instanceof Error ? error.message : t('Failed to fetch metrics from Prometheus');
      setError(errorMessage);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setMetricsLoading(false);
        setHasFetchedMetrics(true);
      }
    }
  }, [namespace, cluster, selectedDeployment, subscription, resourceGroupLabel, setPods]);

  // Load metrics when deployment is selected
  useEffect(() => {
    if (!selectedDeployment || !namespace || !subscription || !cluster) return;

    // Restore from cache immediately if fresh (e.g. returning from another tab), otherwise show loading
    const cacheKey = `${selectedDeployment}:${namespace}:${cluster}:${subscription}`;
    const cached = metricsTabCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      restoreFromCache(cached.data);
      setError(null);
    } else {
      setMetricsLoading(true);
    }

    fetchMetrics();

    const interval = setInterval(fetchMetrics, METRICS_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMetrics, selectedDeployment, namespace, subscription, cluster]);

  return {
    summary,
    cpuData,
    memoryData,
    requestErrorData,
    responseTimeData,
    networkData,
    memoryUnit,
    metricsLoading,
    hasFetchedMetrics,
    error,
  };
}
