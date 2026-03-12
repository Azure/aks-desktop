// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockUseGet = vi.hoisted(() => vi.fn());
const mockGetAuthorization = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        useGet: mockUseGet,
      },
    },
  },
}));

import { useProjectPermissions } from './useProjectPermissions';

const project = {
  id: 'test-project',
  namespaces: ['test-ns'],
  clusters: ['test-cluster'],
};

function mockNamespace() {
  return { getAuthorization: mockGetAuthorization };
}

function authResult(allowed: boolean) {
  return { status: { allowed } };
}

describe('useProjectPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns loading while namespace is being fetched', () => {
    mockUseGet.mockReturnValue([null, null]);

    const { result } = renderHook(() => useProjectPermissions(project));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.canDelete).toBe(false);
  });

  test('returns canDelete=false on namespace fetching error', async () => {
    mockUseGet.mockReturnValue([null, new Error('not found')]);

    const { result } = renderHook(() => useProjectPermissions(project));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.canDelete).toBe(false);
  });

  test('returns canDelete=true when both update and delete are allowed', async () => {
    mockGetAuthorization.mockResolvedValue(authResult(true));
    mockUseGet.mockReturnValue([mockNamespace(), null]);

    const { result } = renderHook(() => useProjectPermissions(project));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.canDelete).toBe(true);
  });

  test('returns canDelete=false when update is denied', async () => {
    mockGetAuthorization
      .mockResolvedValueOnce(authResult(false)) // 1st call: getAuthorization('update') -> denied -> nsIsEditable=false
      .mockResolvedValueOnce(authResult(true)); // 2nd call: getAuthorization('delete') -> allowed -> nsIsDeletable=true
    mockUseGet.mockReturnValue([mockNamespace(), null]);

    const { result } = renderHook(() => useProjectPermissions(project));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.canDelete).toBe(false);
  });

  test('returns canDelete=false when delete is denied', async () => {
    mockGetAuthorization
      .mockResolvedValueOnce(authResult(true)) // 1st call: getAuthorization('update') -> allowed -> nsIsEditable=true
      .mockResolvedValueOnce(authResult(false)); // 2nd call: getAuthorization('delete') -> denied-> nsIsDeletable=false
    mockUseGet.mockReturnValue([mockNamespace(), null]);

    const { result } = renderHook(() => useProjectPermissions(project));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.canDelete).toBe(false);
  });

  test('returns canDelete=false when getAuthorization throws', async () => {
    mockGetAuthorization.mockRejectedValue(new Error('RBAC error'));
    mockUseGet.mockReturnValue([mockNamespace(), null]);

    const { result } = renderHook(() => useProjectPermissions(project));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.canDelete).toBe(false);
  });

  test('passes correct cluster option to useGet', () => {
    mockUseGet.mockReturnValue([null, null]);

    renderHook(() => useProjectPermissions(project));

    expect(mockUseGet).toHaveBeenCalledWith('test-ns', undefined, {
      cluster: 'test-cluster',
    });
  });
});
