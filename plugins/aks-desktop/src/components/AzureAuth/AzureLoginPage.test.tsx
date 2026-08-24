// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_RETRY_DELAY_MS,
  LOGIN_TIMEOUT_MS,
} from '../../utils/constants/timing';

const mocks = vi.hoisted(() => ({
  getLoginStatus: vi.fn(),
  initiateLogin: vi.fn(),
  push: vi.fn(),
  trackAksFeature: vi.fn(),
  trackError: vi.fn(),
  useTelemetryFeatureOpened: vi.fn(),
}));

vi.mock('@iconify/react', () => ({ Icon: () => null }));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values
        ? Object.entries(values).reduce(
            (message, [name, value]) => message.replace(`{{${name}}}`, value),
            key
          )
        : key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mocks.push }),
  useLocation: () => ({ search: '' }),
}));

vi.mock('../../utils/azure/az-auth', () => ({
  getLoginStatus: mocks.getLoginStatus,
  initiateLogin: mocks.initiateLogin,
}));

vi.mock('../../telemetry/aksFeature', () => ({
  trackAksFeature: mocks.trackAksFeature,
}));

vi.mock('../../telemetry', () => ({
  trackError: mocks.trackError,
}));

vi.mock('../../hooks/useTelemetryFeatureOpened', () => ({
  useTelemetryFeatureOpened: mocks.useTelemetryFeatureOpened,
}));

import AzureLoginPage from './AzureLoginPage';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function renderLoggedOutPage() {
  mocks.getLoginStatus.mockResolvedValueOnce({ isLoggedIn: false });
  const rendered = render(<AzureLoginPage />);
  await screen.findByRole('button', { name: 'Sign in with Azure' });
  return rendered;
}

