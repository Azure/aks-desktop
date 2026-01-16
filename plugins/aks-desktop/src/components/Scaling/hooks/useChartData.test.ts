// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useChartData } from './useChartData';
import type { DeploymentInfo } from './useDeployments';
import type { HPAInfo } from './useHPAInfo';

describe('useChartData', () => {
  const mockDeployments: DeploymentInfo[] = [
    {
      name: 'app-1',
      namespace: 'default',
      replicas: 3,
      availableReplicas: 3,
      readyReplicas: 3,
    },
    {
      name: 'app-2',
      namespace: 'default',
      replicas: 2,
      availableReplicas: 2,
      readyReplicas: 2,
    },
  ];

  const mockHPAInfo: HPAInfo = {
    name: 'app-1-hpa',
    namespace: 'default',
    minReplicas: 2,
    maxReplicas: 10,
    targetCPUUtilization: 50,
    currentCPUUtilization: 65,
    currentReplicas: 4,
    desiredReplicas: 5,
  };

  test('returns 12 data points over last 23 hours with correct structure', () => {
    const { result } = renderHook(() => useChartData('app-1', mockDeployments, null));

    expect(result.current).toHaveLength(12);
    result.current.forEach(point => {
      expect(point).toHaveProperty('time');
      expect(point).toHaveProperty('Replicas');
      expect(point).toHaveProperty('CPU');
      expect(point.time).toMatch(/^\d{2}:00$/);
    });
  });

  test('uses deployment readyReplicas when no HPA', () => {
    const { result } = renderHook(() => useChartData('app-1', mockDeployments, null));

    // All points should have replicas from deployment and CPU = 0
    result.current.forEach(point => {
      expect(point.Replicas).toBe(3);
      expect(point.CPU).toBe(0);
    });
  });

  test('uses HPA data when available', () => {
    const { result } = renderHook(() => useChartData('app-1', mockDeployments, mockHPAInfo));

    // All points should have non-zero CPU and respect HPA bounds
    result.current.forEach(point => {
      expect(point.CPU).toBeGreaterThan(0);
      expect(point.CPU).toBeLessThanOrEqual(100);
      expect(point.Replicas).toBeGreaterThanOrEqual(mockHPAInfo.minReplicas);
      expect(point.Replicas).toBeLessThanOrEqual(mockHPAInfo.maxReplicas);
    });
  });

  test('handles missing deployment gracefully', () => {
    const { result } = renderHook(() => useChartData('non-existent', mockDeployments, null));

    expect(result.current).toHaveLength(12);
    result.current.forEach(point => {
      expect(point.Replicas).toBe(0);
      expect(point.CPU).toBe(0);
    });
  });

  test('handles empty inputs', () => {
    const { result } = renderHook(() => useChartData('', [], null));

    expect(result.current).toHaveLength(12);
    result.current.forEach(point => {
      expect(point.Replicas).toBe(0);
      expect(point.CPU).toBe(0);
    });
  });
});
