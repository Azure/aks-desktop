// @vitest-environment jsdom
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseGet = vi.hoisted(() => vi.fn());
const mockListNamespaceRoleAssignments = vi.hoisted(() => vi.fn());
const mockT = vi.hoisted(() => (key: string) => key);

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        useGet: mockUseGet,
      },
    },
  },
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('../../../utils/azure/az-namespace-access', () => ({
  listNamespaceRoleAssignments: mockListNamespaceRoleAssignments,
}));

import { useAccessTab } from './useAccessTab';

function createNamespaceInstance(subscription = 'test-sub', resourceGroup = 'test-rg') {
  return {
    jsonData: {
      metadata: {
        labels: {
          'aks-desktop/project-subscription': subscription,
          'aks-desktop/project-resource-group': resourceGroup,
        },
      },
    },
  };
}

function createProject(suffix: string) {
  return {
    clusters: [`cluster-${suffix}`],
    namespaces: [`namespace-${suffix}`],
  };
}

describe('useAccessTab', () => {
  beforeEach(() => {
    mockUseGet.mockReturnValue([createNamespaceInstance()]);
    mockListNamespaceRoleAssignments.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('uses cache on re-mount if within TTL window', async () => {
    const project = createProject('test-project');
    const assignments = [
      {
        principalName: 'bob@example.com',
        principalType: 'User',
        roleDefinitionName: 'Reader',
        scope: '/scope/one',
      },
    ];

    mockListNamespaceRoleAssignments.mockResolvedValue({
      success: true,
      assignments,
    });

    const first = renderHook(() => useAccessTab(project));

    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.assignments).toEqual(assignments);
    expect(mockListNamespaceRoleAssignments).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(() => useAccessTab(project));

    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.assignments).toEqual(assignments);
    expect(mockListNamespaceRoleAssignments).toHaveBeenCalledTimes(1);
  });

  test('refresh bypasses the cache and does a re-fetch', async () => {
    const project = createProject('refresh');
    const firstAssignments = [
      {
        principalName: 'jack@example.com',
        principalType: 'User',
        roleDefinitionName: 'Reader',
        scope: '/scope/one',
      },
    ];
    const refreshedAssignments = [
      {
        principalName: 'bill@example.com',
        principalType: 'User',
        roleDefinitionName: 'Writer',
        scope: '/scope/two',
      },
    ];

    mockListNamespaceRoleAssignments
      .mockResolvedValueOnce({ success: true, assignments: firstAssignments })
      .mockResolvedValueOnce({ success: true, assignments: refreshedAssignments });

    const { result } = renderHook(() => useAccessTab(project));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assignments).toEqual(firstAssignments);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assignments).toEqual(refreshedAssignments);
    expect(mockListNamespaceRoleAssignments).toHaveBeenCalledTimes(2);
  });

  test('properly surfaces errors from listNamespaceRoleAssignments', async () => {
    const project = createProject('error');

    mockListNamespaceRoleAssignments.mockResolvedValue({
      success: false,
      assignments: [],
      error: 'role assignment lookup failed',
    });

    const { result } = renderHook(() => useAccessTab(project));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.assignments).toEqual([]);
    expect(result.current.error).toBe('Failed to load role assignments');
  });
});
