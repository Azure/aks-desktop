// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAzureContext } from './useAzureContext';

vi.mock('../utils/azure/az-clusters', () => ({
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

import { getClusterInfo } from '../utils/azure/az-clusters';
import { AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT } from '../utils/azure/az-token';
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
    cleanup();
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

  it('reports loading, not a sign-in error, while the auth check is still running', () => {
    mockAuth({ isLoggedIn: false, isChecking: true, tenantId: undefined });

    const { result } = renderHook(() => useAzureContext('my-cluster'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.azureContext).toBeNull();
    expect(mockGetClusterInfo).not.toHaveBeenCalled();
  });

  it('resolves context when cluster info is available', async () => {
    mockAuth();
    mockGetClusterInfo.mockResolvedValue({
      clusterName: 'my-cluster',
      subscriptionId: 'sub-1',
      resourceGroup: 'rg-1',
      tenantId: 'cluster-tenant',
    });

    const { result } = renderHook(() => useAzureContext('my-cluster'));

    await waitFor(() => {
      expect(result.current.azureContext).toEqual({
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        tenantId: 'cluster-tenant',
      });
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it.each([['SUB-1'], ['unrelated-subscription', 'SUB-1']])(
    're-resolves context when its subscription tenant changes in %j',
    async (...subscriptionIds) => {
      mockAuth();
      mockGetClusterInfo
        .mockResolvedValueOnce({
          clusterName: 'my-cluster',
          subscriptionId: 'sub-1',
          resourceGroup: 'rg-1',
          tenantId: 'tenant-a',
        })
        .mockResolvedValue({
          clusterName: 'my-cluster',
          subscriptionId: 'sub-1',
          resourceGroup: 'rg-1',
          tenantId: 'tenant-b',
        });
      const { result } = renderHook(() => useAzureContext('my-cluster'));
      await waitFor(() => expect(result.current.azureContext?.tenantId).toBe('tenant-a'));
      const callsBeforeChange = mockGetClusterInfo.mock.calls.length;

      act(() => {
        window.dispatchEvent(
          new CustomEvent(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, {
            detail: { subscriptionIds },
          })
        );
      });
      await waitFor(() => expect(result.current.azureContext?.tenantId).toBe('tenant-b'));
      expect(mockGetClusterInfo).toHaveBeenCalledTimes(callsBeforeChange + 1);
    }
  );

  it('preserves resolved cluster context during an unrelated subscription tenant change', async () => {
    mockAuth();
    mockGetClusterInfo.mockResolvedValueOnce({
      clusterName: 'my-cluster',
      subscriptionId: 'sub-1',
      resourceGroup: 'rg-1',
      tenantId: 'tenant-a',
    });
    const { result } = renderHook(() => useAzureContext('my-cluster'));
    await waitFor(() => expect(result.current.azureContext?.tenantId).toBe('tenant-a'));
    const resolvedContext = result.current.azureContext;
    const callsBeforeChange = mockGetClusterInfo.mock.calls.length;
    mockGetClusterInfo.mockReturnValueOnce(new Promise(() => {}));

    act(() =>
      window.dispatchEvent(
        new CustomEvent(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, {
          detail: { subscriptionIds: ['sub-2'] },
        })
      )
    );

    expect(result.current.azureContext).toBe(resolvedContext);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetClusterInfo).toHaveBeenCalledTimes(callsBeforeChange);
  });

  it('refreshes unknown subscription context and ignores its obsolete pending lookup', async () => {
    mockAuth();
    let complete!: (context: Awaited<ReturnType<typeof getClusterInfo>>) => void;
    mockGetClusterInfo
      .mockReturnValueOnce(new Promise(resolve => (complete = resolve)))
      .mockResolvedValue({
        clusterName: 'my-cluster',
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        tenantId: 'tenant-b',
      });
    const { result } = renderHook(() => useAzureContext('my-cluster'));
    expect(result.current.azureContext).toBeNull();
    const callsBeforeChange = mockGetClusterInfo.mock.calls.length;
    act(() =>
      window.dispatchEvent(
        new CustomEvent(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, {
          detail: { subscriptionIds: ['sub-2'] },
        })
      )
    );
    await waitFor(() => expect(result.current.azureContext?.tenantId).toBe('tenant-b'));
    expect(mockGetClusterInfo).toHaveBeenCalledTimes(callsBeforeChange + 1);
    await act(async () =>
      complete({
        clusterName: 'my-cluster',
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        tenantId: 'tenant-a',
      })
    );
    expect(result.current.azureContext?.tenantId).toBe('tenant-b');
  });

  it('sets error when getClusterInfo fails', async () => {
    mockAuth();
    mockGetClusterInfo.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useAzureContext('my-cluster'));

    await waitFor(() => {
      expect(result.current.error).toBe('network error');
    });
    expect(result.current.azureContext).toBeNull();
    expect(result.current.isLoading).toBe(false);
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
    expect(result.current.isLoading).toBe(false);
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
