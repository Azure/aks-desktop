// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { mockReconcileRegisteredClusterNames, mockUseClustersConf } = vi.hoisted(() => ({
  mockReconcileRegisteredClusterNames: vi.fn(),
  mockUseClustersConf: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useClustersConf: () => mockUseClustersConf(),
  },
}));

vi.mock('../utils/azure/aks', () => ({
  reconcileRegisteredClusterNames: mockReconcileRegisteredClusterNames,
}));

import { useRegisteredClusters } from './useRegisteredClusters';

describe('useRegisteredClusters', () => {
  afterEach(() => {
    cleanup();
    mockUseClustersConf.mockReset();
    mockReconcileRegisteredClusterNames.mockReset();
  });

  test('reports unavailable cluster configuration as not ready', () => {
    mockUseClustersConf.mockReturnValue(null);

    const { result } = renderHook(() => useRegisteredClusters());

    expect(result.current.registeredClusters.size).toBe(0);
    expect(result.current.isReady).toBe(false);
  });

  test('reports an empty cluster configuration as ready', () => {
    mockUseClustersConf.mockReturnValue({});

    const { result } = renderHook(() => useRegisteredClusters());

    expect(result.current.registeredClusters.size).toBe(0);
    expect(result.current.isReady).toBe(true);
  });

  test('returns Set of cluster names from clustersConf keys', () => {
    mockUseClustersConf.mockReturnValue({
      'cluster-a': { server: 'https://a' },
      'cluster-b': { server: 'https://b' },
    });

    const { result } = renderHook(() => useRegisteredClusters());

    expect(result.current.registeredClusters.size).toBe(2);
    expect(result.current.registeredClusters.has('cluster-a')).toBe(true);
    expect(result.current.registeredClusters.has('cluster-b')).toBe(true);
    expect(result.current.registeredClusters.has('cluster-c')).toBe(false);
    expect(result.current.isReady).toBe(true);
    expect(mockReconcileRegisteredClusterNames).toHaveBeenCalledWith(
      new Set(['cluster-a', 'cluster-b'])
    );
  });

  test('normalizes kubeconfig cluster names for case-insensitive membership', () => {
    mockUseClustersConf.mockReturnValue({ MyCluster: {} });

    const { result } = renderHook(() => useRegisteredClusters());

    expect(result.current.registeredClusters).toEqual(new Set(['mycluster']));
    expect(mockReconcileRegisteredClusterNames).toHaveBeenCalledWith(new Set(['mycluster']));
  });

  test('updates when clustersConf changes', () => {
    mockUseClustersConf.mockReturnValue({ 'cluster-a': {} });

    const { result, rerender } = renderHook(() => useRegisteredClusters());

    expect(result.current.registeredClusters.size).toBe(1);
    expect(result.current.registeredClusters.has('cluster-a')).toBe(true);

    mockUseClustersConf.mockReturnValue({ 'cluster-a': {}, 'cluster-b': {} });
    rerender();

    expect(result.current.registeredClusters.size).toBe(2);
    expect(result.current.registeredClusters.has('cluster-b')).toBe(true);
    expect(mockReconcileRegisteredClusterNames).toHaveBeenLastCalledWith(
      new Set(['cluster-a', 'cluster-b'])
    );
  });

  test('does not reconcile while cluster configuration is unavailable', () => {
    mockUseClustersConf.mockReturnValue(null);

    renderHook(() => useRegisteredClusters());

    expect(mockReconcileRegisteredClusterNames).not.toHaveBeenCalled();
  });
});
