// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import { getClusterResourceIdAndGroup } from '../../../utils/azure/az-cli';
import { getPrometheusEndpoint } from '../../MetricsTab/getPrometheusEndpoint';
import { queryPrometheus } from '../../MetricsTab/queryPrometheus';

/**
 * A single data point for the scaling chart.
 */
export interface ChartDataPoint {
  /** Formatted time string (e.g., "14:00"). */
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

/**
 * Fetches real chart data from Prometheus for scaling metrics visualization.
 *
 * Queries Prometheus for replica count and CPU usage history over the last 2 hours.
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

  const fetchChartData = useCallback(async () => {
    if (!namespace || !selectedDeployment || !cluster || !subscription) {
      setChartData([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Extract resource group from label if available, otherwise fetch
      let resourceGroup = resourceGroupLabel;

      if (!resourceGroup) {
        const result = await getClusterResourceIdAndGroup(cluster, subscription);
        resourceGroup = result?.resourceGroup;

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
    } catch (err) {
      console.error('Failed to fetch chart data from Prometheus:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch chart data');
      setChartData([]);
    } finally {
      setLoading(false);
    }
  }, [namespace, selectedDeployment, cluster, subscription, resourceGroupLabel]);

  useEffect(() => {
    fetchChartData();
  }, [fetchChartData]);

  return { chartData, loading, error };
};
