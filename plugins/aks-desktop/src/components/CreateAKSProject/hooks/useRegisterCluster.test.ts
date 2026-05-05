// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRegisterAKSCluster = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/azure/aks', () => ({
  registerAKSCluster: mockRegisterAKSCluster,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      // Minimal interpolation so success/error messages come through correctly
      if (!opts) return key;
      return key.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => opts[k] ?? k);
    },
  }),
}));

import { useRegisterCluster } from './useRegisterCluster';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRegisterCluster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('starts with loading=false, no error, no success', () => {
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.success).toBeUndefined();
  });

  test('handleRegister sets loading=true while the call is in flight', async () => {
    let resolveRegister!: (value: { success: boolean; message: string }) => void;
    const registerPromise = new Promise<{ success: boolean; message: string }>(resolve => {
      resolveRegister = resolve;
    });
    mockRegisterAKSCluster.mockReturnValue(registerPromise);
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    let handleRegisterPromise!: Promise<void>;
    act(() => {
      handleRegisterPromise = result.current.handleRegister();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveRegister({ success: true, message: 'ok' });
      await handleRegisterPromise;
    });
  });

  test('handleRegister sets success message on result.success=true', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: true, message: 'ok' });
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.success).toContain('aks-prod');
  });

  test('handleRegister sets error when result.success=false', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'credentials expired' });
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('credentials expired');
    expect(result.current.success).toBeUndefined();
  });

  test('handleRegister sets error on thrown Error', async () => {
    mockRegisterAKSCluster.mockRejectedValue(new Error('network timeout'));
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain('network timeout');
    expect(result.current.success).toBeUndefined();
  });

  test('handleRegister uses "Unknown error" for non-Error rejections', async () => {
    mockRegisterAKSCluster.mockRejectedValue('something went wrong');
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });

    expect(result.current.error).toContain('Unknown error');
  });

  test('handleRegister passes subscription, resourceGroup, cluster, and tenantId to registerAKSCluster', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: true, message: '' });
    const { result } = renderHook(() =>
      useRegisterCluster('aks-prod', 'rg-prod', 'sub-123', 'tenant-abc')
    );

    await act(async () => {
      await result.current.handleRegister();
    });

    expect(mockRegisterAKSCluster).toHaveBeenCalledWith(
      'sub-123',
      'rg-prod',
      'aks-prod',
      undefined,
      'tenant-abc'
    );
  });

  test('handleRegister does not call registerAKSCluster when cluster is empty', async () => {
    const { result } = renderHook(() => useRegisterCluster('', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });

    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
  });

  test('handleRegister does not call registerAKSCluster when subscription is empty', async () => {
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', ''));

    await act(async () => {
      await result.current.handleRegister();
    });

    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
  });

  test('clearError resets error to undefined', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'something failed' });
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });
    expect(result.current.error).toBeDefined();

    act(() => result.current.clearError());
    expect(result.current.error).toBeUndefined();
  });

  test('clearSuccess resets success to undefined', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: true, message: '' });
    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });
    expect(result.current.success).toBeDefined();

    act(() => result.current.clearSuccess());
    expect(result.current.success).toBeUndefined();
  });

  test('clears previous error before a new registration attempt', async () => {
    let resolveSecond!: (value: { success: boolean; message: string }) => void;
    const secondPromise = new Promise<{ success: boolean; message: string }>(resolve => {
      resolveSecond = resolve;
    });
    mockRegisterAKSCluster
      .mockResolvedValueOnce({ success: false, message: 'first error' })
      .mockReturnValueOnce(secondPromise);

    const { result } = renderHook(() => useRegisterCluster('aks-prod', 'rg-prod', 'sub-123'));

    await act(async () => {
      await result.current.handleRegister();
    });
    expect(result.current.error).toBe('first error');

    let secondHandlePromise!: Promise<void>;
    act(() => {
      secondHandlePromise = result.current.handleRegister();
    });
    // error should be cleared immediately when the second attempt starts
    expect(result.current.error).toBeUndefined();

    await act(async () => {
      resolveSecond({ success: true, message: 'ok' });
      await secondHandlePromise;
    });
  });
});
