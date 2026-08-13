// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockPush = vi.hoisted(() => vi.fn());
const mockUseAzureAuth = vi.hoisted(() => vi.fn());
const mockRunCommandAsync = vi.hoisted(() => vi.fn());
const azureCliImportControl = vi.hoisted(() => {
  let resolveImport!: () => void;
  const importPromise = new Promise<void>(resolve => {
    resolveImport = resolve;
  });

  return { deferImport: false, importPromise, resolveImport };
});
const telemetryMocks = vi.hoisted(() => ({
  trackAksFeature: vi.fn(),
  trackError: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockPush }),
}));

vi.mock('../../../hooks/useAzureAuth', () => ({
  useAzureAuth: mockUseAzureAuth,
}));

// Covers the dynamic import inside handleLogout.
vi.mock('../../../utils/azure/az-cli-core', async () => {
  if (azureCliImportControl.deferImport) {
    await azureCliImportControl.importPromise;
  }

  return {
    runCommandAsync: mockRunCommandAsync,
    isAzError: (stderr: string) => stderr.includes('ERROR:'),
  };
});

vi.mock('../../../telemetry/aksFeature', () => ({
  trackAksFeature: telemetryMocks.trackAksFeature,
}));

vi.mock('../../../telemetry', () => ({
  trackError: telemetryMocks.trackError,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Import after mocks are in place
import { useAzureProfilePage } from './useAzureProfilePage';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

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

  test('unmount while loading logout command still executes it without later effects', async () => {
    const commandDeferred = createDeferred<{ stderr: string }>();
    azureCliImportControl.deferImport = true;
    mockRunCommandAsync.mockReturnValue(commandDeferred.promise);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result, unmount } = renderHook(() => useAzureProfilePage());
    let logoutPromise!: Promise<void>;

    act(() => {
      logoutPromise = result.current.handleLogout();
    });
    expect(result.current.loggingOut).toBe(true);
    expect(telemetryMocks.trackAksFeature.mock.calls).toEqual([['aksd.auth-logout', 'started']]);
    expect(mockRunCommandAsync).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      azureCliImportControl.resolveImport();
      await Promise.resolve();
    });

    expect(mockRunCommandAsync).toHaveBeenCalledWith('az', ['logout']);

    await act(async () => {
      commandDeferred.resolve({ stderr: '' });
      await logoutPromise;
    });

    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.runAllTimers());
    expect(telemetryMocks.trackAksFeature.mock.calls).toEqual([['aksd.auth-logout', 'started']]);
    expect(telemetryMocks.trackError).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  test('handleLogout dispatches azure-auth-update and redirects on success', async () => {
    mockRunCommandAsync.mockResolvedValue({ stderr: '' });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    expect(telemetryMocks.trackAksFeature).toHaveBeenNthCalledWith(
      1,
      'aksd.auth-logout',
      'started'
    );
    expect(telemetryMocks.trackAksFeature).toHaveBeenNthCalledWith(
      2,
      'aksd.auth-logout',
      'succeeded'
    );
    expect(telemetryMocks.trackError).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'azure-auth-update' })
    );
    // loggingOut stays true — component unmounts on redirect, no need to reset
    expect(result.current.loggingOut).toBe(true);

    act(() => vi.runAllTimers());
    expect(mockPush).toHaveBeenCalledWith('/azure/login');
  });

  test('redirect guard defers to timeout during active logout flow', async () => {
    mockRunCommandAsync.mockResolvedValue({ stderr: '' });

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

  test('handleLogout does not redirect when stderr contains ERROR:', async () => {
    mockRunCommandAsync.mockResolvedValue({ stderr: 'ERROR: sensitive logout result' });

    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    act(() => vi.runAllTimers());
    expect(mockPush).not.toHaveBeenCalled();
    expect(result.current.loggingOut).toBe(false);
    expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'failed');
    expect(telemetryMocks.trackError).toHaveBeenCalledWith({
      area: 'auth-logout',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(
      JSON.stringify([
        telemetryMocks.trackAksFeature.mock.calls,
        telemetryMocks.trackError.mock.calls,
      ])
    ).not.toContain('sensitive logout result');
  });

  test('handleLogout sets loggingOut false when an error is thrown', async () => {
    mockRunCommandAsync.mockRejectedValue(new Error('sensitive thrown logout error'));

    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    expect(result.current.loggingOut).toBe(false);
    expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'failed');
    expect(telemetryMocks.trackError).toHaveBeenCalledWith({
      area: 'auth-logout',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(
      JSON.stringify([
        telemetryMocks.trackAksFeature.mock.calls,
        telemetryMocks.trackError.mock.calls,
      ])
    ).not.toContain('sensitive thrown logout error');
  });

  test('emits started before invoking the logout command', async () => {
    mockRunCommandAsync.mockResolvedValue({ stderr: '' });

    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    const startedCall = telemetryMocks.trackAksFeature.mock.calls.findIndex(
      call => call[0] === 'aksd.auth-logout' && call[1] === 'started'
    );
    expect(telemetryMocks.trackAksFeature.mock.invocationCallOrder[startedCall]).toBeLessThan(
      mockRunCommandAsync.mock.invocationCallOrder[0]
    );
  });

  test('does not emit opened or cancelled events for logout', async () => {
    mockRunCommandAsync.mockResolvedValue({ stderr: '' });

    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    expect(telemetryMocks.trackAksFeature).not.toHaveBeenCalledWith('aksd.auth-logout', 'opened');
    expect(telemetryMocks.trackAksFeature).not.toHaveBeenCalledWith(
      'aksd.auth-logout',
      'cancelled'
    );
  });

  test('clears redirect timer on unmount to prevent stray navigation', async () => {
    mockRunCommandAsync.mockResolvedValue({ stderr: '' });

    const { result, unmount } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());

    unmount();
    act(() => vi.runAllTimers());
    expect(mockPush).not.toHaveBeenCalledWith('/azure/login');
  });

  test('unmount during logout command prevents all later effects', async () => {
    const commandDeferred = createDeferred<{ stderr: string }>();
    mockRunCommandAsync.mockReturnValue(commandDeferred.promise);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result, unmount } = renderHook(() => useAzureProfilePage());
    let logoutPromise!: Promise<void>;

    act(() => {
      logoutPromise = result.current.handleLogout();
    });
    await waitFor(() => expect(mockRunCommandAsync).toHaveBeenCalled());
    expect(telemetryMocks.trackAksFeature.mock.calls).toEqual([['aksd.auth-logout', 'started']]);

    unmount();
    await act(async () => {
      commandDeferred.resolve({ stderr: 'ERROR: sensitive logout result' });
      await logoutPromise;
    });

    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.runAllTimers());
    expect(telemetryMocks.trackAksFeature.mock.calls).toEqual([['aksd.auth-logout', 'started']]);
    expect(telemetryMocks.trackError).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
