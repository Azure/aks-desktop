// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const mockUseClustersConf = vi.fn();

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useClustersConf: () => mockUseClustersConf(),
  },
}));

import { useRegisteredClusters } from './useRegisteredClusters';

describe('useRegisteredClusters', () => {
  afterEach(() => {
    cleanup();
    mockUseClustersConf.mockReset();
  });

  test('returns empty Set when clustersConf is null', () => {
    mockUseClustersConf.mockReturnValue(null);

    const { result } = renderHook(() => useRegisteredClusters());

    expect(result.current).toBeInstanceOf(Set);
    expect(result.current.size).toBe(0);
  });

  test('returns empty Set when clustersConf is empty object', () => {
    mockUseClustersConf.mockReturnValue({});

    const { result } = renderHook(() => useRegisteredClusters());

    expect(result.current).toBeInstanceOf(Set);
    expect(result.current.size).toBe(0);
  });

  test('returns Set of cluster names from clustersConf keys', () => {
    mockUseClustersConf.mockReturnValue({
      'cluster-a': { server: 'https://a' },
      'cluster-b': { server: 'https://b' },
    });

    const { result } = renderHook(() => useRegisteredClusters());

    expect(result.current.size).toBe(2);
    expect(result.current.has('cluster-a')).toBe(true);
    expect(result.current.has('cluster-b')).toBe(true);
    expect(result.current.has('cluster-c')).toBe(false);
  });

  test('updates when clustersConf changes', () => {
    mockUseClustersConf.mockReturnValue({ 'cluster-a': {} });

    const { result, rerender } = renderHook(() => useRegisteredClusters());

    expect(result.current.size).toBe(1);
    expect(result.current.has('cluster-a')).toBe(true);

    mockUseClustersConf.mockReturnValue({ 'cluster-a': {}, 'cluster-b': {} });
    rerender();

    expect(result.current.size).toBe(2);
    expect(result.current.has('cluster-b')).toBe(true);
  });
});
