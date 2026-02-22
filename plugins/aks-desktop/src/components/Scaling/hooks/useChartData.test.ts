// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearChartDataCaches, useChartData } from './useChartData';

// Mock the external dependencies
vi.mock('../../../utils/azure/az-cli', () => ({
  getClusterResourceIdAndGroup: vi.fn(),
}));

vi.mock('../../MetricsTab/getPrometheusEndpoint', () => ({
  getPrometheusEndpoint: vi.fn(),
}));

vi.mock('../../MetricsTab/queryPrometheus', () => ({
  queryPrometheus: vi.fn(),
}));

import { getClusterResourceIdAndGroup } from '../../../utils/azure/az-cli';
import { getPrometheusEndpoint } from '../../MetricsTab/getPrometheusEndpoint';
import { queryPrometheus } from '../../MetricsTab/queryPrometheus';

const mockGetClusterResourceIdAndGroup = vi.mocked(getClusterResourceIdAndGroup);
const mockGetPrometheusEndpoint = vi.mocked(getPrometheusEndpoint);
const mockQueryPrometheus = vi.mocked(queryPrometheus);

describe('useChartData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChartDataCaches();
    mockGetClusterResourceIdAndGroup.mockResolvedValue({
      resourceId:
        '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster',
      resourceGroup: 'test-rg',
    });
    mockGetPrometheusEndpoint.mockResolvedValue('https://prometheus.test.azure.com');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test('returns empty data and no loading when deployment is not selected', async () => {
    const { result } = renderHook(() =>
      useChartData('', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    expect(result.current.chartData).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('returns empty data when namespace is missing', async () => {
    const { result } = renderHook(() =>
      useChartData('test-deployment', '', 'test-cluster', 'test-sub', 'test-rg')
    );

    expect(result.current.chartData).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  test('returns empty data when subscription is missing', async () => {
    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', undefined, 'test-rg')
    );

    expect(result.current.chartData).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  test('fetches and merges Prometheus data correctly', async () => {
    const now = Math.floor(Date.now() / 1000);
    const mockReplicaResults = [
      {
        values: [
          [now - 120, '3'],
          [now - 60, '3'],
          [now, '4'],
        ],
      },
    ];
    const mockCpuResults = [
      {
        values: [
          [now - 120, '45.5'],
          [now - 60, '52.3'],
          [now, '67.8'],
        ],
      },
    ];

    mockQueryPrometheus
      .mockResolvedValueOnce(mockReplicaResults)
      .mockResolvedValueOnce(mockCpuResults);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chartData).toHaveLength(3);
    expect(result.current.error).toBeNull();

    // Verify data structure
    result.current.chartData.forEach(point => {
      expect(point).toHaveProperty('time');
      expect(point).toHaveProperty('Replicas');
      expect(point).toHaveProperty('CPU');
      expect(typeof point.Replicas).toBe('number');
      expect(typeof point.CPU).toBe('number');
    });

    // Verify the last point has correct values
    const lastPoint = result.current.chartData[2];
    expect(lastPoint.Replicas).toBe(4);
    expect(lastPoint.CPU).toBe(68); // Rounded from 67.8
  });

  test('handles Prometheus query error gracefully', async () => {
    mockGetPrometheusEndpoint.mockRejectedValue(new Error('Failed to get Prometheus endpoint'));

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chartData).toHaveLength(0);
    expect(result.current.error).toBe('Failed to get Prometheus endpoint');
  });

  test('handles missing resource group by fetching it', async () => {
    mockQueryPrometheus.mockResolvedValue([{ values: [] }]);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', undefined)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetClusterResourceIdAndGroup).toHaveBeenCalledWith('test-cluster', 'test-sub');
    expect(mockGetPrometheusEndpoint).toHaveBeenCalledWith('test-rg', 'test-cluster', 'test-sub');
  });

  test('handles empty Prometheus results', async () => {
    mockQueryPrometheus.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chartData).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  test('refetches data when deployment changes', async () => {
    mockQueryPrometheus.mockResolvedValue([{ values: [] }]);

    const { result, rerender } = renderHook(
      ({ deployment }) =>
        useChartData(deployment, 'test-namespace', 'test-cluster', 'test-sub', 'test-rg'),
      { initialProps: { deployment: 'deployment-1' } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockQueryPrometheus).toHaveBeenCalledTimes(2); // replica + cpu queries

    // Change deployment
    rerender({ deployment: 'deployment-2' });

    await waitFor(() => {
      expect(mockQueryPrometheus).toHaveBeenCalledTimes(4); // 2 more queries
    });
  });

  test('returns empty data when cluster is missing', async () => {
    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', '', 'test-sub', 'test-rg')
    );

    expect(result.current.chartData).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  test('handles non-Error thrown exceptions', async () => {
    mockGetPrometheusEndpoint.mockRejectedValue('string error');

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chartData).toHaveLength(0);
    expect(result.current.error).toBe('Failed to fetch scaling data');
  });

  test('handles null result from getClusterResourceIdAndGroup', async () => {
    mockGetClusterResourceIdAndGroup.mockResolvedValue(null as any);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', undefined)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Could not find resource group for cluster');
  });

  test('handles CPU data without matching replica timestamps', async () => {
    const now = Math.floor(Date.now() / 1000);
    const mockReplicaResults = [
      {
        values: [
          [now - 60, '3'],
          [now, '4'],
        ],
      },
    ];
    // CPU data has different timestamps
    const mockCpuResults = [
      {
        values: [
          [now - 120, '50'],
          [now - 30, '60'],
        ],
      },
    ];

    mockQueryPrometheus
      .mockResolvedValueOnce(mockReplicaResults)
      .mockResolvedValueOnce(mockCpuResults);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have 2 data points (from replica data)
    expect(result.current.chartData).toHaveLength(2);
    // CPU should be 0 for non-matching timestamps
    expect(result.current.chartData[0].CPU).toBe(0);
    expect(result.current.chartData[1].CPU).toBe(0);
  });

  test('sanitizes non-finite Prometheus values to 0', async () => {
    const now = Math.floor(Date.now() / 1000);
    const mockReplicaResults = [
      {
        values: [[now, 'NaN']],
      },
    ];
    const mockCpuResults = [
      {
        values: [[now, '+Inf']],
      },
    ];

    mockQueryPrometheus
      .mockResolvedValueOnce(mockReplicaResults)
      .mockResolvedValueOnce(mockCpuResults);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartData[0].Replicas).toBe(0);
    expect(result.current.chartData[0].CPU).toBe(0);
  });

  test('uses resourceGroupLabel when provided', async () => {
    mockQueryPrometheus.mockResolvedValue([{ values: [] }]);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'provided-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should NOT call getClusterResourceIdAndGroup when resourceGroupLabel is provided
    expect(mockGetClusterResourceIdAndGroup).not.toHaveBeenCalled();
    // Should use the provided resource group
    expect(mockGetPrometheusEndpoint).toHaveBeenCalledWith(
      'provided-rg',
      'test-cluster',
      'test-sub'
    );
  });

  test('passes correct query parameters to queryPrometheus', async () => {
    mockQueryPrometheus.mockResolvedValue([{ values: [] }]);

    renderHook(() => useChartData('my-app', 'my-namespace', 'my-cluster', 'my-sub', 'my-rg'));

    await waitFor(() => {
      expect(mockQueryPrometheus).toHaveBeenCalled();
    });

    // Check replica query
    expect(mockQueryPrometheus).toHaveBeenCalledWith(
      'https://prometheus.test.azure.com',
      expect.stringContaining(
        'kube_deployment_spec_replicas{deployment="my-app",namespace="my-namespace"}'
      ),
      expect.any(Number),
      expect.any(Number),
      7200,
      'my-sub'
    );

    // Check CPU query
    expect(mockQueryPrometheus).toHaveBeenCalledWith(
      'https://prometheus.test.azure.com',
      expect.stringContaining('my-namespace'),
      expect.any(Number),
      expect.any(Number),
      7200,
      'my-sub'
    );
  });

  test('returns cached data without re-fetching within TTL', async () => {
    const now = Math.floor(Date.now() / 1000);
    const mockResults = [{ values: [[now, '2']] }];
    mockQueryPrometheus
      .mockResolvedValueOnce(mockResults) // replica
      .mockResolvedValueOnce([{ values: [[now, '30']] }]); // cpu

    const { result, unmount } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chartData).toHaveLength(1);
    expect(mockQueryPrometheus).toHaveBeenCalledTimes(2);

    // Unmount and re-mount — should use cached data, no new queries
    unmount();

    const { result: result2 } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result2.current.chartData).toHaveLength(1);
    });

    // Still only 2 calls — cache was used
    expect(mockQueryPrometheus).toHaveBeenCalledTimes(2);
  });

  test('does not reuse cached chart data across different resource groups', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockQueryPrometheus
      .mockResolvedValueOnce([{ values: [[now, '2']] }]) // rg-a replica
      .mockResolvedValueOnce([{ values: [[now, '30']] }]) // rg-a cpu
      .mockResolvedValueOnce([{ values: [[now, '5']] }]) // rg-b replica
      .mockResolvedValueOnce([{ values: [[now, '60']] }]); // rg-b cpu

    const { result, unmount } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'rg-a')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartData[0].Replicas).toBe(2);
    expect(result.current.chartData[0].CPU).toBe(30);
    expect(mockQueryPrometheus).toHaveBeenCalledTimes(2);

    unmount();

    const { result: result2 } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'rg-b')
    );

    await waitFor(() => {
      expect(result2.current.loading).toBe(false);
    });

    expect(result2.current.chartData).toHaveLength(1);
    expect(result2.current.chartData[0].Replicas).toBe(5);
    expect(result2.current.chartData[0].CPU).toBe(60);
    expect(mockQueryPrometheus).toHaveBeenCalledTimes(4);
  });

  test('caches Prometheus endpoint and reuses it across deployments', async () => {
    mockQueryPrometheus.mockResolvedValue([{ values: [] }]);

    const { result, rerender } = renderHook(
      ({ deployment }) =>
        useChartData(deployment, 'test-namespace', 'test-cluster', 'test-sub', 'test-rg'),
      { initialProps: { deployment: 'deploy-a' } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetPrometheusEndpoint).toHaveBeenCalledTimes(1);

    // Switch deployment — same cluster, endpoint should be cached
    rerender({ deployment: 'deploy-b' });

    await waitFor(() => {
      expect(mockQueryPrometheus).toHaveBeenCalledTimes(4); // 2 per deployment
    });

    // Endpoint was only fetched once
    expect(mockGetPrometheusEndpoint).toHaveBeenCalledTimes(1);
  });

  test('includes day name in time labels', async () => {
    const now = Math.floor(Date.now() / 1000);
    const mockResults = [{ values: [[now, '3']] }];
    mockQueryPrometheus
      .mockResolvedValueOnce(mockResults)
      .mockResolvedValueOnce([{ values: [[now, '50']] }]);

    const { result } = renderHook(() =>
      useChartData('test-deployment', 'test-namespace', 'test-cluster', 'test-sub', 'test-rg')
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Time label should include a date/day part, a comma, and a time segment (e.g., "Wed, 14:00" or "Mi., 02:00 PM")
    const timeLabel = result.current.chartData[0].time;
    expect(timeLabel).toContain(', ');
    expect(timeLabel).toMatch(/\d{2}:\d{2}/);
  });

  test('ignores stale in-flight responses after deployment changes', async () => {
    const now = Math.floor(Date.now() / 1000);
    let resolveOldReplica: ((value: any[]) => void) | undefined;
    let resolveOldCpu: ((value: any[]) => void) | undefined;

    const oldReplicaPromise = new Promise<any[]>(resolve => {
      resolveOldReplica = resolve;
    });
    const oldCpuPromise = new Promise<any[]>(resolve => {
      resolveOldCpu = resolve;
    });

    mockQueryPrometheus.mockImplementation((_endpoint, query) => {
      if (query.includes('deployment="deployment-1"')) {
        return oldReplicaPromise;
      }
      if (query.includes('pod=~"deployment-1-.*"')) {
        return oldCpuPromise;
      }
      if (query.includes('deployment="deployment-2"')) {
        return Promise.resolve([{ values: [[now, '7']] }]);
      }
      if (query.includes('pod=~"deployment-2-.*"')) {
        return Promise.resolve([{ values: [[now, '80']] }]);
      }
      return Promise.resolve([{ values: [] }]);
    });

    const { result, rerender } = renderHook(
      ({ deployment }) =>
        useChartData(deployment, 'test-namespace', 'test-cluster', 'test-sub', 'test-rg'),
      { initialProps: { deployment: 'deployment-1' } }
    );

    rerender({ deployment: 'deployment-2' });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.chartData).toHaveLength(1);
      expect(result.current.chartData[0].Replicas).toBe(7);
      expect(result.current.chartData[0].CPU).toBe(80);
    });

    await act(async () => {
      resolveOldReplica?.([{ values: [[now, '1']] }]);
      resolveOldCpu?.([{ values: [[now, '10']] }]);
    });

    await waitFor(() => {
      expect(result.current.chartData).toHaveLength(1);
      expect(result.current.chartData[0].Replicas).toBe(7);
      expect(result.current.chartData[0].CPU).toBe(80);
    });
  });
});
