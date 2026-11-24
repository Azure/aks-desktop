// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockPush = vi.hoisted(() => vi.fn());
const mockUseAzureAuth = vi.hoisted(() => vi.fn());
const mockRunCommandAsync = vi.hoisted(() => vi.fn());
const nativeAuthMocks = vi.hoisted(() => ({
  hasNativeSession: vi.fn(),
  logoutNative: vi.fn(),
}));
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
    isCliNotFoundError: (stderr: string) => stderr.includes('az: command not found'),
  };
});
vi.mock('../../../utils/azure/native-auth', () => nativeAuthMocks);

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
    nativeAuthMocks.hasNativeSession.mockReturnValue(false);
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
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'azure-auth-update' })
    );
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
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

  test('logs out both native and CLI sessions', async () => {
    nativeAuthMocks.hasNativeSession.mockReturnValue(true);
    mockRunCommandAsync.mockResolvedValue({ stderr: '' });
    const { result } = renderHook(() => useAzureProfilePage());

    await act(() => result.current.handleLogout());

    expect(nativeAuthMocks.logoutNative).toHaveBeenCalledOnce();
    expect(mockRunCommandAsync).toHaveBeenCalledWith('az', ['logout']);
    expect(nativeAuthMocks.logoutNative.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunCommandAsync.mock.invocationCallOrder[0]
    );
    expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'succeeded');
  });

  test('publishes native sign-out before pending CLI logout finishes', async () => {
    const command = createDeferred<{ stderr: string }>();
    nativeAuthMocks.logoutNative.mockResolvedValueOnce(true);
    mockRunCommandAsync.mockReturnValue(command.promise);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result } = renderHook(() => useAzureProfilePage());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.handleLogout();
    });
    await vi.waitFor(() => expect(mockRunCommandAsync).toHaveBeenCalled());
    const earlyNotifications = dispatchSpy.mock.calls.filter(
      ([event]) => event.type === 'azure-auth-update'
    ).length;
    await act(async () => {
      command.resolve({ stderr: 'ERROR: CLI sign-out failed' });
      await pending;
    });
    expect(earlyNotifications).toBe(1);
    expect(
      dispatchSpy.mock.calls.filter(([event]) => event.type === 'azure-auth-update')
    ).toHaveLength(1);
  });

  test('does not recommend manual CLI logout when native cleanup fails', async () => {
    nativeAuthMocks.logoutNative.mockRejectedValueOnce(new Error('native cleanup failed'));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());
    expect(result.current.logoutError).toContain('Native Azure sign-out could not be completed');
    expect(result.current.logoutError).not.toContain('az logout');
    expect(mockRunCommandAsync).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  test.each(['az: command not found', 'ERROR: There are no active accounts.'])(
    'reports an unavailable CLI while completing native-only sign-out: %s',
    async stderr => {
      mockRunCommandAsync.mockResolvedValue({ stderr });
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const { result } = renderHook(() => useAzureProfilePage());

      await act(() => result.current.handleLogout());

      expect(nativeAuthMocks.logoutNative).toHaveBeenCalledOnce();
      expect(mockRunCommandAsync).toHaveBeenCalledWith('az', ['logout']);
      expect(result.current.logoutNotice).toContain('not available');
      expect(result.current.logoutError).toBe('');
      expect(result.current.loggingOut).toBe(true);
      expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'succeeded');
      expect(telemetryMocks.trackError).not.toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'azure-auth-update' })
      );
      expect(mockPush).not.toHaveBeenCalled();
      act(() => vi.runAllTimers());
      expect(mockPush).toHaveBeenCalledWith('/azure/login');
    }
  );

  test.each([
    '  pluginRunCommand is not available.\n',
    'Command execution error: bridge disconnected',
    'pluginRunCommand is not available.\nERROR: sign-out failed',
    'Command execution error: pluginRunCommand is not available.',
    'Command exited with code 1',
  ])('does not treat other CLI errors as unavailable: %s', async stderr => {
    mockRunCommandAsync.mockResolvedValue({ stderr });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result } = renderHook(() => useAzureProfilePage());

    await act(() => result.current.handleLogout());

    expect(nativeAuthMocks.logoutNative).toHaveBeenCalledOnce();
    expect(result.current.logoutNotice).toBe('');
    expect(result.current.logoutError).toContain('Azure CLI sign-out failed');
    expect(result.current.loggingOut).toBe(false);
    expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'failed');
    expect(telemetryMocks.trackAksFeature).not.toHaveBeenCalledWith(
      'aksd.auth-logout',
      'succeeded'
    );
    expect(telemetryMocks.trackError).toHaveBeenCalledOnce();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'azure-auth-update' })
    );
    act(() => vi.runAllTimers());
    expect(mockPush).not.toHaveBeenCalled();
  });

  test.each(['', 'az: command not found'])(
    'keeps the reload-risk warning visible when sign-out policy cannot be saved: %s',
    async stderr => {
      nativeAuthMocks.logoutNative.mockReturnValueOnce(false);
      mockRunCommandAsync.mockResolvedValue({ stderr });
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const { result, rerender } = renderHook(() => useAzureProfilePage());

      await act(() => result.current.handleLogout());
      mockUseAzureAuth.mockReturnValue(AUTH_LOGGED_OUT);
      rerender();

      expect(mockRunCommandAsync).toHaveBeenCalledWith('az', ['logout']);
      expect(result.current.logoutError).toContain('could not be saved');
      expect(result.current.logoutError).toContain('may be reused after the app reloads');
      if (stderr) expect(result.current.logoutError).toContain('Azure CLI was not available');
      expect(result.current.logoutNotice).toBe('');
      expect(result.current.loggingOut).toBe(false);
      expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'failed');
      expect(telemetryMocks.trackAksFeature).not.toHaveBeenCalledWith(
        'aksd.auth-logout',
        'succeeded'
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'azure-auth-update' })
      );
      act(() => vi.runAllTimers());
      expect(mockPush).not.toHaveBeenCalled();
    }
  );

  test.each([false, true])(
    'preserves the policy warning when CLI sign-out fails (throws: %s)',
    async throws => {
      nativeAuthMocks.logoutNative.mockReturnValueOnce(false);
      if (throws) {
        mockRunCommandAsync.mockRejectedValue(new Error('bridge disconnected'));
      } else {
        mockRunCommandAsync.mockResolvedValue({ stderr: 'Command execution error: disconnected' });
      }
      const { result } = renderHook(() => useAzureProfilePage());

      await act(() => result.current.handleLogout());

      expect(result.current.logoutError).toContain('Azure CLI sign-out failed');
      expect(result.current.logoutError).toContain('could not be saved');
      expect(result.current.loggingOut).toBe(false);
      expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'failed');
      act(() => vi.runAllTimers());
      expect(mockPush).not.toHaveBeenCalled();
    }
  );

  test('allows retry after sign-out policy persistence fails', async () => {
    nativeAuthMocks.logoutNative.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockRunCommandAsync.mockResolvedValue({ stderr: '' });
    const { result } = renderHook(() => useAzureProfilePage());

    await act(() => result.current.handleLogout());
    expect(result.current.logoutError).toContain('could not be saved');

    await act(() => result.current.handleLogout());
    expect(result.current.logoutError).toBe('');
    expect(result.current.loggingOut).toBe(true);
    expect(telemetryMocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-logout', 'succeeded');
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
    expect(result.current.logoutError).toContain('Azure CLI sign-out failed');
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

  test('keeps the logout failure visible when native auth becomes signed out', async () => {
    mockRunCommandAsync.mockResolvedValue({
      stderr: 'Command execution error: bridge disconnected',
    });
    const { result, rerender } = renderHook(() => useAzureProfilePage());
    await act(() => result.current.handleLogout());
    mockUseAzureAuth.mockReturnValue(AUTH_LOGGED_OUT);
    rerender();
    expect(result.current.logoutError).toContain('Azure CLI sign-out failed');
    expect(mockPush).not.toHaveBeenCalled();
    expect(nativeAuthMocks.logoutNative).toHaveBeenCalledOnce();
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
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
