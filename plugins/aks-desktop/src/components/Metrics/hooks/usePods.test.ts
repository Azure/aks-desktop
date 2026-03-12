// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockApiGet = vi.hoisted(() => vi.fn());
const mockApiList = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Deployment: {
        apiGet: mockApiGet,
      },
      Pod: {
        apiList: mockApiList,
      },
    },
  },
}));

import { usePods } from './usePods';

/** Helper to create a mock pod object as returned by K8s apiList. */
function createMockPod(name: string, phase: string, restartCount = 0) {
  return {
    metadata: { name },
    status: {
      phase,
      containerStatuses: [{ restartCount }],
    },
  };
}

const MOCK_SELECTOR = { matchLabels: { app: 'my-app' } };

/** Mocks Deployment.apiGet to return a deployment with the given selector. */
function mockDeploymentWithSelector(selector: object | undefined) {
  mockApiGet.mockImplementation((successCb: Function) => {
    return () => {
      successCb({ spec: { selector } });
      return Promise.resolve(() => {});
    };
  });
}

/** Mocks Pod.apiList to return the given pods. */
function mockPodList(pods: object[]) {
  mockApiList.mockImplementation((successCb: Function) => {
    return () => {
      successCb(pods);
      return Promise.resolve(() => {});
    };
  });
}

describe('usePods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test('returns empty state when selectedDeployment is empty', () => {
    const { result } = renderHook(() => usePods('', 'test-namespace', 'test-cluster'));

    expect(result.current.pods).toHaveLength(0);
    expect(result.current.totalPods).toBe(0);
    expect(result.current.projectStatus).toBe('Unknown');
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  test('returns empty state when namespace is undefined', () => {
    const { result } = renderHook(() => usePods('my-deployment', undefined, 'test-cluster'));

    expect(result.current.pods).toHaveLength(0);
    expect(result.current.totalPods).toBe(0);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  test('fetches pods using deployment selector labels', async () => {
    const mockPods = [createMockPod('pod-1', 'Running', 0), createMockPod('pod-2', 'Running', 1)];

    mockDeploymentWithSelector(MOCK_SELECTOR);
    mockPodList(mockPods);

    const { result } = renderHook(() => usePods('my-deployment', 'test-ns', 'test-cluster'));

    await waitFor(() => {
      expect(result.current.pods).toHaveLength(2);
    });

    expect(result.current.pods[0]).toEqual({
      name: 'pod-1',
      status: 'Running',
      cpuUsage: 'N/A',
      memoryUsage: 'N/A',
      restarts: 0,
    });
    expect(result.current.pods[1]).toEqual({
      name: 'pod-2',
      status: 'Running',
      cpuUsage: 'N/A',
      memoryUsage: 'N/A',
      restarts: 1,
    });
    expect(result.current.totalPods).toBe(2);

    /** Verify Pod.apiList was called with the label selector */
    expect(mockApiList).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        // Options passed into apiList
        namespace: 'test-ns',
        cluster: 'test-cluster',
        queryParams: {
          labelSelector: 'app=my-app',
        },
      })
    );
  });

  test('computes projectStatus as Healthy when all pods are Running', async () => {
    const mockPods = [createMockPod('pod-1', 'Running'), createMockPod('pod-2', 'Running')];

    mockDeploymentWithSelector(MOCK_SELECTOR);
    mockPodList(mockPods);

    const { result } = renderHook(() => usePods('my-deployment', 'test-ns', 'test-cluster'));

    await waitFor(() => {
      expect(result.current.projectStatus).toBe('Healthy');
    });
  });

  test('computes projectStatus as Degraded when any pod is not Running', async () => {
    const mockPods = [createMockPod('pod-1', 'Running'), createMockPod('pod-2', 'Pending')];

    mockDeploymentWithSelector(MOCK_SELECTOR);
    mockPodList(mockPods);

    const { result } = renderHook(() => usePods('my-deployment', 'test-ns', 'test-cluster'));

    await waitFor(() => {
      expect(result.current.projectStatus).toBe('Degraded');
    });
  });

  test('sets empty pods when deployment has no selector', async () => {
    mockDeploymentWithSelector(undefined);

    const { result } = renderHook(() => usePods('my-deployment', 'test-ns', 'test-cluster'));

    await waitFor(() => {
      expect(result.current.pods).toHaveLength(0);
    });

    expect(mockApiList).not.toHaveBeenCalled();
  });
});
