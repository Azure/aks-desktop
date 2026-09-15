// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockPush = vi.hoisted(() => vi.fn());
const mockUseAzureAuth = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockPush }),
}));

vi.mock('../../../hooks/useAzureAuth', () => ({
  useAzureAuth: mockUseAzureAuth,
}));

vi.mock('../../../azureAuth', () => ({
  logout: mockLogout,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Import after mocks are in place
import { useAzureProfilePage } from './useAzureProfilePage';

const AUTH_LOGGED_IN = {
  isChecking: false,
  isLoggedIn: true,
  username: 'user@contoso.com',
  tenantId: 'tenant-abc',
  subscriptionId: 'sub-123',
};

const AUTH_CHECKING = {
  isChecking: true,
  isLoggedIn: false,
  username: undefined,
  tenantId: undefined,
  subscriptionId: undefined,
};

const AUTH_LOGGED_OUT = {
  isChecking: false,
  isLoggedIn: false,
  username: undefined,
  tenantId: undefined,
  subscriptionId: undefined,
};

describe('useAzureProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUseAzureAuth.mockReturnValue(AUTH_LOGGED_IN);
    mockLogout.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('exposes auth state fields from useAzureAuth', () => {
    const { result } = renderHook(() => useAzureProfilePage());
    expect(result.current.isChecking).toBe(false);
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.username).toBe('user@contoso.com');
    expect(result.current.tenantId).toBe('tenant-abc');
    expect(result.current.subscriptionId).toBe('sub-123');
  });

  test('redirects to /azure/login when not logged in and not checking', () => {
    mockUseAzureAuth.mockReturnValue(AUTH_LOGGED_OUT);
    renderHook(() => useAzureProfilePage());
    expect(mockPush).toHaveBeenCalledWith('/azure/login');
  });

  test('does not redirect while auth is still checking', () => {
    mockUseAzureAuth.mockReturnValue(AUTH_CHECKING);
    renderHook(() => useAzureProfilePage());
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('does not redirect when logged in', () => {
    renderHook(() => useAzureProfilePage());
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('handleBack navigates to /', () => {
    const { result } = renderHook(() => useAzureProfilePage());
    act(() => result.current.handleBack());
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  test('handleAddCluster navigates to /add-cluster-aks', () => {
    const { result } = renderHook(() => useAzureProfilePage());
    act(() => result.current.handleAddCluster());
    expect(mockPush).toHaveBeenCalledWith('/add-cluster-aks');
  });

  test('handleLogout dispatches azure-auth-update and redirects on success', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'azure-auth-update' })
    );
    // loggingOut stays true — component unmounts on redirect, no need to reset
    expect(result.current.loggingOut).toBe(true);

    act(() => vi.runAllTimers());
    expect(mockPush).toHaveBeenCalledWith('/azure/login');
  });

  test('redirect guard defers to timeout during active logout flow', async () => {
    const { result, rerender } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    // Auth state updates to logged-out before the timeout fires.
    mockUseAzureAuth.mockReturnValue(AUTH_LOGGED_OUT);
    rerender();

    // Guard does not redirect immediately — loggingOut suppresses it.
    expect(mockPush).not.toHaveBeenCalled();

    // The timeout handles the redirect instead.
    act(() => vi.runAllTimers());
    expect(mockPush).toHaveBeenCalledWith('/azure/login');
  });

  test('handleLogout sets loggingOut false when an error is thrown', async () => {
    mockLogout.mockRejectedValue(new Error('CLI not found'));

    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    expect(result.current.loggingOut).toBe(false);
  });

  test('clears redirect timer on unmount to prevent stray navigation', async () => {
    const { result, unmount } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    unmount();
    act(() => vi.runAllTimers());
    expect(mockPush).not.toHaveBeenCalledWith('/azure/login');
  });
});
