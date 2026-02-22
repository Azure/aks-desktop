// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getClusterResourceIdAndGroup } from '../../../utils/azure/az-cli';
import { getPrometheusEndpoint } from '../../MetricsTab/getPrometheusEndpoint';
import { queryPrometheus } from '../../MetricsTab/queryPrometheus';

/**
 * A single data point for the scaling chart.
 */
export interface ChartDataPoint {
  /** Formatted time string including day name (e.g., "Wed, 14:00"). */
  time: string;
  /** Number of replicas at this time. */
  Replicas: number;
  /** CPU utilization percentage at this time. */
  CPU: number;
}

/**
 * Result of the useChartData hook including loading and error states.
 */
export interface UseChartDataResult {
  /** Array of chart data points in chronological order. */
  chartData: ChartDataPoint[];
  /** Whether the chart data is currently loading. */
  loading: boolean;
  /** Error message if data fetching failed, null otherwise. */
  error: string | null;
}

// Module-level caches persist across component remounts to avoid refetching
// the same chart data and endpoint repeatedly in the same session.
let chartDataCache: { key: string; data: ChartDataPoint[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache for Prometheus endpoint (keyed by resourceGroup:cluster:subscription)
const promEndpointCache = new Map<string, string>();

/** Clears all module-level caches. Exported for testing only. */
export function clearChartDataCaches(): void {
  chartDataCache = null;
  promEndpointCache.clear();
}

function getCachedChartData(cacheKey: string): ChartDataPoint[] | null {
  if (!chartDataCache || chartDataCache.key !== cacheKey) {
    return null;
  }

  return Date.now() - chartDataCache.timestamp < CACHE_TTL_MS ? chartDataCache.data : null;
}

/**
 * Fetches real chart data from Prometheus for scaling metrics visualization.
 *
 * Queries Prometheus for replica count and CPU usage history over the last 24 hours.
 *
 * @param selectedDeployment - Name of the currently selected deployment.
 * @param namespace - The Kubernetes namespace.
 * @param cluster - The cluster name.
 * @param subscription - The Azure subscription ID.
 * @param resourceGroupLabel - The resource group from namespace labels (optional).
 * @returns Object containing chartData array, loading state, and error state.
 */
export const useChartData = (
  selectedDeployment: string,
  namespace: string,
  cluster: string,
  subscription: string | undefined,
  resourceGroupLabel: string | undefined
): UseChartDataResult => {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);

  const fetchChartData = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    const isLatestRequest = () => latestRequestIdRef.current === requestId;
    const applyIfLatest = (callback: () => void) => {
      if (isLatestRequest()) {
        callback();
      }
    };

    if (!namespace || !selectedDeployment || !cluster || !subscription) {
      applyIfLatest(() => {
        setChartData([]);
        setError(null);
        setLoading(false);
      });
      return;
    }

    try {
      applyIfLatest(() => {
        setLoading(true);
        setError(null);
      });

      // Extract resource group from label if available, otherwise fetch
      let resourceGroup = resourceGroupLabel;

      if (!resourceGroup) {
        const result = await getClusterResourceIdAndGroup(cluster, subscription);
        resourceGroup = result?.resourceGroup;

        if (!resourceGroup) {
          throw new Error('Could not find resource group for cluster');
        }
      }

      // Return cached data if the same parameters were queried recently.
      // Include resolved resource group to avoid cross-resource-group cache collisions.
      const cacheKey = `${selectedDeployment}:${namespace}:${cluster}:${subscription}:${resourceGroup}`;
      const cachedChartData = getCachedChartData(cacheKey);
      if (cachedChartData) {
        applyIfLatest(() => {
          setChartData(cachedChartData);
          setError(null);
        });
        return;
      }

      const endpointKey = `${resourceGroup}:${cluster}:${subscription}`;
      let promEndpoint = promEndpointCache.get(endpointKey);
      if (!promEndpoint) {
        promEndpoint = await getPrometheusEndpoint(resourceGroup, cluster, subscription);
        promEndpointCache.set(endpointKey, promEndpoint);
      }

      const end = Math.floor(Date.now() / 1000);
      const start = end - 86400; // Last 24 hours
      const step = 7200; // Data point every 2 hours

      // Query replica count and CPU usage in parallel
      const replicaQuery = `kube_deployment_spec_replicas{deployment="${selectedDeployment}",namespace="${namespace}"}`;
      const cpuQuery = `100 * (sum by (namespace) (rate(container_cpu_usage_seconds_total{namespace="${namespace}", pod=~"${selectedDeployment}-.*", container!=""}[5m])) / sum by (namespace) (kube_pod_container_resource_limits{namespace="${namespace}", pod=~"${selectedDeployment}-.*", resource="cpu"}))`;

      const [replicaResults, cpuResults] = await Promise.all([
        queryPrometheus(promEndpoint, replicaQuery, start, end, step, subscription),
        queryPrometheus(promEndpoint, cpuQuery, start, end, step, subscription),
      ]);

      // Merge replica and CPU data by timestamp
      const mergedData: ChartDataPoint[] = [];
      const replicaValues = replicaResults[0]?.values || [];
      const cpuValues = cpuResults[0]?.values || [];
      const dayFormatter = new Intl.DateTimeFormat([], { weekday: 'short' });
      const timeFormatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });

      // Create a map of timestamps to CPU values for easier lookup
      const cpuMap = new Map<number, number>();
      cpuValues.forEach(([timestamp, value]: [number, string]) => {
        const parsedCpu = parseFloat(value);
        cpuMap.set(timestamp, Number.isFinite(parsedCpu) ? parsedCpu : 0);
      });

      // Iterate through replica values and match with CPU
      replicaValues.forEach(([timestamp, replicaValue]: [number, string]) => {
        const date = new Date(timestamp * 1000);
        const day = dayFormatter.format(date);
        const time = timeFormatter.format(date);
        const timeString = `${day}, ${time}`;

        const parsedReplicas = parseInt(replicaValue, 10);
        const replicas = Number.isFinite(parsedReplicas) ? parsedReplicas : 0;
        const cpu = cpuMap.get(timestamp) || 0;

        mergedData.push({
          time: timeString,
          Replicas: replicas,
          CPU: Math.round(cpu),
        });
      });

      chartDataCache = { key: cacheKey, data: mergedData, timestamp: Date.now() };
      applyIfLatest(() => setChartData(mergedData));
    } catch (err) {
      console.error('Failed to fetch chart data from Prometheus:', err);
      applyIfLatest(() => {
        const nextError = err instanceof Error ? err.message : 'Failed to fetch scaling data';
        setError(nextError);
        setChartData([]);
      });
    } finally {
      applyIfLatest(() => setLoading(false));
    }
  }, [namespace, selectedDeployment, cluster, subscription, resourceGroupLabel]);

  useEffect(() => {
    fetchChartData();
  }, [fetchChartData]);

  useEffect(() => {
    return () => {
      // Invalidate any in-flight async work for this hook instance.
      latestRequestIdRef.current += 1;
    };
  }, []);

  return { chartData, loading, error };
};
