// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getClusterResourceIdAndGroup } from '../../../utils/azure/az-clusters';
import {
  METRICS_REFRESH_INTERVAL_MS,
  PROMETHEUS_QUERY_RANGE_SECONDS,
  PROMETHEUS_STEP_SECONDS,
} from '../../../utils/constants/timing';
import { getPrometheusEndpoint } from '../../../utils/prometheus/getPrometheusEndpoint';
import { queryPrometheus } from '../../../utils/prometheus/queryPrometheus';
import { formatMemoryBrief, safeParseFloat } from '../utils';

/** Metric values to be displayed on the MetricsCard. */
export interface CardMetricData {
  cpuUsage: string;
  memoryUsage: string;
  requestRate: string;
  errorRate: string;
}

const defaultCardMetrics: CardMetricData = {
  cpuUsage: 'N/A',
  memoryUsage: 'N/A',
  requestRate: 'N/A',
  errorRate: 'N/A',
};

const metricsCache = new Map<string, { data: CardMetricData; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Prometheus endpoint cache. */
const promEndpointCache = new Map<string, string>();

/** Clears all card metric caches */
export function clearCardMetricsCaches(): void {
  metricsCache.clear();
  promEndpointCache.clear();
}

/** Result returned by {@link useCardMetrics}. */
export interface UseCardMetricsResult {
  /** Metric values to be displayed on the MetricsCard. */
  metrics: CardMetricData;
  /** Whether metrics are being fetched. */
  metricsLoading: boolean;
}

/**
 * Fetches summarized Prometheus metrics for the MetricsCard.
 *
 * Queries CPU, memory, request rate, & error rate for the selected deployment
 * for the last 5 minutes. Polls every 30 seconds. Caches results for 5 minutes.
 *
 * @param namespace - Kubernetes namespace.
 * @param cluster - Cluster context name.
 * @param selectedDeployment - Currently selected deployment name.
 * @param subscription - Azure Subscription ID.
 * @param resourceGroupLabel - Resource group label from namespace metadata.
 */
export function useCardMetrics(
  namespace: string | undefined,
  cluster: string | undefined,
  selectedDeployment: string,
  subscription: string | undefined,
  resourceGroupLabel: string | undefined
): UseCardMetricsResult {
  const [metrics, setMetrics] = useState<CardMetricData>(defaultCardMetrics);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const prevDeploymentRef = useRef<string>(selectedDeployment);
  const latestRequestIdRef = useRef<number>(0);

  // Show loading when selected deployment changes
  useEffect(() => {
    if (selectedDeployment && selectedDeployment !== prevDeploymentRef.current) {
      const cacheKey = `${selectedDeployment}:${namespace}:${cluster}:${subscription}`;
      const cached = metricsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setMetrics(cached.data);
        setMetricsLoading(false);
      } else {
        setMetrics(defaultCardMetrics);
        setMetricsLoading(true);
      }
      prevDeploymentRef.current = selectedDeployment;
    }
  }, [selectedDeployment, namespace, cluster, subscription]);

  const fetchMetrics = useCallback(async () => {
    if (!namespace || !selectedDeployment || !subscription || !cluster) return;

    const cacheKey = `${selectedDeployment}:${namespace}:${cluster}:${subscription}`;
    const requestId = ++latestRequestIdRef.current;

    try {
      let resourceGroup = resourceGroupLabel;

      if (!resourceGroup) {
        const result = await getClusterResourceIdAndGroup(cluster, subscription);
        resourceGroup = result.resourceGroup;

        if (!resourceGroup) {
          throw new Error('Could not find resource group for cluster');
        }
      }

      const endpointKey = `${resourceGroup}:${cluster}:${subscription}`;
      let promEndpoint = promEndpointCache.get(endpointKey);
      if (!promEndpoint) {
        promEndpoint = await getPrometheusEndpoint(resourceGroup, cluster, subscription);
        promEndpointCache.set(endpointKey, promEndpoint);
      }

      const end = Math.floor(Date.now() / 1000);
      const start = end - PROMETHEUS_QUERY_RANGE_SECONDS;
      const step = PROMETHEUS_STEP_SECONDS;

      // Prometheus Queries
      const escapedDeployment = selectedDeployment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const podPattern = `${escapedDeployment}-[a-z0-9]+-[a-z0-9]+`;
      const cpuQuery = `sum by (namespace) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"${podPattern}", container!=""}[5m]))`;
      const memoryQuery = `sum by (namespace) (container_memory_working_set_bytes{namespace="${namespace}", pod=~"${podPattern}", container!=""})`;
      const requestQuery = `sum by (namespace) (rate(http_requests_total{namespace="${namespace}"}[5m]))`;
      const errorQuery = `100 * (sum by (namespace) (rate(http_requests_total{namespace="${namespace}", status=~"4..|5.."}[5m])) / sum by (namespace) (rate(http_requests_total{namespace="${namespace}"}[5m])))`;

      const [cpuResults, memoryResults, requestResults, errorResults] = await Promise.all([
        queryPrometheus(promEndpoint, cpuQuery, start, end, step, subscription),
        queryPrometheus(promEndpoint, memoryQuery, start, end, step, subscription),
        queryPrometheus(promEndpoint, requestQuery, start, end, step, subscription),
        queryPrometheus(promEndpoint, errorQuery, start, end, step, subscription),
      ]);

      // Discard results if a newer request has been issued
      if (requestId !== latestRequestIdRef.current) return;

      const newMetrics: CardMetricData = { ...defaultCardMetrics };

      if (cpuResults.length > 0 && cpuResults[0].values?.length > 0) {
        const latestValue = cpuResults[0].values[cpuResults[0].values.length - 1];
        const cpuCores = safeParseFloat(latestValue[1]);
        newMetrics.cpuUsage = `${cpuCores.toFixed(3)} cores`;
      }

      if (memoryResults.length > 0 && memoryResults[0].values?.length > 0) {
        const latestValue = memoryResults[0].values[memoryResults[0].values.length - 1];
        const memoryBytes = safeParseFloat(latestValue[1]);
        newMetrics.memoryUsage = formatMemoryBrief(memoryBytes);
      }

      if (requestResults.length > 0 && requestResults[0].values?.length > 0) {
        const latestValue = requestResults[0].values[requestResults[0].values.length - 1];
        const reqRate = safeParseFloat(latestValue[1]);
        newMetrics.requestRate = `${reqRate.toFixed(2)} req/s`;
      }

      if (errorResults.length > 0 && errorResults[0].values?.length > 0) {
        const latestValue = errorResults[0].values[errorResults[0].values.length - 1];
        const errRate = safeParseFloat(latestValue[1]);
        newMetrics.errorRate = `${errRate.toFixed(1)}%`;
      }

      metricsCache.set(cacheKey, { data: newMetrics, timestamp: Date.now() });
      setMetrics(newMetrics);
    } catch (error) {
      if (requestId !== latestRequestIdRef.current) return;
      console.error('MetricsCard: Failed to fetch Prometheus metrics:', error);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setMetricsLoading(false);
      }
    }
  }, [namespace, cluster, selectedDeployment, subscription, resourceGroupLabel]);

  // Load metrics when deployment is selected
  useEffect(() => {
    if (!selectedDeployment || !namespace || !cluster || !subscription) return;

    // Restore from cache immediately if fresh (e.g. returning from another tab), otherwise show loading
    const cacheKey = `${selectedDeployment}:${namespace}:${cluster}:${subscription}`;
    const cached = metricsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setMetrics(cached.data);
    } else {
      setMetricsLoading(true);
    }

    fetchMetrics();

    const interval = setInterval(fetchMetrics, METRICS_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMetrics, selectedDeployment]);

  return { metrics, metricsLoading };
}
