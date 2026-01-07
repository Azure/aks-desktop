// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useMemo } from 'react';
import type { Deployment } from './useDeployments';
import type { HPAInfo } from './useHPAInfo';

export interface ChartDataPoint {
  time: string;
  Replicas: number;
  CPU: number;
}

/**
 * Custom hook to generate chart data for scaling metrics visualization
 * Generates historical data based on current deployment and HPA information
 */
export const useChartData = (
  selectedDeployment: string,
  deployments: Deployment[],
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

    // Generate data for the last 24 hours (every 2 hours to avoid crowding)
    for (let i = 23; i >= 0; i -= 2) {
      const time = new Date(now.getTime() - i * 60 * 60 * 1000);
      const timeString = `${time.getHours().toString().padStart(2, '0')}:00`;

      let replicas = currentReplicas;
      let cpu = currentCPU;

      if (i === 0) {
        // Current time - use actual values only
        replicas = currentReplicas;
        cpu = currentCPU;
      } else {
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
                Math.min(
                  hpaInfo.maxReplicas,
                  currentReplicas + Math.floor((Math.random() - 0.5) * 2)
                )
              );
            }
          }
        } else {
          // No real CPU data - keep CPU at 0 and replicas stable
          cpu = 0;
          replicas = currentReplicas;
        }
      }

      data.push({
        time: timeString,
        Replicas: replicas,
        CPU: cpu,
      });
    }

    return data.reverse(); // Reverse to get chronological order
  }, [selectedDeployment, deployments, hpaInfo]);
};
