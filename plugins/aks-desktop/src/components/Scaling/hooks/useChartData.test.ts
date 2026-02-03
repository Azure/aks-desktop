// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useChartData } from './useChartData';

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
    expect(result.current.error).toBe('Failed to fetch chart data');
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
      60,
      'my-sub'
    );

    // Check CPU query
    expect(mockQueryPrometheus).toHaveBeenCalledWith(
      'https://prometheus.test.azure.com',
      expect.stringContaining('my-namespace'),
      expect.any(Number),
      expect.any(Number),
      60,
      'my-sub'
    );
  });
});
