// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchNamespaceData = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/kubernetes/namespaceUtils', () => ({
  fetchNamespaceData: mockFetchNamespaceData,
}));
vi.mock('../../../utils/azure/az-namespace-access', () => ({
  checkNamespaceExists: vi.fn(),
}));

import { useNamespaceCheck } from './useNamespaceCheck';

/** A rejection shaped like the API's, carrying the status the caller reads. */
function apiError(status: number) {
  const err = new Error(`Failed to fetch namespace: ${status}`) as Error & { status?: number };
  err.status = status;
  return err;
}

describe('useNamespaceCheck — Arc namespace existence', () => {
  beforeEach(() => {
    mockFetchNamespaceData.mockReset();
  });

  it('treats a 404 as available', async () => {
    mockFetchNamespaceData.mockRejectedValue(apiError(404));
    const { result } = renderHook(() => useNamespaceCheck());

    await act(async () => {
      await result.current.checkNamespaceViaK8s('cluster-a', 'proj');
    });

    expect(result.current.exists).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not call a permission failure "available"', async () => {
    // A 403 says nothing about whether the name is free. Reporting it as
    // available lets creation proceed into a namespace that may already exist.
    mockFetchNamespaceData.mockRejectedValue(apiError(403));
    const { result } = renderHook(() => useNamespaceCheck());

    await act(async () => {
      await result.current.checkNamespaceViaK8s('cluster-a', 'proj');
    });

    expect(result.current.exists).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('ignores a slower earlier check that settles after a newer one', async () => {
    // Change the project name mid-flight and the first answer can arrive last;
    // without a generation guard it decides the status for the current name.
    let settleFirst!: (v: unknown) => void;
    mockFetchNamespaceData
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          settleFirst = () => reject(apiError(404));
        })
      )
      .mockResolvedValueOnce({ metadata: { name: 'taken' } });

    const { result } = renderHook(() => useNamespaceCheck());

    act(() => {
      void result.current.checkNamespaceViaK8s('cluster-a', 'free-name');
    });
    await act(async () => {
      await result.current.checkNamespaceViaK8s('cluster-a', 'taken');
    });
    await waitFor(() => expect(result.current.exists).toBe(true));

    // The stale check now reports "available" — it must be ignored.
    await act(async () => {
      settleFirst(undefined);
      await Promise.resolve();
    });

    expect(result.current.exists).toBe(true);
  });
});
