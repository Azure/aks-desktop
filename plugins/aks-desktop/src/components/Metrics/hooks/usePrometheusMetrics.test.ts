// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../utils/azure/az-clusters', () => ({
  getClusterResourceIdAndGroup: vi.fn(),
}));

vi.mock('../../../utils/prometheus/getPrometheusEndpoint', () => ({
  getPrometheusEndpoint: vi.fn(),
}));

vi.mock('../../../utils/prometheus/queryPrometheus', () => ({
  queryPrometheus: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

import { getClusterResourceIdAndGroup } from '../../../utils/azure/az-clusters';
import { getPrometheusEndpoint } from '../../../utils/prometheus/getPrometheusEndpoint';
import { queryPrometheus } from '../../../utils/prometheus/queryPrometheus';
import type { PodInfo } from './usePods';
import { clearMetricsTabCaches, usePrometheusMetrics } from './usePrometheusMetrics';

const mockGetClusterResourceIdAndGroup = vi.mocked(getClusterResourceIdAndGroup);
const mockGetPrometheusEndpoint = vi.mocked(getPrometheusEndpoint);
const mockQueryPrometheus = vi.mocked(queryPrometheus);

const NOW = Math.floor(Date.now() / 1000);

const DEFAULT_ARGS = {
  namespace: 'test-namespace',
  cluster: 'test-cluster',
  selectedDeployment: 'my-app',
  subscription: 'sub-123',
  resourceGroupLabel: 'rg-123',
};

/**
 * Mocks the 9 queryPrometheus calls in order.
 * Any query that isn't specified defaults to an empty array.
 */
function mockQueryResults(overrides: Partial<Record<string, any[]>> = {}) {
  const queries = [
    'cpu',
    'cpuByPod',
    'memory',
    'memoryByPod',
    'request',
    'error',
    'responseTime',
    'networkIn',
    'networkOut',
  ];
  for (const query of queries) {
    mockQueryPrometheus.mockResolvedValueOnce(overrides[query] ?? []);
  }
}

/** Render the hook with DEFAULT_ARGS and allow overrides. */
function renderMetricsHook(
  setPods: React.Dispatch<React.SetStateAction<PodInfo[]>>,
  overrides: Partial<typeof DEFAULT_ARGS> = {}
) {
  const args = { ...DEFAULT_ARGS, ...overrides };
  return renderHook(() =>
    usePrometheusMetrics(
      args.namespace,
      args.cluster,
      args.selectedDeployment,
      args.subscription,
      args.resourceGroupLabel,
      setPods
    )
  );
}

describe('usePrometheusMetrics', () => {
  let mockSetPods: React.Dispatch<React.SetStateAction<PodInfo[]>>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMetricsTabCaches();
    mockSetPods = vi.fn();
    mockGetClusterResourceIdAndGroup.mockResolvedValue({
      resourceId:
        '/subscriptions/sub-123/resourceGroups/rg-123/providers/Microsoft.ContainerService/managedClusters/test-cluster',
      resourceGroup: 'rg-123',
    });
    mockGetPrometheusEndpoint.mockResolvedValue('https://prometheus.test.azure.com');
    mockQueryPrometheus.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test('returns default state when namespace is missing', () => {
    const { result } = renderMetricsHook(mockSetPods, { namespace: undefined });

    expect(result.current.cpuData).toHaveLength(0);
    expect(result.current.memoryData).toHaveLength(0);
    expect(result.current.metricsLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockQueryPrometheus).not.toHaveBeenCalled();
  });

  test('returns default state when subscription is missing', () => {
    const { result } = renderMetricsHook(mockSetPods, { subscription: undefined });

    expect(result.current.cpuData).toHaveLength(0);
    expect(result.current.metricsLoading).toBe(false);
    expect(mockQueryPrometheus).not.toHaveBeenCalled();
  });

  test('fetches metrics and processes CPU data correctly', async () => {
    const cpuValues: [number, string][] = [
      [NOW - 120, '0.25'],
      [NOW - 60, '0.30'],
      [NOW, '0.35'],
    ];

    mockQueryResults({ cpu: [{ values: cpuValues }] });

    const { result } = renderMetricsHook(mockSetPods);

    await waitFor(() => {
      expect(result.current.metricsLoading).toBe(false);
    });

    expect(result.current.cpuData).toHaveLength(3);
    expect(result.current.cpuData[2].value).toBe(0.35);
    expect(result.current.summary.cpuUsage).toBe('0.350 cores');
  });

  test('fetches and processes memory data in MB', async () => {
    const memBytes = 500 * 1024 * 1024;
    const memValues: [number, string][] = [
      [NOW - 60, String(memBytes)],
      [NOW, String(memBytes * 1.1)],
    ];

    mockQueryResults({ memory: [{ values: memValues }] });

    const { result } = renderMetricsHook(mockSetPods);

    await waitFor(() => {
      expect(result.current.metricsLoading).toBe(false);
    });

    expect(result.current.memoryUnit).toBe('MB');
    expect(result.current.memoryData).toHaveLength(2);
    expect(result.current.summary.memoryUsage).toContain('MB');
  });

  test('selects GB unit when memory values exceed 1 GB', async () => {
    const memBytes = 1.5 * 1024 * 1024 * 1024;
    const memValues: [number, string][] = [[NOW, String(memBytes)]];

    mockQueryResults({ memory: [{ values: memValues }] });

    const { result } = renderMetricsHook(mockSetPods);

    await waitFor(() => {
      expect(result.current.metricsLoading).toBe(false);
    });

    expect(result.current.memoryUnit).toBe('GB');
    expect(result.current.memoryData).toHaveLength(1);
    expect(result.current.summary.memoryUsage).toContain('GB');
  });

  test('processes request and error rate data', async () => {
    const requestValues: [number, string][] = [
      [NOW - 60, '10.5'],
      [NOW, '12.3'],
    ];
    const errorValues: [number, string][] = [
      [NOW - 60, '1.2'],
      [NOW, '0.8'],
    ];

    mockQueryResults({
      request: [{ values: requestValues }],
      error: [{ values: errorValues }],
    });

    const { result } = renderMetricsHook(mockSetPods);

    await waitFor(() => {
      expect(result.current.metricsLoading).toBe(false);
    });

    expect(result.current.requestErrorData).toHaveLength(2);
    expect(result.current.summary.requestRate).toBe('12.3/sec');
    expect(result.current.summary.errorRate).toBe('0.8%');
  });

  test('updates per-pod CPU and memory via setPods', async () => {
    mockQueryResults({
      cpuByPod: [
        { metric: { pod: 'pod-1' }, values: [[NOW, '0.125']] as [number, string][] },
        { metric: { pod: 'pod-2' }, values: [[NOW, '0.250']] as [number, string][] },
      ],
      memoryByPod: [
        {
          metric: { pod: 'pod-1' },
          values: [[NOW, String(256 * 1024 * 1024)]] as [number, string][],
        },
      ],
    });

    renderMetricsHook(mockSetPods);

    await waitFor(() => {
      expect(mockSetPods).toHaveBeenCalled();
    });
  });

  test('handles prometheus query error gracefully', async () => {
    mockGetPrometheusEndpoint.mockRejectedValue(new Error('Endpoint not found'));

    const { result } = renderMetricsHook(mockSetPods);

    await waitFor(() => {
      expect(result.current.metricsLoading).toBe(false);
    });

    expect(result.current.error).toBe('Endpoint not found');
    expect(result.current.cpuData).toHaveLength(0);
  });

  test('handles non-error thrown exceptions gracefully', async () => {
    mockGetPrometheusEndpoint.mockRejectedValue('something went wrong');

    const { result } = renderMetricsHook(mockSetPods);

    await waitFor(() => {
      expect(result.current.metricsLoading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to fetch metrics from Prometheus');
  });

  test('falls back to fetching resource group when label is missing', async () => {
    mockQueryResults();

    renderMetricsHook(mockSetPods, { resourceGroupLabel: undefined });

    await waitFor(() => {
      expect(mockGetClusterResourceIdAndGroup).toHaveBeenCalledWith('test-cluster', 'sub-123');
    });

    expect(mockGetPrometheusEndpoint).toHaveBeenCalledWith('rg-123', 'test-cluster', 'sub-123');
  });

  test('uses resourceGroupLabel directly when provided', async () => {
    mockQueryResults();

    renderMetricsHook(mockSetPods, { resourceGroupLabel: 'provided-rg' });

    await waitFor(() => {
      expect(mockGetPrometheusEndpoint).toHaveBeenCalled();
    });

    expect(mockGetClusterResourceIdAndGroup).not.toHaveBeenCalled();
    expect(mockGetPrometheusEndpoint).toHaveBeenCalledWith(
      'provided-rg',
      'test-cluster',
      'sub-123'
    );
  });
});
