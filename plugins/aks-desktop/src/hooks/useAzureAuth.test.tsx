// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AzureLoginStatus } from '../utils/azure/az-auth';
import { getLoginStatus } from '../utils/azure/az-auth';
import { useAzureAuth } from './useAzureAuth';

vi.mock('../utils/azure/az-auth', () => ({ getLoginStatus: vi.fn() }));
const readStatus = vi.mocked(getLoginStatus);
const signedIn: AzureLoginStatus = {
  isLoggedIn: true,
  username: 'first@example.test',
  tenantId: 'tenant-a',
  subscriptionId: 'subscription-a',
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

beforeEach(() => {
  readStatus.mockReset().mockResolvedValue(signedIn);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Azure authentication refresh', () => {
  it.each(['azure-auth-update', 'azure-account-change'])(
    'blocks the previous account until a fresh %s check completes',
    async event => {
      const { result } = renderHook(() => useAzureAuth(), { wrapper });
      await waitFor(() => expect(result.current.isChecking).toBe(false));
      let complete!: (status: AzureLoginStatus) => void;
      readStatus.mockReturnValueOnce(new Promise(resolve => (complete = resolve)));
      act(() => window.dispatchEvent(new Event(event)));
      expect(result.current).toEqual({ isLoggedIn: false, isChecking: true });
      await act(async () =>
        complete({ ...signedIn, username: 'second@example.test', tenantId: 'tenant-b' })
      );
      expect(result.current).toMatchObject({
        isChecking: false,
        isLoggedIn: true,
        username: 'second@example.test',
        tenantId: 'tenant-b',
      });
    }
  );

  it('does not publish a stale check after a newer authentication event', async () => {
    let complete!: (status: AzureLoginStatus) => void;
    readStatus.mockReturnValueOnce(new Promise(resolve => (complete = resolve)));
    const { result } = renderHook(() => useAzureAuth(), { wrapper });
    readStatus.mockResolvedValueOnce({ isLoggedIn: false, error: 'Please sign in again' });
    act(() => window.dispatchEvent(new Event('azure-account-change')));
    await waitFor(() => expect(result.current.isChecking).toBe(false));
    await act(async () => complete(signedIn));
    expect(result.current).toEqual({
      isChecking: false,
      isLoggedIn: false,
      username: undefined,
      tenantId: undefined,
      subscriptionId: undefined,
      error: 'Please sign in again',
    });
  });

  it('ignores an obsolete failed check instead of overwriting a successful refresh', async () => {
    let reject!: (error: Error) => void;
    readStatus.mockReturnValueOnce(new Promise((_resolve, fail) => (reject = fail)));
    const { result } = renderHook(() => useAzureAuth(), { wrapper });
    act(() => window.dispatchEvent(new Event('azure-auth-update')));
    await waitFor(() => expect(result.current.isLoggedIn).toBe(true));
    await act(async () => reject(new Error('Old check failed')));
    expect(result.current).toMatchObject({ isChecking: false, username: signedIn.username });
  });

  it('reports a current authentication failure without leaving checking stuck', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    readStatus.mockRejectedValueOnce(new Error('Authentication unavailable'));
    const { result } = renderHook(() => useAzureAuth(), { wrapper });
    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current).toEqual({
      isLoggedIn: false,
      isChecking: false,
      error: 'Authentication unavailable',
    });
    expect(log).toHaveBeenCalled();
  });

  it('removes both listeners and ignores late checks after unmount', async () => {
    let complete!: (status: AzureLoginStatus) => void;
    readStatus.mockReturnValueOnce(new Promise(resolve => (complete = resolve)));
    const { unmount } = renderHook(() => useAzureAuth(), { wrapper });
    unmount();
    act(() => {
      window.dispatchEvent(new Event('azure-auth-update'));
      window.dispatchEvent(new Event('azure-account-change'));
    });
    await act(async () => complete(signedIn));
    expect(readStatus).toHaveBeenCalledTimes(1);
  });
});
