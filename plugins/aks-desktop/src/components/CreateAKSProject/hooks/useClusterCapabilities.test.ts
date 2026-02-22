// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/azure/az-cli', () => ({
  getClusterCapabilities: vi.fn(),
}));

import type { ClusterCapabilities } from '../../../types/ClusterCapabilities';
import { getClusterCapabilities } from '../../../utils/azure/az-cli';
import { useClusterCapabilities } from './useClusterCapabilities';

const mockGetClusterCapabilities = vi.mocked(getClusterCapabilities);

const defaultCapabilities: ClusterCapabilities = {
  sku: 'Automatic',
  aadEnabled: true,
  azureRbacEnabled: true,
  networkPolicy: 'cilium',
  networkPlugin: 'azure',
  prometheusEnabled: true,
  containerInsightsEnabled: true,
  kedaEnabled: true,
  vpaEnabled: true,
};

describe('useClusterCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('has correct initial state', () => {
    const { result } = renderHook(() => useClusterCapabilities());

    expect(result.current.capabilities).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading state while fetching', async () => {
    let resolvePromise: (value: any) => void;
    const pendingPromise = new Promise<any>(resolve => {
      resolvePromise = resolve;
    });
    mockGetClusterCapabilities.mockReturnValue(pendingPromise);

    const { result } = renderHook(() => useClusterCapabilities());

    act(() => {
      result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name').catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    expect(result.current.capabilities).toBeNull();
    expect(result.current.error).toBeNull();

    // Resolve to clean up
    await act(async () => {
      resolvePromise!(defaultCapabilities);
    });
  });

  it('updates capabilities on successful fetch', async () => {
    mockGetClusterCapabilities.mockResolvedValue(defaultCapabilities);

    const { result } = renderHook(() => useClusterCapabilities());

    await act(async () => {
      await result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name');
    });

    expect(result.current.capabilities).toEqual(defaultCapabilities);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    expect(mockGetClusterCapabilities).toHaveBeenCalledWith({
      subscriptionId: 'sub-id',
      resourceGroup: 'rg-name',
      clusterName: 'cluster-name',
    });
  });

  it('sets error on failed fetch', async () => {
    mockGetClusterCapabilities.mockRejectedValue(
      new Error('Failed to get cluster capabilities: some error')
    );

    const { result } = renderHook(() => useClusterCapabilities());

    await act(async () => {
      const returned = await result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name');
      expect(returned).toBeNull();
    });

    expect(result.current.capabilities).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Failed to get cluster capabilities: some error');
  });

  it('sets specific error message for missing Azure CLI', async () => {
    mockGetClusterCapabilities.mockRejectedValue(new Error('Azure CLI (az) command not found'));

    const { result } = renderHook(() => useClusterCapabilities());

    await act(async () => {
      const returned = await result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name');
      expect(returned).toBeNull();
    });

    expect(result.current.error).toBe(
      'Azure CLI is not installed. Please install Azure CLI and try again.'
    );
  });

  it('sets specific error message for auth failure', async () => {
    mockGetClusterCapabilities.mockRejectedValue(new Error('Please log in to Azure CLI: az login'));

    const { result } = renderHook(() => useClusterCapabilities());

    await act(async () => {
      const returned = await result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name');
      expect(returned).toBeNull();
    });

    expect(result.current.error).toBe(
      'Please log in to Azure CLI first. Use "az login" in your terminal.'
    );
  });

  it('sets generic error message for non-Error thrown values', async () => {
    mockGetClusterCapabilities.mockRejectedValue('string error');

    const { result } = renderHook(() => useClusterCapabilities());

    await act(async () => {
      const returned = await result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name');
      expect(returned).toBeNull();
    });

    expect(result.current.error).toBe('Failed to check cluster capabilities');
  });

  it('clearCapabilities resets state to initial values', async () => {
    mockGetClusterCapabilities.mockResolvedValue(defaultCapabilities);

    const { result } = renderHook(() => useClusterCapabilities());

    // First, fetch capabilities successfully
    await act(async () => {
      await result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name');
    });

    expect(result.current.capabilities).toEqual(defaultCapabilities);

    // Now clear
    act(() => {
      result.current.clearCapabilities();
    });

    expect(result.current.capabilities).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('clearCapabilities resets error state', async () => {
    mockGetClusterCapabilities.mockRejectedValue(new Error('some error'));

    const { result } = renderHook(() => useClusterCapabilities());

    await act(async () => {
      const returned = await result.current.fetchCapabilities('sub-id', 'rg-name', 'cluster-name');
      expect(returned).toBeNull();
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearCapabilities();
    });

    expect(result.current.capabilities).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('ignores stale responses when fetchCapabilities is called rapidly', async () => {
    // Set up two different responses - first one slow, second one fast
    const slowCapabilities = { ...defaultCapabilities, kedaEnabled: false };
    const fastCapabilities = { ...defaultCapabilities, kedaEnabled: true };

    let resolveFirst: (value: any) => void;
    const firstPromise = new Promise(resolve => {
      resolveFirst = resolve;
    });

    vi.mocked(getClusterCapabilities)
      .mockReturnValueOnce(firstPromise as any) // first call - slow
      .mockResolvedValueOnce(fastCapabilities); // second call - fast

    const { result } = renderHook(() => useClusterCapabilities());

    // Fire both requests rapidly
    let firstResult: any;
    let secondResult: any;
    await act(async () => {
      firstResult = result.current.fetchCapabilities('sub', 'rg', 'cluster-1');
      secondResult = result.current.fetchCapabilities('sub', 'rg', 'cluster-2');
      // Second resolves immediately
      await secondResult;
    });

    // State should reflect the second (latest) request
    expect(result.current.capabilities).toEqual(fastCapabilities);

    // Now resolve the first (stale) request
    await act(async () => {
      resolveFirst!(slowCapabilities);
      await firstResult;
    });

    // State should STILL reflect the second request (first was ignored)
    expect(result.current.capabilities).toEqual(fastCapabilities);
  });

  it('returns capabilities from fetchCapabilities on success', async () => {
    mockGetClusterCapabilities.mockResolvedValue(defaultCapabilities);

    const { result } = renderHook(() => useClusterCapabilities());

    let returnedCapabilities: any;
    await act(async () => {
      returnedCapabilities = await result.current.fetchCapabilities(
        'sub-id',
        'rg-name',
        'cluster-name'
      );
    });

    expect(returnedCapabilities).toEqual(defaultCapabilities);
  });
});
