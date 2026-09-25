// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the Headlamp K8s API — vi.hoisted ensures the variable is available when vi.mock is hoisted
const mockApiList = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      HorizontalPodAutoscaler: {
        apiList: mockApiList,
      },
    },
  },
}));

import { useHPAInfo } from './useHPAInfo';

/** Helper to create a mock Headlamp HPA object. */
function createMockHPA(
  name: string,
  namespace: string,
  targetDeployment: string,
  options: {
    minReplicas?: number;
    maxReplicas?: number;
    targetCPU?: number;
    currentCPU?: number;
    currentReplicas?: number;
    desiredReplicas?: number;
  } = {}
) {
  const {
    minReplicas = 2,
    maxReplicas = 10,
    targetCPU = 70,
    currentCPU = 45,
    currentReplicas = 3,
    desiredReplicas = 3,
  } = options;

  return {
    getName: () => name,
    getNamespace: () => namespace,
    spec: {
      scaleTargetRef: { name: targetDeployment, kind: 'Deployment' },
      minReplicas,
      maxReplicas,
    },
    status: {
      currentReplicas,
      desiredReplicas,
    },
    jsonData: {
      spec: {
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              target: { type: 'Utilization', averageUtilization: targetCPU },
            },
          },
        ],
      },
      status: {
        currentMetrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              current: { averageUtilization: currentCPU },
            },
          },
        ],
      },
    },
  };
}

describe('useHPAInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb([]);
      };
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test('returns null and skips fetch when deployment or namespace is undefined', () => {
    const { result: r1 } = renderHook(() =>
      useHPAInfo(undefined, 'test-namespace', 'test-cluster')
    );
    expect(r1.current.hpaInfo).toBeNull();

    const { result: r2 } = renderHook(() =>
      useHPAInfo('test-deployment', undefined, 'test-cluster')
    );
    expect(r2.current.hpaInfo).toBeNull();

    expect(mockApiList).not.toHaveBeenCalled();
  });

  test('finds correct HPA, parses CPU metrics, and passes options', () => {
    const mockHPAs = [
      createMockHPA('hpa-other', 'test-namespace', 'other-deployment'),
      createMockHPA('hpa-target', 'test-namespace', 'my-deployment', {
        minReplicas: 2,
        maxReplicas: 8,
        targetCPU: 75,
        currentCPU: 50,
        currentReplicas: 4,
        desiredReplicas: 4,
      }),
    ];

    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb(mockHPAs);
      };
    });

    const { result } = renderHook(() =>
      useHPAInfo('my-deployment', 'test-namespace', 'test-cluster')
    );

    expect(result.current.hpaInfo).toEqual({
      name: 'hpa-target',
      namespace: 'test-namespace',
      minReplicas: 2,
      maxReplicas: 8,
      targetCPUUtilization: 75,
      currentCPUUtilization: 50,
      currentReplicas: 4,
      desiredReplicas: 4,
    });
    expect(mockApiList).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      namespace: 'test-namespace',
      cluster: 'test-cluster',
    });
  });

  test('returns null when no HPA matches deployment or namespace', () => {
    const mockHPAs = [
      createMockHPA('hpa-wrong-ns', 'other-namespace', 'my-deploy'),
      createMockHPA('hpa-wrong-deploy', 'test-namespace', 'different-deploy'),
    ];

    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb(mockHPAs);
      };
    });

    const { result } = renderHook(() => useHPAInfo('my-deploy', 'test-namespace', 'test-cluster'));

    expect(result.current.hpaInfo).toBeNull();
  });

  test('handles HPA without CPU metrics in spec', () => {
    const hpa = createMockHPA('hpa-no-cpu', 'test-namespace', 'my-deploy');
    hpa.jsonData = {
      spec: {
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'memory',
              target: { type: 'Utilization', averageUtilization: 80 },
            },
          },
        ],
      },
      status: {
        currentMetrics: [],
      },
    };

    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb([hpa]);
      };
    });

    const { result } = renderHook(() => useHPAInfo('my-deploy', 'test-namespace', 'test-cluster'));

    expect(result.current.hpaInfo).not.toBeNull();
    expect(result.current.hpaInfo?.targetCPUUtilization).toBeUndefined();
    expect(result.current.hpaInfo?.currentCPUUtilization).toBeUndefined();
  });

  test('handles error callback gracefully', () => {
    mockApiList.mockImplementation((_successCb: Function, errorCb: Function) => {
      return () => {
        errorCb(new Error('HPA fetch failed'));
      };
    });

    const { result } = renderHook(() =>
      useHPAInfo('test-deployment', 'test-namespace', 'test-cluster')
    );

    expect(result.current.hpaInfo).toBeNull();
  });
});
