// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const consentMocks = vi.hoisted(() => {
  let epoch = 0;
  const listeners = new Set<() => void>();
  return {
    getConsentEpoch: vi.fn(() => epoch),
    subscribeConsentEpoch: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    __bump: () => {
      epoch += 1;
      listeners.forEach(l => l());
    },
    __listenerCount: () => listeners.size,
  };
});
vi.mock('../telemetry/consent', () => ({
  getConsentEpoch: consentMocks.getConsentEpoch,
  subscribeConsentEpoch: consentMocks.subscribeConsentEpoch,
}));

import { useConsentEpoch } from './useConsentEpoch';

// This project's Vitest config does not enable @testing-library/react's
// automatic afterEach cleanup (it only detects a true global `afterEach`,
// which globals:true does not provide), so each renderHook call must be
// unmounted explicitly or its subscribeConsentEpoch listener leaks into
// the next test.
afterEach(cleanup);

describe('useConsentEpoch', () => {
  it('returns the current epoch from getConsentEpoch', () => {
    const { result } = renderHook(() => useConsentEpoch());
    expect(result.current).toBe(0);
    expect(consentMocks.getConsentEpoch).toHaveBeenCalled();
  });

  it('re-renders with the new epoch when the store notifies a change', () => {
    const { result } = renderHook(() => useConsentEpoch());
    expect(result.current).toBe(0);

    act(() => {
      consentMocks.__bump();
    });

    expect(result.current).toBe(1);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useConsentEpoch());
    expect(consentMocks.__listenerCount()).toBe(1);
    unmount();
    expect(consentMocks.__listenerCount()).toBe(0);
  });
});
