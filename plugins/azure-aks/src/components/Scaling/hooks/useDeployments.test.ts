// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the Headlamp K8s API — vi.hoisted ensures the variable is available when vi.mock is hoisted
const mockApiList = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const t = (key: string) => key;
  return {
    K8s: {
      ResourceClasses: {
        Deployment: {
          apiList: mockApiList,
        },
      },
    },
    useTranslation: () => ({ t }),
  };
});

import { useDeployments } from './useDeployments';

/** Helper to create a mock Headlamp deployment object. */
function createMockDeployment(
  name: string,
  namespace: string,
  replicas = 3,
  availableReplicas = 3,
  readyReplicas = 3
) {
  return {
    getName: () => name,
    getNamespace: () => namespace,
    spec: { replicas },
    status: { availableReplicas, readyReplicas },
  };
}

describe('useDeployments', () => {
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

  test('returns empty state when namespace is undefined', () => {
    const { result } = renderHook(() => useDeployments(undefined, 'test-cluster'));

    expect(result.current.deployments).toHaveLength(0);
    expect(result.current.selectedDeployment).toBe('');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockApiList).not.toHaveBeenCalled();
  });

  test('fetches, maps, and auto-selects deployments correctly', () => {
    const mockDeployments = [
      createMockDeployment('app-1', 'test-namespace', 3, 3, 3),
      createMockDeployment('app-2', 'test-namespace', 5, 4, 4),
    ];

    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb(mockDeployments);
      };
    });

    const { result } = renderHook(() => useDeployments('test-namespace', 'test-cluster'));

    expect(result.current.deployments).toHaveLength(2);
    expect(result.current.deployments[0]).toEqual({
      name: 'app-1',
      namespace: 'test-namespace',
      replicas: 3,
      availableReplicas: 3,
      readyReplicas: 3,
    });
    expect(result.current.deployments[1]).toEqual({
      name: 'app-2',
      namespace: 'test-namespace',
      replicas: 5,
      availableReplicas: 4,
      readyReplicas: 4,
    });
    expect(result.current.selectedDeployment).toBe('app-1');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockApiList).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      namespace: 'test-namespace',
      cluster: 'test-cluster',
    });
  });

  test('filters deployments by namespace', () => {
    const mockDeployments = [
      createMockDeployment('app-in-ns', 'test-namespace'),
      createMockDeployment('app-other-ns', 'other-namespace'),
    ];

    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb(mockDeployments);
      };
    });

    const { result } = renderHook(() => useDeployments('test-namespace', 'test-cluster'));

    expect(result.current.deployments).toHaveLength(1);
    expect(result.current.deployments[0].name).toBe('app-in-ns');
  });

  test('handles error callback gracefully', () => {
    mockApiList.mockImplementation((_successCb: Function, errorCb: Function) => {
      return () => {
        errorCb(new Error('API connection failed'));
      };
    });

    const { result } = renderHook(() => useDeployments('test-namespace', 'test-cluster'));

    expect(result.current.deployments).toHaveLength(0);
    expect(result.current.error).toBe('Failed to fetch deployments');
    expect(result.current.loading).toBe(false);
  });

  test('setSelectedDeployment updates the selected deployment', () => {
    const mockDeployments = [
      createMockDeployment('app-1', 'test-namespace'),
      createMockDeployment('app-2', 'test-namespace'),
    ];

    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb(mockDeployments);
      };
    });

    const { result } = renderHook(() => useDeployments('test-namespace', 'test-cluster'));

    expect(result.current.selectedDeployment).toBe('app-1');

    act(() => result.current.setSelectedDeployment('app-2'));

    expect(result.current.selectedDeployment).toBe('app-2');
  });

  test('does not overwrite a manually selected deployment when data reloads', () => {
    const mockDeployments = [
      createMockDeployment('app-1', 'test-namespace'),
      createMockDeployment('app-2', 'test-namespace'),
    ];

    let capturedSuccessCb: Function;
    mockApiList.mockImplementation((successCb: Function) => {
      capturedSuccessCb = successCb;
      return () => {
        successCb(mockDeployments);
      };
    });

    const { result } = renderHook(() => useDeployments('test-namespace', 'test-cluster'));

    expect(result.current.selectedDeployment).toBe('app-1');

    act(() => result.current.setSelectedDeployment('app-2'));
    act(() => capturedSuccessCb(mockDeployments));

    expect(result.current.selectedDeployment).toBe('app-2');
  });

  test('handles deployments with missing status fields', () => {
    const mockDeployments = [
      {
        getName: () => 'partial-deploy',
        getNamespace: () => 'test-namespace',
        spec: { replicas: 2 },
        status: {},
      },
    ];

    mockApiList.mockImplementation((successCb: Function) => {
      return () => {
        successCb(mockDeployments);
      };
    });

    const { result } = renderHook(() => useDeployments('test-namespace', 'test-cluster'));

    expect(result.current.deployments[0]).toEqual({
      name: 'partial-deploy',
      namespace: 'test-namespace',
      replicas: 2,
      availableReplicas: 0,
      readyReplicas: 0,
    });
  });
});
