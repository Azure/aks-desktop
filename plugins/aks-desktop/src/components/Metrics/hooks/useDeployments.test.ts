// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/** Mock the Headlamp K8s API */
const mockApiList = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Deployment: {
        apiList: mockApiList,
      },
    },
  },
  useTranslation: () => ({ t: (s: string) => s }),
}));

import { useDeployments } from './useDeployments';

const MOCK_DEPLOYMENTS = [
  {
    metadata: { name: 'app-1', namespace: 'test-ns' },
    getName: () => 'app-1',
    getNamespace: () => 'test-ns',
  },
  {
    metadata: { name: 'app-2', namespace: 'test-ns' },
    getName: () => 'app-2',
    getNamespace: () => 'test-ns',
  },
];

/** Mocks apiList to call the success callback with the given data. */
function mockApiListSuccess(data: object[]) {
  mockApiList.mockImplementation((successCb: Function) => {
    return () => {
      successCb(data);
      return Promise.resolve(() => {});
    };
  });
}

/** Mocks apiList to call the error callback with the given error. */
function mockApiListError(error: Error) {
  mockApiList.mockImplementation((_successCb: Function, errorCb: Function) => {
    return () => {
      errorCb(error);
      return Promise.resolve(() => {});
    };
  });
}

describe('useDeployments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiListSuccess([]);
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

  test('fetches, maps, and auto-selects first deployment', () => {
    mockApiListSuccess(MOCK_DEPLOYMENTS);

    const { result } = renderHook(() => useDeployments('test-ns', 'test-cluster'));

    expect(result.current.deployments).toHaveLength(2);
    expect(result.current.deployments[0]).toEqual({ name: 'app-1', namespace: 'test-ns' });
    expect(result.current.deployments[1]).toEqual({ name: 'app-2', namespace: 'test-ns' });
    expect(result.current.selectedDeployment).toBe('app-1');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockApiList).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      namespace: 'test-ns',
      cluster: 'test-cluster',
    });
  });

  test('handles error callback gracefully', () => {
    mockApiListError(new Error('API connection failed'));

    const { result } = renderHook(() => useDeployments('test-ns', 'test-cluster'));

    expect(result.current.deployments).toHaveLength(0);
    expect(result.current.error).toBe('Failed to fetch deployments');
    expect(result.current.loading).toBe(false);
  });

  test('handles empty deployment list', () => {
    mockApiListSuccess([]);

    const { result } = renderHook(() => useDeployments('test-ns', 'test-cluster'));

    expect(result.current.deployments).toHaveLength(0);
    expect(result.current.selectedDeployment).toBe('');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test('setSelectedDeployment changes the selected deployment', () => {
    mockApiListSuccess(MOCK_DEPLOYMENTS);

    const { result } = renderHook(() => useDeployments('test-ns', 'test-cluster'));

    expect(result.current.selectedDeployment).toBe('app-1');

    act(() => {
      result.current.setSelectedDeployment('app-2');
    });

    expect(result.current.selectedDeployment).toBe('app-2');
  });
});
