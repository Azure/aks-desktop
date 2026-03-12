// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseGet = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        useGet: mockUseGet,
      },
    },
  },
}));

import { useNamespaceLabels } from './useNamespaceLabels';

describe('useNamespaceLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGet.mockReturnValue([null]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test('returns undefined values when namespace instance is null', () => {
    mockUseGet.mockReturnValue([null]);

    const { result } = renderHook(() => useNamespaceLabels('test-namespace', 'test-cluster'));

    expect(result.current.subscription).toBeUndefined();
    expect(result.current.resourceGroupLabel).toBeUndefined();
  });

  test('returns undefined values when labels are missing from namespace', () => {
    mockUseGet.mockReturnValue([
      {
        jsonData: {
          metadata: {
            labels: {},
          },
        },
      },
    ]);

    const { result } = renderHook(() => useNamespaceLabels('test-namespace', 'test-cluster'));

    expect(result.current.subscription).toBeUndefined();
    expect(result.current.resourceGroupLabel).toBeUndefined();
  });

  test('returns subscription and resourceGroupLabel when labels exist', () => {
    mockUseGet.mockReturnValue([
      {
        jsonData: {
          metadata: {
            labels: {
              'aks-desktop/project-subscription': 'sub-123',
              'aks-desktop/project-resource-group': 'rg-test',
            },
          },
        },
      },
    ]);

    const { result } = renderHook(() => useNamespaceLabels('test-namespace', 'test-cluster'));

    expect(result.current.subscription).toBe('sub-123');
    expect(result.current.resourceGroupLabel).toBe('rg-test');
    expect(mockUseGet).toHaveBeenCalledWith('test-namespace', undefined, {
      cluster: 'test-cluster',
    });
  });
});