describe('AzureLoginPage telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('records the login page opening through the shared hook', async () => {
    await renderLoggedOutPage();

    expect(mocks.useTelemetryFeatureOpened).toHaveBeenCalledWith('aksd.auth-login');
  });

  test('shows sign in when the initial status check hangs past the timeout', async () => {
    const statusDeferred = createDeferred<{ isLoggedIn: boolean }>();
    mocks.getLoginStatus.mockReturnValue(statusDeferred.promise);

    render(<AzureLoginPage />);
    expect(await screen.findByText('Checking authentication status...')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    });

    expect(screen.getByRole('button', { name: 'Sign in with Azure' })).toBeTruthy();

    await act(async () => {
      statusDeferred.resolve({ isLoggedIn: true });
      await statusDeferred.promise;
    });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test('emits started at the beginning of an explicit login attempt', async () => {
    mocks.initiateLogin.mockReturnValue(new Promise(() => {}));
    await renderLoggedOutPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));

    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'started');
    expect(screen.getByText('Initiating Azure login...')).toBeTruthy();
    expect(mocks.trackAksFeature.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.initiateLogin.mock.invocationCallOrder[0]
    );
  });

  test('starts only one login attempt on repeated clicks', async () => {
    mocks.initiateLogin.mockReturnValue(new Promise(() => {}));
    await renderLoggedOutPage();
    const signInButton = screen.getByRole('button', { name: 'Sign in with Azure' });

    await act(async () => {
      signInButton.click();
      signInButton.click();
    });

    expect(mocks.initiateLogin).toHaveBeenCalledTimes(1);
    expect(mocks.trackAksFeature).toHaveBeenCalledTimes(1);
  });

  test('ignores an unsuccessful initiation result after the attempt is cancelled', async () => {
    const deferred = createDeferred<{ success: boolean; message: string }>();
    mocks.initiateLogin.mockReturnValue(deferred.promise);
    await renderLoggedOutPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => {
      deferred.resolve({ success: false, message: 'late failure' });
      await deferred.promise;
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'cancelled'],
    ]);
    expect(mocks.trackError).not.toHaveBeenCalled();
  });

  test('does not start polling when successful initiation resolves after cancellation', async () => {
    const deferred = createDeferred<{ success: boolean; message: string }>();
    mocks.initiateLogin.mockReturnValue(deferred.promise);
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockResolvedValue({ isLoggedIn: false });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => {
      deferred.resolve({ success: true, message: 'late success' });
      await deferred.promise;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'cancelled'],
    ]);
    expect(mocks.trackError).not.toHaveBeenCalled();
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(1);
  });

  test('ignores an initiation rejection after the attempt is cancelled', async () => {
    const deferred = createDeferred<{ success: boolean; message: string }>();
    mocks.initiateLogin.mockReturnValue(deferred.promise);
    await renderLoggedOutPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => {
      deferred.reject(new Error('late rejection'));
      await deferred.promise.catch(() => {});
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'cancelled'],
    ]);
    expect(mocks.trackError).not.toHaveBeenCalled();
  });

  test('a stale cancelled attempt cannot interfere with a new login attempt', async () => {
    const firstAttempt = createDeferred<{ success: boolean; message: string }>();
    const secondAttempt = createDeferred<{ success: boolean; message: string }>();
    mocks.initiateLogin
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(secondAttempt.promise);
    await renderLoggedOutPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const signInButton = screen.getByRole('button', { name: 'Sign in with Azure' });
    expect((signInButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(signInButton);
    expect(mocks.initiateLogin).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstAttempt.resolve({ success: false, message: 'stale failure' });
      await firstAttempt.promise;
    });
    await waitFor(() => expect((signInButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(signInButton);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    mocks.getLoginStatus.mockResolvedValueOnce({ isLoggedIn: true });
    await act(async () => {
      secondAttempt.resolve({ success: true, message: 'current success' });
      await secondAttempt.promise;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'cancelled'],
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'succeeded'],
    ]);
    expect(mocks.trackError).not.toHaveBeenCalled();
  });

  test('offers retry only after the previous login command completes', async () => {
    const firstAttempt = createDeferred<{ success: boolean; message: string }>();
    const secondAttempt = createDeferred<{ success: boolean; message: string }>();
    mocks.initiateLogin
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(secondAttempt.promise);
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_RETRY_DELAY_MS);
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    mocks.getLoginStatus.mockResolvedValueOnce({ isLoggedIn: false, error: 'Not logged in' });
    await act(async () => {
      firstAttempt.resolve({ success: true, message: 'browser opened' });
      await firstAttempt.promise;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_RETRY_DELAY_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(mocks.initiateLogin).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'cancelled'],
      ['aksd.auth-login', 'started'],
    ]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test('keeps one timeout budget across login initiation and status checks', async () => {
    const firstAttempt = createDeferred<{ success: boolean; message: string }>();
    mocks.initiateLogin.mockReturnValue(firstAttempt.promise);
    await renderLoggedOutPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS - LOGIN_POLL_INTERVAL_MS);
    });

    mocks.getLoginStatus.mockResolvedValue({ isLoggedIn: false, error: 'Not logged in' });
    await act(async () => {
      firstAttempt.resolve({ success: true, message: 'browser opened' });
      await firstAttempt.promise;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });

    expect(await screen.findByText('Login timeout. Please try again.')).toBeTruthy();
    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'failed');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test('checks for login completion and redirects without waiting for the polling interval', async () => {
    const statusDeferred = createDeferred<{
      isLoggedIn: boolean;
      username: string;
      tenantId: string;
      subscriptionId: string;
    }>();
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockReturnValueOnce(statusDeferred.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    expect(await screen.findByText('Checking authentication status')).toBeTruthy();
    await act(async () => {
      statusDeferred.resolve({
        isLoggedIn: true,
        username: 'sensitive-user@contoso.com',
        tenantId: 'sensitive-tenant',
        subscriptionId: 'sensitive-subscription',
      });
      await statusDeferred.promise;
    });

    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'succeeded');
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.push).toHaveBeenCalledWith('/azure/profile');
    const successCall = mocks.trackAksFeature.mock.calls.findIndex(
      call => call[0] === 'aksd.auth-login' && call[1] === 'succeeded'
    );
    expect(mocks.trackAksFeature.mock.invocationCallOrder[successCall]).toBeLessThan(
      mocks.push.mock.invocationCallOrder[0]
    );
    expect(JSON.stringify(mocks.trackAksFeature.mock.calls)).not.toContain('sensitive-');
  });

  test('starts polling only when the immediate status check is logged out', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus
      .mockResolvedValueOnce({ isLoggedIn: false, error: 'Not logged in' })
      .mockResolvedValueOnce({ isLoggedIn: true });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {});

    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(2);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), LOGIN_POLL_INTERVAL_MS);
    expect(
      screen.getByText('Waiting for login completion... (5.0 minutes remaining)')
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(3);
    expect(mocks.push).toHaveBeenCalledWith('/azure/profile');
  });

  test('stops immediately when account status reports a command failure', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockResolvedValueOnce({
      isLoggedIn: false,
      error: 'Command execution error: bridge disconnected',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));

    expect(await screen.findByText('Command execution error: bridge disconnected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with Azure' })).toBeTruthy();
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(2);
    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'failed');
    expect(mocks.trackError).toHaveBeenCalledWith({
      area: 'auth-login',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('polls when account status still reflects the pre-login state', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus
      .mockResolvedValueOnce({
        isLoggedIn: false,
        needsRelogin: true,
        error: 'Please run "az login" to setup account.',
      })
      .mockResolvedValueOnce({ isLoggedIn: true });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));

    expect(
      await screen.findByText('Waiting for login completion... (5.0 minutes remaining)')
    ).toBeTruthy();
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(2);
    expect(mocks.push).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });

    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(3);
    expect(mocks.push).toHaveBeenCalledWith('/azure/profile');
  });

  test('waits for a slow status check before scheduling the next poll', async () => {
    const statusDeferred = createDeferred<{ isLoggedIn: boolean }>();
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus
      .mockResolvedValueOnce({ isLoggedIn: false })
      .mockReturnValueOnce(statusDeferred.promise)
      .mockResolvedValueOnce({ isLoggedIn: true });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS * 3);
    });
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(3);

    await act(async () => {
      statusDeferred.resolve({ isLoggedIn: false });
      await statusDeferred.promise;
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });

    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(4);
    expect(mocks.push).toHaveBeenCalledWith('/azure/profile');
  });

  test('does not emit cancelled after polling has already emitted succeeded', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockResolvedValueOnce({ isLoggedIn: true });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {});

    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'succeeded');
    expect(mocks.push).toHaveBeenCalledWith('/azure/profile');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.trackAksFeature).not.toHaveBeenCalledWith('aksd.auth-login', 'cancelled');
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  test('unmount during an in-flight poll prevents all later effects', async () => {
    const statusDeferred = createDeferred<{ isLoggedIn: boolean }>();
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    const { unmount } = await renderLoggedOutPage();
    mocks.getLoginStatus.mockReturnValueOnce(statusDeferred.promise);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      statusDeferred.resolve({ isLoggedIn: true });
      await statusDeferred.promise;
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([['aksd.auth-login', 'started']]);
    expect(mocks.trackError).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  test('unmount after success has no later effects', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    const { unmount } = await renderLoggedOutPage();
    mocks.getLoginStatus.mockResolvedValueOnce({ isLoggedIn: true });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {});
    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'succeeded'],
    ]);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/azure/profile');

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'succeeded'],
    ]);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  test('emits a privacy-safe failure when login initiation is unsuccessful', async () => {
    mocks.initiateLogin.mockResolvedValue({
      success: false,
      message: 'sensitive result message',
    });
    await renderLoggedOutPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));

    await screen.findByText('sensitive result message');
    expect(screen.queryByText('Initiating Azure login...')).toBeNull();
    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'failed');
    expect(mocks.trackError).toHaveBeenCalledWith({
      area: 'auth-login',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(
      JSON.stringify([mocks.trackAksFeature.mock.calls, mocks.trackError.mock.calls])
    ).not.toContain('sensitive result message');
  });

  test('emits a privacy-safe failure when login initiation throws', async () => {
    mocks.initiateLogin.mockRejectedValue(new Error('sensitive thrown exception'));
    await renderLoggedOutPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));

    await screen.findByText('Failed to initiate login: sensitive thrown exception');
    expect(screen.queryByText('Initiating Azure login...')).toBeNull();
    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'failed');
    expect(mocks.trackError).toHaveBeenCalledWith({
      area: 'auth-login',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(
      JSON.stringify([mocks.trackAksFeature.mock.calls, mocks.trackError.mock.calls])
    ).not.toContain('sensitive thrown exception');
  });

  test('times out when login initiation hangs', async () => {
    const deferred = createDeferred<{ success: boolean; message: string }>();
    mocks.initiateLogin.mockReturnValue(deferred.promise);
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    });

    expect(await screen.findByText('Login timeout. Please try again.')).toBeTruthy();
    expect(screen.queryByText('Initiating Azure login...')).toBeNull();
    const signInButton = screen.getByRole('button', { name: 'Sign in with Azure' });
    expect((signInButton as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'failed');
    expect(mocks.trackError).toHaveBeenCalledWith({
      area: 'auth-login',
      errorClass: 'TimeoutError',
      phase: 'failed',
    });

    await act(async () => {
      deferred.resolve({ success: true, message: 'late success' });
      await deferred.promise;
    });
    await waitFor(() => expect((signInButton as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.getLoginStatus).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test('times out when the immediate status check hangs', async () => {
    const statusDeferred = createDeferred<{ isLoggedIn: boolean }>();
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockReturnValueOnce(statusDeferred.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    expect(await screen.findByText('Checking authentication status')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    });

    expect(await screen.findByText('Login timeout. Please try again.')).toBeTruthy();
    expect(screen.queryByText('Checking authentication status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in with Azure' })).toBeTruthy();

    await act(async () => {
      statusDeferred.resolve({ isLoggedIn: true });
      await statusDeferred.promise;
    });
    expect(mocks.trackAksFeature).not.toHaveBeenCalledWith('aksd.auth-login', 'succeeded');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test('ignores a successful status check that completes after cancellation', async () => {
    const statusDeferred = createDeferred<{ isLoggedIn: boolean }>();
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockReturnValueOnce(statusDeferred.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await act(async () => {
      statusDeferred.resolve({ isLoggedIn: true });
      await statusDeferred.promise;
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'cancelled'],
    ]);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(2);
  });

  test('emits failed and TimeoutError when polling times out', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus.mockResolvedValue({ isLoggedIn: false });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    });

    expect(await screen.findByText('Login timeout. Please try again.')).toBeTruthy();
    expect(screen.queryByText(/Waiting for login completion/)).toBeNull();
    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'failed');
    expect(mocks.trackError).toHaveBeenCalledWith({
      area: 'auth-login',
      errorClass: 'TimeoutError',
      phase: 'failed',
    });
  });

  test('does not emit terminal telemetry for the passive initial status check', async () => {
    mocks.getLoginStatus.mockResolvedValueOnce({
      isLoggedIn: true,
      username: 'sensitive-user@contoso.com',
    });

    render(<AzureLoginPage redirectTo="/clusters" />);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/clusters'));

    expect(mocks.trackAksFeature).not.toHaveBeenCalled();
    expect(mocks.trackError).not.toHaveBeenCalled();
  });

  test('does not emit terminal telemetry for a transient polling error', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    mocks.getLoginStatus
      .mockRejectedValueOnce(new Error('transient sensitive error'))
      .mockResolvedValueOnce({ isLoggedIn: true });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.auth-login', 'started'],
      ['aksd.auth-login', 'succeeded'],
    ]);
    expect(mocks.trackError).not.toHaveBeenCalled();
    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(3);
    expect(mocks.push).toHaveBeenCalledWith('/azure/profile');
  });

  test('emits cancelled only when cancelling an active login attempt', async () => {
    mocks.initiateLogin.mockResolvedValue({ success: true, message: 'browser opened' });
    await renderLoggedOutPage();
    expect(mocks.trackAksFeature).not.toHaveBeenCalledWith('aksd.auth-login', 'cancelled');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Azure' }));
    await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'cancelled');
    expect(screen.getByRole('button', { name: 'Sign in with Azure' })).toBeTruthy();
  });
});
