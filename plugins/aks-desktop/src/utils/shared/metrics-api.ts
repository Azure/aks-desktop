// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { runCommand } from '@kinvolk/headlamp-plugin/lib';
import { subHours } from 'date-fns';

declare const pluginRunCommand: typeof runCommand;

// Helper function to run Azure CLI commands
async function runAz(command: string): Promise<string> {
  console.log('Running Azure CLI command:', command.split(' ')[0], '...');

  try {
    // Special handling for date parameters which may contain spaces
    const parts = [];
    let inQuote = false;
    let buffer = '';

    // Parse the command respecting quoted strings
    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (char === '"') {
        inQuote = !inQuote;
        buffer += char;
      } else if (char === ' ' && !inQuote) {
        if (buffer) {
          parts.push(buffer);
          buffer = '';
        }
      } else {
        buffer += char;
      }
    }

    // Add the last buffer if it exists
    if (buffer) {
      parts.push(buffer);
    }

    // Get command and args
    const args = parts.slice(1);

    console.log('Command parsed with special handling for quotes');
    console.log('Command arguments:', args);

    return new Promise((resolve, reject) => {
      const cmd = pluginRunCommand('az', args, {});
      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (data: string) => {
        stdout += data;
      });

      cmd.stderr.on('data', (data: string) => {
        stderr += data;
        console.warn('Azure CLI stderr:', data);
      });

      cmd.on('exit', (code: number) => {
        console.log('Azure CLI command completed with code:', code);
        if (code === 0) {
          console.log('Command output length:', stdout.length);
          resolve(stdout);
        } else {
          console.error('Command failed with stderr:', stderr);
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      cmd.on('error', err => {
        console.error('Command execution error:', err);
        reject(new Error(`Command execution error: ${err.message}`));
      });
    });
  } catch (error) {
    console.error('Error executing Azure CLI command:', error);
    throw error;
  }
}

export interface MetricDataPoint {
  timestamp: string;
  value: number;
}

export interface MetricData {
  value: number;
  unit: string;
  change: number;
  changeDirection: 'up' | 'down';
  health: 'good' | 'warning' | 'critical';
  data: MetricDataPoint[];
}

export interface ClusterMetrics {
  cpu: MetricData;
  memory: MetricData;
  latency: MetricData;
  requestRate: MetricData;
  errorRate: MetricData;
  noMetricsAvailable?: boolean;
  message?: string;
}

// Helper function to calculate percent change between first and last value
const calculatePercentChange = (data: MetricDataPoint[]): number => {
  if (!data || data.length < 2) return 0;

  const firstValue = data[0].value;
  const lastValue = data[data.length - 1].value;

  if (firstValue === 0) return 0;
  return ((lastValue - firstValue) / firstValue) * 100;
};

// Helper function to determine health status based on metric value
const determineHealth = (metric: string, value: number): 'good' | 'warning' | 'critical' => {
  switch (metric) {
    case 'cpu':
      if (value > 80) return 'critical';
      if (value > 60) return 'warning';
      return 'good';
    case 'memory':
      if (value > 85) return 'critical';
      if (value > 70) return 'warning';
      return 'good';
    case 'latency':
      if (value > 500) return 'critical';
      if (value > 200) return 'warning';
      return 'good';
    case 'requestRate':
      return 'good'; // Request rate doesn't have critical thresholds by itself
    case 'errorRate':
      if (value > 1) return 'critical';
      if (value > 0.1) return 'warning';
      return 'good';
    default:
      return 'good';
  }
};

// Parse error message to extract valid metrics
const extractValidMetricsFromError = (errorMessage: string): string[] => {
  if (!errorMessage || !errorMessage.includes('Valid metrics:')) {
    return [];
  }

  const match = errorMessage.match(/Valid metrics: (.*)/);
  if (match && match[1]) {
    return match[1].split(',').map(m => m.trim());
  }

  return [];
};

// Helper function to try multiple metric names
const tryMultipleMetrics = async (
  resourceId: string,
  metricNames: string[],
  metricType: string
): Promise<{ metricJson: string | null; successMetric: string | null }> => {
  let metricJson = null;
  let successMetric = null;

  for (const metricName of metricNames) {
    try {
      console.log(`Trying ${metricType} metric: ${metricName}`);
      const cmd = `az monitor metrics list --resource ${resourceId} --metric ${metricName} --interval PT5M --output json`;
      metricJson = await runAz(cmd);
      console.log(`Metric ${metricName} succeeded`);
      successMetric = metricName;
      break;
    } catch (error) {
      console.error(`Metric ${metricName} failed:`, error);

      // If we get a valid metrics error, update our list of metrics to try
      if (error instanceof Error) {
        const validMetrics = extractValidMetricsFromError(error.message);
        if (validMetrics.length > 0) {
          // Filter metrics by type (cpu/memory)
          const relevantMetrics = validMetrics.filter(m =>
            m.includes(metricType === 'cpu' ? 'cpu' : 'memory')
          );

          if (relevantMetrics.length > 0 && !metricNames.includes(relevantMetrics[0])) {
            // Try the first relevant metric if it's not already in our list
            try {
              console.log(
                `Trying suggested ${metricType} metric from error: ${relevantMetrics[0]}`
              );
              const suggestedCmd = `az monitor metrics list --resource ${resourceId} --metric ${relevantMetrics[0]} --interval PT5M --output json`;
              metricJson = await runAz(suggestedCmd);
              console.log(`Suggested metric ${relevantMetrics[0]} succeeded`);
              successMetric = relevantMetrics[0];
              break;
            } catch (suggestedError) {
              console.error(`Suggested metric ${relevantMetrics[0]} failed:`, suggestedError);
            }
          }
        }
      }
    }
  }

  return { metricJson, successMetric };
};

// Function to fetch metrics from Azure Monitor API
export async function getClusterMetricsFromAzure(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  startTime: Date,
  endTime: Date
): Promise<ClusterMetrics | null> {
  try {
    // Format the dates for Azure CLI
    const startTimeStr = `"${startTime.toISOString()}"`;
    const endTimeStr = `"${endTime.toISOString()}"`;

    console.log('Using date format:');
    console.log('- Start time:', startTimeStr);
    console.log('- End time:', endTimeStr);

    // Build the resource ID for the AKS cluster
    const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
    console.log('Using Azure resource ID:', resourceId);

    // CPU metrics - try multiple valid metrics
    const cpuMetricNames = [
      'node_cpu_usage_percentage', // Try without quotes first
      'node_cpu_usage_millicores', // Alternative metric
      'apiserver_cpu_usage_percentage', // Another alternative
    ];

    const { metricJson: cpuMetricsJson, successMetric: cpuMetricName } = await tryMultipleMetrics(
      resourceId,
      cpuMetricNames,
      'cpu'
    );

    let cpuData: MetricDataPoint[] = [];
    let lastCpuValue = 0;
    let cpuUnit = '%';

    if (cpuMetricsJson) {
      try {
        const cpuMetrics = JSON.parse(cpuMetricsJson);
        if (
          cpuMetrics.value &&
          cpuMetrics.value.length > 0 &&
          cpuMetrics.value[0].timeseries &&
          cpuMetrics.value[0].timeseries.length > 0
        ) {
          const timeseries = cpuMetrics.value[0].timeseries[0];
          cpuData = timeseries.data
            .filter((point: any) => point.average !== null)
            .map((point: any) => ({
              timestamp: point.timeStamp,
              value: point.average,
            }));

          if (cpuData.length > 0) {
            lastCpuValue = cpuData[cpuData.length - 1].value;

            // Adjust unit based on metric name
            if (cpuMetricName && cpuMetricName.includes('millicores')) {
              cpuUnit = 'millicores';
            }
          }
        }
      } catch (error) {
        console.error('Error parsing CPU metrics:', error);
      }
    }

    // Memory metrics - try multiple valid metrics
    const memoryMetricNames = [
      'node_memory_working_set_percentage', // Try without quotes first
      'node_memory_rss_percentage', // Alternative metric
      'node_memory_working_set_bytes', // Another alternative
    ];

    const { metricJson: memoryMetricsJson, successMetric: memoryMetricName } =
      await tryMultipleMetrics(resourceId, memoryMetricNames, 'memory');

    let memoryData: MetricDataPoint[] = [];
    let lastMemoryValue = 0;
    let memoryUnit = '%';

    if (memoryMetricsJson) {
      try {
        const memoryMetrics = JSON.parse(memoryMetricsJson);
        if (
          memoryMetrics.value &&
          memoryMetrics.value.length > 0 &&
          memoryMetrics.value[0].timeseries &&
          memoryMetrics.value[0].timeseries.length > 0
        ) {
          const timeseries = memoryMetrics.value[0].timeseries[0];
          memoryData = timeseries.data
            .filter((point: any) => point.average !== null)
            .map((point: any) => ({
              timestamp: point.timeStamp,
              value: point.average,
            }));

          if (memoryData.length > 0) {
            lastMemoryValue = memoryData[memoryData.length - 1].value;

            // Adjust unit based on metric name
            if (memoryMetricName && memoryMetricName.includes('bytes')) {
              memoryUnit = 'bytes';
            }
          }
        }
      } catch (error) {
        console.error('Error parsing memory metrics:', error);
      }
    }

    // Calculate metrics changes
    const cpuChange = calculatePercentChange(cpuData);
    const memoryChange = calculatePercentChange(memoryData);

    // If we don't have any data from the API, return an object with empty data
    if (cpuData.length === 0 && memoryData.length === 0) {
      console.log('No metrics data received from Azure Monitor API');
      return {
        noMetricsAvailable: true,
        message: `No metrics data available from Azure Monitor API. Please check that the metrics ${cpuMetricNames.join(
          ', '
        )} or ${memoryMetricNames.join(', ')} are available for this cluster.`,
        cpu: {
          value: 0,
          unit: '%',
          change: 0,
          changeDirection: 'up',
          health: 'good',
          data: [],
        },
        memory: {
          value: 0,
          unit: '%',
          change: 0,
          changeDirection: 'up',
          health: 'good',
          data: [],
        },
        latency: {
          value: 0,
          unit: 'ms',
          change: 0,
          changeDirection: 'up',
          health: 'good',
          data: [],
        },
        requestRate: {
          value: 0,
          unit: 'req/s',
          change: 0,
          changeDirection: 'up',
          health: 'good',
          data: [],
        },
        errorRate: {
          value: 0,
          unit: '%',
          change: 0,
          changeDirection: 'up',
          health: 'good',
          data: [],
        },
      };
    }

    // Create empty arrays for metrics we don't have from Azure Monitor yet
    const latencyData: MetricDataPoint[] = [];
    const requestRateData: MetricDataPoint[] = [];
    const errorRateData: MetricDataPoint[] = [];

    // Return metrics with real data for CPU and memory
    return {
      cpu: {
        value: lastCpuValue,
        unit: cpuUnit,
        change: cpuChange,
        changeDirection: cpuChange >= 0 ? 'up' : 'down',
        health: determineHealth('cpu', cpuUnit === 'millicores' ? lastCpuValue / 10 : lastCpuValue),
        data: cpuData,
      },
      memory: {
        value: lastMemoryValue,
        unit: memoryUnit,
        change: memoryChange,
        changeDirection: memoryChange >= 0 ? 'up' : 'down',
        health: determineHealth(
          'memory',
          memoryUnit === '%' ? lastMemoryValue : (lastMemoryValue / 1024 / 1024 / 1024) * 100
        ),
        data: memoryData,
      },
      latency: {
        value: 0,
        unit: 'ms',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: latencyData,
      },
      requestRate: {
        value: 0,
        unit: 'req/s',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: requestRateData,
      },
      errorRate: {
        value: 0,
        unit: '%',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: errorRateData,
      },
    };
  } catch (error) {
    console.error('Error fetching metrics from Azure Monitor:', error);
    return null;
  }
}

// Function to generate mock metrics data points with realistic patterns
export function generateMockMetrics(baseValue: number): MetricDataPoint[] {
  const now = new Date();
  const dataPoints: MetricDataPoint[] = [];

  for (let i = 0; i < 24; i++) {
    const timestamp = subHours(now, 24 - i).toISOString();
    const hourOfDay = new Date(timestamp).getHours();

    // Create a realistic daily pattern
    let multiplier = 1.0;
    if (hourOfDay >= 9 && hourOfDay <= 17) {
      // Business hours
      multiplier = 1.3;
    } else if (hourOfDay >= 0 && hourOfDay <= 5) {
      // Night
      multiplier = 0.7;
    }

    const variance = (Math.random() - 0.5) * 15;
    const value = Math.max(0, baseValue * multiplier + variance);

    dataPoints.push({
      timestamp,
      value,
    });
  }

  return dataPoints;
}

// Get combined metrics with real data when possible, fallback to mock
export async function getClusterMetrics(
  clusterId: string,
  timeRange: string,
  namespace: string // Currently not used in metrics retrieval, but kept for future filtering
): Promise<ClusterMetrics> {
  // For future enhancement: Use namespace parameter to filter metrics by Kubernetes namespace
  // Currently using cluster-wide metrics only
  console.log(`Namespace parameter (for future filtering): ${namespace}`);
  try {
    // Parse the time range
    const hours =
      timeRange === '24h'
        ? 24
        : timeRange === '6h'
        ? 6
        : timeRange === '1h'
        ? 1
        : timeRange === '15m'
        ? 0.25
        : timeRange === '5m'
        ? 0.0833
        : 1; // default to 1 hour

    const endTime = new Date();
    const startTime = subHours(endTime, hours);

    // Extract subscription, resource group, and cluster name from ID
    console.log('Parsing cluster ID:', clusterId);
    const idParts = clusterId.split('/');
    let subscriptionId = '';
    let resourceGroup = '';
    let clusterName = '';

    for (let i = 0; i < idParts.length; i++) {
      if (idParts[i] === 'subscriptions' && i + 1 < idParts.length) {
        subscriptionId = idParts[i + 1];
      }
      if (idParts[i] === 'resourceGroups' && i + 1 < idParts.length) {
        resourceGroup = idParts[i + 1];
      }
      if (idParts[i] === 'managedClusters' && i + 1 < idParts.length) {
        clusterName = idParts[i + 1];
      }
    }

    console.log('Parsed cluster details:', { subscriptionId, resourceGroup, clusterName });

    // If we couldn't parse all parts, check if we're dealing with a simple cluster name
    if (!subscriptionId || !resourceGroup) {
      console.log('Unable to parse full resource ID, checking for simple cluster name');

      // If clusterId doesn't contain '/', assume it's just the cluster name
      if (!clusterId.includes('/')) {
        console.log('Using default resource ID components with cluster name:', clusterId);
        // Note: Replace with actual user's subscription ID from Azure CLI or environment
        console.warn(
          'No subscription ID provided - metrics may not work without proper resource ID'
        );
        // Continue without setting subscription to trigger fallback to mock data
      }
    }
    // Try to get metrics from Azure Monitor if we have a proper ID
    if (subscriptionId && resourceGroup && clusterName) {
      console.log('Using resource components:', { subscriptionId, resourceGroup, clusterName });
      try {
        console.log(
          `Fetching metrics for cluster ${clusterName} in resource group ${resourceGroup}...`
        );
        console.log(`Time range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

        // Implement retry with exponential backoff for transient failures
        const maxRetries = 3;
        let retryCount = 0;
        let lastError = null;

        while (retryCount < maxRetries) {
          try {
            // Fetch metrics from Azure Monitor
            const azureMetrics = await getClusterMetricsFromAzure(
              subscriptionId,
              resourceGroup,
              clusterName,
              startTime,
              endTime
            );

            console.log('Azure Monitor metrics fetched:', azureMetrics);
            if (azureMetrics) {
              return azureMetrics;
            }
            break; // Exit retry loop if successful but no metrics
          } catch (error) {
            lastError = error;
            retryCount++;
            if (retryCount < maxRetries) {
              // Exponential backoff with jitter
              const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, 10000);
              console.log(`Retry ${retryCount}/${maxRetries} after ${delay}ms`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        // After all retries failed
        if (lastError) {
          console.warn('All retries to fetch Azure Monitor metrics failed:', lastError);

          // Extract valid metrics from error message if available
          if (lastError instanceof Error && lastError.message) {
            const validMetrics = extractValidMetricsFromError(lastError.message);
            if (validMetrics.length > 0) {
              const validMetricsStr = validMetrics.join(', ');
              return {
                cpu: {
                  value: 0,
                  unit: '%',
                  change: 0,
                  changeDirection: 'up',
                  health: 'good',
                  data: [],
                },
                memory: {
                  value: 0,
                  unit: '%',
                  change: 0,
                  changeDirection: 'up',
                  health: 'good',
                  data: [],
                },
                latency: {
                  value: 0,
                  unit: 'ms',
                  change: 0,
                  changeDirection: 'up',
                  health: 'good',
                  data: [],
                },
                requestRate: {
                  value: 0,
                  unit: 'req/s',
                  change: 0,
                  changeDirection: 'up',
                  health: 'good',
                  data: [],
                },
                errorRate: {
                  value: 0,
                  unit: '%',
                  change: 0,
                  changeDirection: 'up',
                  health: 'good',
                  data: [],
                },
                noMetricsAvailable: true,
                message: `Could not retrieve metrics. Available metrics for this cluster are: ${validMetricsStr}`,
              };
            }
          }
        }
      } catch (error) {
        console.warn('Azure Monitor metrics not available:', error);
      }
    }
    console.log('No metrics available due to missing or invalid cluster ID:', clusterId);
    // If Azure Monitor failed or not available, return with noMetricsAvailable flag
    return {
      cpu: {
        value: 0,
        unit: '%',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      memory: {
        value: 0,
        unit: '%',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      latency: {
        value: 0,
        unit: 'ms',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      requestRate: {
        value: 0,
        unit: 'req/s',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      errorRate: {
        value: 0,
        unit: '%',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      noMetricsAvailable: true,
      message:
        'No metrics are available for this cluster. This could be due to invalid cluster ID or metrics collection not being properly configured.',
    };
  } catch (error) {
    console.error('Error getting cluster metrics:', error);
    // Instead of using mock data, return with noMetricsAvailable flag and error message
    return {
      cpu: {
        value: 0,
        unit: '%',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      memory: {
        value: 0,
        unit: '%',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      latency: {
        value: 0,
        unit: 'ms',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      requestRate: {
        value: 0,
        unit: 'req/s',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      errorRate: {
        value: 0,
        unit: '%',
        change: 0,
        changeDirection: 'up',
        health: 'good',
        data: [],
      },
      noMetricsAvailable: true,
      message: `Error fetching metrics: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
