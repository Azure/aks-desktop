// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAzureContext } from './useAzureContext';

vi.mock('../utils/azure/az-cli', () => ({
  getClusterInfo: vi.fn(),
}));

vi.mock('./useAzureAuth', () => ({
  useAzureAuth: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const t = (key: string) => key;
  return {
    useTranslation: () => ({ t }),
  };
});

import { getClusterInfo } from '../utils/azure/az-cli';
import type { AzureAuthStatus } from './useAzureAuth';
import { useAzureAuth } from './useAzureAuth';

const mockGetClusterInfo = vi.mocked(getClusterInfo);
const mockUseAzureAuth = vi.mocked(useAzureAuth);

function mockAuth(overrides: Partial<AzureAuthStatus> = {}): void {
  mockUseAzureAuth.mockReturnValue({
    isLoggedIn: true,
    isChecking: false,
    tenantId: 'tenant-1',
    ...overrides,
  });
}

describe('useAzureContext', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when no cluster is provided', () => {
    mockAuth();

    const { result } = renderHook(() => useAzureContext(undefined));

    expect(result.current.azureContext).toBeNull();
    expect(result.current.error).toBe('No cluster is associated with this project.');
    expect(mockGetClusterInfo).not.toHaveBeenCalled();
  });

  it('returns error when user is not logged in', () => {
    mockAuth({ isLoggedIn: false, tenantId: undefined });

    const { result } = renderHook(() => useAzureContext('my-cluster'));

    expect(result.current.azureContext).toBeNull();
    expect(result.current.error).toBe('Please sign in to Azure to continue.');
    expect(mockGetClusterInfo).not.toHaveBeenCalled();
  });

  it('resolves context when cluster info is available', async () => {
    mockAuth();
    mockGetClusterInfo.mockResolvedValue({
      clusterName: 'my-cluster',
      subscriptionId: 'sub-1',
      resourceGroup: 'rg-1',
    });

    const { result } = renderHook(() => useAzureContext('my-cluster'));

    await waitFor(() => {
      expect(result.current.azureContext).toEqual({
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        tenantId: 'tenant-1',
      });
    });
    expect(result.current.error).toBeNull();
  });

  it('sets error when getClusterInfo fails', async () => {
    mockAuth();
    mockGetClusterInfo.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useAzureContext('my-cluster'));

    await waitFor(() => {
      expect(result.current.error).toBe('network error');
    });
    expect(result.current.azureContext).toBeNull();
  });

  it('sets error when required fields are missing', async () => {
    mockAuth({ tenantId: undefined });
    mockGetClusterInfo.mockResolvedValue({
      clusterName: 'my-cluster',
      subscriptionId: 'sub-1',
      resourceGroup: undefined,
    });

    const { result } = renderHook(() => useAzureContext('my-cluster'));

    await waitFor(() => {
      expect(result.current.error).toContain('Missing required Azure context');
    });
    expect(result.current.azureContext).toBeNull();
  });

  it('clears context when cluster changes to undefined', async () => {
    mockAuth();
    mockGetClusterInfo.mockResolvedValue({
      clusterName: 'my-cluster',
      subscriptionId: 'sub-1',
      resourceGroup: 'rg-1',
    });

    const { result, rerender } = renderHook(({ cluster }) => useAzureContext(cluster), {
      initialProps: { cluster: 'my-cluster' as string | undefined },
    });

    await waitFor(() => {
      expect(result.current.azureContext).not.toBeNull();
    });

    rerender({ cluster: undefined });

    expect(result.current.azureContext).toBeNull();
    expect(result.current.error).toBe('No cluster is associated with this project.');
  });
});
