// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/azure/az-clusters', () => ({
  getClusterCapabilities: vi.fn(),
}));

vi.mock('../utils/azure/az-identity', () => ({
  getManagedNamespaceResourceId: vi.fn(),
}));

import { getClusterCapabilities } from '../utils/azure/az-clusters';
import { getManagedNamespaceResourceId } from '../utils/azure/az-identity';
import { useNamespaceCapabilities } from './useNamespaceCapabilities';

const mockGetManagedNamespaceResourceId = vi.mocked(getManagedNamespaceResourceId);
const mockGetClusterCapabilities = vi.mocked(getClusterCapabilities);

describe('useNamespaceCapabilities', () => {
  it('returns undefined for both when params are undefined and makes no API calls', () => {
    const { result } = renderHook(() =>
      useNamespaceCapabilities({
        subscriptionId: undefined,
        resourceGroup: undefined,
        clusterName: undefined,
        namespace: 'default',
      })
    );

    expect(result.current.isManagedNamespace).toBeUndefined();
    expect(result.current.azureRbacEnabled).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(mockGetManagedNamespaceResourceId).not.toHaveBeenCalled();
    expect(mockGetClusterCapabilities).not.toHaveBeenCalled();
  });

  it('calls both APIs and returns success values', async () => {
    mockGetManagedNamespaceResourceId.mockResolvedValue({
      success: true,
      resourceId: '/subscriptions/sub-1/...',
    });
    mockGetClusterCapabilities.mockResolvedValue({
      sku: 'Standard',
      aadEnabled: true,
      azureRbacEnabled: true,
      networkPolicy: null,
      networkPlugin: 'azure',
      prometheusEnabled: null,
      containerInsightsEnabled: null,
      kedaEnabled: null,
      vpaEnabled: null,
    });

    const { result } = renderHook(() =>
      useNamespaceCapabilities({
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        clusterName: 'cluster-1',
        namespace: 'my-ns',
      })
    );

    await waitFor(() => {
      expect(result.current.isManagedNamespace).toBe(true);
      expect(result.current.azureRbacEnabled).toBe(true);
      expect(result.current.error).toBeNull();
    });

    expect(mockGetManagedNamespaceResourceId).toHaveBeenCalledWith({
      clusterName: 'cluster-1',
      resourceGroup: 'rg-1',
      namespaceName: 'my-ns',
      subscriptionId: 'sub-1',
    });
    expect(mockGetClusterCapabilities).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      resourceGroup: 'rg-1',
      clusterName: 'cluster-1',
    });
  });

  it('leaves isManagedNamespace undefined when result.success is false (non-success is indeterminate)', async () => {
    mockGetManagedNamespaceResourceId.mockResolvedValue({ success: false });
    mockGetClusterCapabilities.mockResolvedValue({
      sku: 'Standard',
      aadEnabled: true,
      azureRbacEnabled: false,
      networkPolicy: null,
      networkPlugin: 'azure',
      prometheusEnabled: null,
      containerInsightsEnabled: null,
      kedaEnabled: null,
      vpaEnabled: null,
    });

    const { result } = renderHook(() =>
      useNamespaceCapabilities({
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        clusterName: 'cluster-1',
        namespace: 'my-ns',
      })
    );

    await waitFor(() => {
      expect(result.current.isManagedNamespace).toBeUndefined();
      expect(result.current.azureRbacEnabled).toBe(false);
      expect(result.current.error).toBeTruthy();
    });
  });

  it('sets isManagedNamespace false when namespace is not managed (success with no resourceId)', async () => {
    mockGetManagedNamespaceResourceId.mockResolvedValue({
      success: true,
      resourceId: undefined,
    });
    mockGetClusterCapabilities.mockResolvedValue({
      sku: 'Standard',
      aadEnabled: true,
      azureRbacEnabled: false,
      networkPolicy: null,
      networkPlugin: 'azure',
      prometheusEnabled: null,
      containerInsightsEnabled: null,
      kedaEnabled: null,
      vpaEnabled: null,
    });

    const { result } = renderHook(() =>
      useNamespaceCapabilities({
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        clusterName: 'cluster-1',
        namespace: 'regular-ns',
      })
    );

    await waitFor(() => {
      expect(result.current.isManagedNamespace).toBe(false);
      expect(result.current.azureRbacEnabled).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  it('falls back on API rejection: isManagedNamespace false, azureRbacEnabled undefined', async () => {
    mockGetManagedNamespaceResourceId.mockRejectedValue(new Error('fail'));
    mockGetClusterCapabilities.mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() =>
      useNamespaceCapabilities({
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
        clusterName: 'cluster-1',
        namespace: 'my-ns',
      })
    );

    await waitFor(() => {
      expect(result.current.isManagedNamespace).toBe(false);
      expect(result.current.azureRbacEnabled).toBeUndefined();
      expect(result.current.error).toContain('fail');
    });
  });
});
