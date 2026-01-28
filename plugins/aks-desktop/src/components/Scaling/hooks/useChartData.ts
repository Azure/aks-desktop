// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useMemo } from 'react';
import type { DeploymentInfo } from './useDeployments';
import type { HPAInfo } from './useHPAInfo';

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
 * Generates chart data for scaling metrics visualization.
 *
 * Creates 12 data points spanning the last 23 hours (sampled every 2 hours).
 * If real CPU data is available, simulates historical variation; otherwise returns zeros.
 *
 * @param selectedDeployment - Name of the currently selected deployment.
 * @param deployments - List of available deployments.
 * @param hpaInfo - HPA configuration and status, or null if none exists.
 * @returns Array of chart data points in chronological order.
 */
export const useChartData = (
  selectedDeployment: string,
  deployments: DeploymentInfo[],
  hpaInfo: HPAInfo | null
): ChartDataPoint[] => {
  return useMemo(() => {
    const data: ChartDataPoint[] = [];
    const now = new Date();

    // Get current deployment info
    const currentDeployment = deployments.find(d => d.name === selectedDeployment);

    // Use actual data - no fake fallbacks
    const currentReplicas = hpaInfo?.currentReplicas ?? currentDeployment?.readyReplicas ?? 0;
    const currentCPU = hpaInfo?.currentCPUUtilization || 0; // Keep 0 if no real data

    // Generate 12 data points for the last 23 hours (every 2 hours)
    for (let i = 23; i >= 1; i -= 2) {
      const time = new Date(now.getTime() - i * 60 * 60 * 1000);
      const timeString = `${time.getHours().toString().padStart(2, '0')}:00`;

      let replicas = currentReplicas;
      let cpu = currentCPU;

      // Historical data - only simulate if we have real current data
      if (currentCPU > 0) {
        // We have real CPU data, simulate historical variation
        const timeVariation = Math.sin((i / 24) * Math.PI * 2) * 0.3;
        const randomVariation = (Math.random() - 0.5) * 0.2;
        const totalVariation = timeVariation + randomVariation;

        cpu = Math.max(5, Math.min(95, Math.round(currentCPU * (1 + totalVariation))));

        // Simulate scaling based on CPU if HPA exists
        if (hpaInfo && hpaInfo.minReplicas !== undefined && hpaInfo.maxReplicas !== undefined) {
          const targetCPU = hpaInfo.targetCPUUtilization || 50;
          if (cpu > targetCPU * 1.2) {
            replicas = Math.min(
              hpaInfo.maxReplicas,
              currentReplicas + Math.floor(Math.random() * 2)
            );
          } else if (cpu < targetCPU * 0.7) {
            replicas = Math.max(
              hpaInfo.minReplicas,
              currentReplicas - Math.floor(Math.random() * 2)
            );
          } else {
            replicas = Math.max(
              hpaInfo.minReplicas,
              Math.min(hpaInfo.maxReplicas, currentReplicas + Math.floor((Math.random() - 0.5) * 2))
            );
          }
        }
      } else {
        // No real CPU data - keep CPU at 0 and replicas stable
        cpu = 0;
        replicas = currentReplicas;
      }

      data.push({
        time: timeString,
        Replicas: replicas,
        CPU: cpu,
      });
    }

    return data; // Already in chronological order (oldest to newest)
  }, [selectedDeployment, deployments, hpaInfo]);
};
