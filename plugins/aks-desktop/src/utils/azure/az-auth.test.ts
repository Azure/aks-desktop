// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOGIN_POLL_INTERVAL_MS } from '../constants/timing';

const mocks = vi.hoisted(() => ({
  isAzCliLoggedIn: vi.fn(),
  needsRelogin: vi.fn(),
  runCommandAsync: vi.fn(),
}));

vi.mock('./az-cli-core', () => ({
  debugLog: vi.fn(),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unknown error'),
  isAzCliLoggedIn: mocks.isAzCliLoggedIn,
  isAzError: (stderr: string) => stderr.includes('ERROR: '),
  isCliNotFoundError: (output: string) =>
    output.includes('command not found') || output.includes('Azure CLI (az) command not found'),
  needsRelogin: mocks.needsRelogin,
  runCommandAsync: mocks.runCommandAsync,
}));

vi.mock('./az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI.',
}));

import {
  getAccessToken,
  getLoginStatus,
  getUserAccountInfo,
  initiateLogin,
  login,
  monitorLoginStatus,
} from './az-auth';

describe('getLoginStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsRelogin.mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns Azure account details for valid output', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        id: 'subscription-id',
        tenantId: 'tenant-id',
        user: { name: 'user@example.com' },
      }),
      stderr: '',
    });

    await expect(getLoginStatus()).resolves.toEqual({
      isLoggedIn: true,
      subscriptionId: 'subscription-id',
      tenantId: 'tenant-id',
      username: 'user@example.com',
    });
  });

  test('does not trust account output when the command reports a fatal error', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        id: 'stale-subscription-id',
        tenantId: 'stale-tenant-id',
        user: { name: 'stale-user@example.com' },
      }),
      stderr: 'ERROR: The refresh token has expired.',
    });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'ERROR: The refresh token has expired.',
      isLoggedIn: false,
      needsRelogin: false,
    });
  });

  test('reports missing Azure CLI output', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'az: command not found',
    });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Azure CLI not found. Please install Azure CLI first.',
      isLoggedIn: false,
    });
  });

  test('reports when Azure CLI requires login again', async () => {
    mocks.needsRelogin.mockReturnValue(true);
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: 'Please run az login' });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Please run az login',
      isLoggedIn: false,
      needsRelogin: true,
    });
    expect(console.warn).toHaveBeenCalled();
  });

  test('uses a default message when account output is empty', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: '' });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Not logged in',
      isLoggedIn: false,
      needsRelogin: false,
    });
  });

  test('treats whitespace-only account output as logged out', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: ' \n', stderr: ' \n' });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Not logged in',
      isLoggedIn: false,
      needsRelogin: false,
    });
  });

  test.each(['{}', '[]', '"unexpected"'])('rejects an invalid account shape: %s', async stdout => {
    mocks.runCommandAsync.mockResolvedValue({ stdout, stderr: '' });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Failed to parse account information',
      isLoggedIn: false,
    });
  });

  test('reports malformed account output', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '{invalid', stderr: '' });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Failed to parse account information',
      isLoggedIn: false,
    });
  });

  test('reports command exceptions without exposing non-error values', async () => {
    mocks.runCommandAsync
      .mockRejectedValueOnce(new Error('bridge failed'))
      .mockRejectedValueOnce('private rejection');

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'bridge failed',
      isLoggedIn: false,
    });
    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Unknown error',
      isLoggedIn: false,
    });
  });
});

describe('Azure account data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsRelogin.mockReturnValue(false);
  });

  test('returns account and access-token JSON', async () => {
    mocks.runCommandAsync
      .mockResolvedValueOnce({ stdout: '{"id":"subscription-id"}', stderr: '' })
      .mockResolvedValueOnce({ stdout: '{"accessToken":"token"}', stderr: '' });

    await expect(getUserAccountInfo()).resolves.toEqual({ id: 'subscription-id' });
    await expect(getAccessToken()).resolves.toEqual({ accessToken: 'token' });
  });

  test.each([
    ['account information', getUserAccountInfo],
    ['access token', getAccessToken],
  ])('marks %s failures that require login again', async (_label, operation) => {
    mocks.needsRelogin.mockReturnValue(true);
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: 'Please run az login' });

    await expect(operation()).rejects.toMatchObject({
      message: 'Please run az login',
      needsRelogin: true,
    });
  });

  test.each([
    ['account information', getUserAccountInfo, 'Failed to get account info'],
    ['access token', getAccessToken, 'Failed to get access token'],
  ])('reports empty %s output clearly', async (_label, operation, expectedMessage) => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: ' \n', stderr: ' \n' });

    await expect(operation()).rejects.toThrow(expectedMessage);
  });

  test.each([
    ['account information', getUserAccountInfo, '{"id":"stale-subscription-id"}'],
    ['access token', getAccessToken, '{"accessToken":"stale-token"}'],
  ])('rejects fatal %s errors even when stdout is present', async (_label, operation, stdout) => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout,
      stderr: 'ERROR: The refresh token has expired.',
    });

    await expect(operation()).rejects.toThrow('ERROR: The refresh token has expired.');
  });
});

describe('initiateLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsRelogin.mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('accepts successful login output with warnings', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '[{"isDefault":true}]',
      stderr: 'WARNING: The login output has changed.',
    });

    await expect(initiateLogin()).resolves.toEqual({
      success: true,
      message: 'Login process initiated. Please complete authentication in your browser.',
    });
  });

  test('accepts usable login output with a tenant-specific error', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '[{"isDefault":true}]',
      stderr: "ERROR: Failed to authenticate tenant 'unavailable-tenant'.",
    });

    await expect(initiateLogin()).resolves.toMatchObject({ success: true });
  });

  test.each([
    'ERROR: The user canceled the authentication',
    'Command exited with code 1',
    'Command exited with code null',
    'Command execution error: bridge disconnected',
    'Failed to execute command: bridge not ready',
    'pluginRunCommand is not available.',
  ])('reports a command failure immediately: %s', async stderr => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr });

    await expect(initiateLogin()).resolves.toEqual({
      success: false,
      message: `Failed to initiate login: ${stderr}`,
    });
  });

  test('trims command failure output before displaying it', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: '  Command execution error: bridge disconnected\n',
    });

    await expect(initiateLogin()).resolves.toEqual({
      success: false,
      message: 'Failed to initiate login: Command execution error: bridge disconnected',
    });
  });

  test('does not treat whitespace stdout as a successful command', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: ' \n',
      stderr: 'Command exited with code 1',
    });

    await expect(initiateLogin()).resolves.toEqual({
      success: false,
      message: 'Failed to initiate login: Command exited with code 1',
    });
  });

  test('preserves Azure CLI installation guidance for ENOENT', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'Command execution error: spawn az ENOENT',
    });

    const result = await initiateLogin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Azure CLI not found.');
    expect(result.message).toContain('Install Azure CLI.');
  });

  test('preserves Azure CLI installation guidance for a thrown ENOENT error', async () => {
    mocks.runCommandAsync.mockRejectedValue(new Error('spawn az ENOENT'));

    const result = await initiateLogin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Azure CLI not found.');
    expect(result.message).toContain('Install Azure CLI.');
  });

  test('reports thrown login errors', async () => {
    mocks.runCommandAsync.mockRejectedValue(new Error('bridge failed'));

    await expect(initiateLogin()).resolves.toEqual({
      success: false,
      message: 'Failed to initiate login: bridge failed',
    });
  });
});

describe('monitorLoginStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsRelogin.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('reports a completed login', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '{"id":"subscription-id","tenantId":"tenant-id"}',
      stderr: '',
    });
    const onStatusChange = vi.fn();

    const stop = monitorLoginStatus(onStatusChange);

    await vi.waitFor(() =>
      expect(onStatusChange).toHaveBeenCalledWith({
        isLoggedIn: true,
        message: 'Login successful!',
      })
    );
    stop();
  });

  test('reports progress and eventually times out', async () => {
    vi.useFakeTimers();
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: 'Not logged in' });
    const onStatusChange = vi.fn();

    monitorLoginStatus(onStatusChange, 1);
    await vi.runAllTimersAsync();

    expect(onStatusChange).toHaveBeenCalledWith({
      isLoggedIn: false,
      message: 'Login timeout. Please try again.',
    });
    expect(mocks.runCommandAsync).toHaveBeenCalledTimes(60);
  });

  test('stops before scheduling another poll', async () => {
    vi.useFakeTimers();
    let resolveStatus!: (value: { stdout: string; stderr: string }) => void;
    const statusResult = new Promise<{ stdout: string; stderr: string }>(resolve => {
      resolveStatus = resolve;
    });
    mocks.runCommandAsync.mockReturnValue(statusResult);
    const onStatusChange = vi.fn();

    const stop = monitorLoginStatus(onStatusChange, 1);
    stop();
    resolveStatus({ stdout: '', stderr: 'Not logged in' });
    await statusResult;
    await vi.runAllTimersAsync();

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(mocks.runCommandAsync).toHaveBeenCalledTimes(1);
  });

  test('stops immediately when account status reports a command failure', async () => {
    vi.useFakeTimers();
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'Command execution error: bridge disconnected',
    });
    const onStatusChange = vi.fn();

    monitorLoginStatus(onStatusChange, 1);
    await vi.runAllTimersAsync();

    expect(onStatusChange).toHaveBeenCalledOnce();
    expect(onStatusChange).toHaveBeenCalledWith({
      isLoggedIn: false,
      message: 'Command execution error: bridge disconnected',
    });
    expect(mocks.runCommandAsync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('cancels a scheduled status check when monitoring stops', async () => {
    vi.useFakeTimers();
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: 'Not logged in' });
    const onStatusChange = vi.fn();

    const stop = monitorLoginStatus(onStatusChange, 1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatusChange).toHaveBeenCalledOnce();

    stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.runCommandAsync).toHaveBeenCalledOnce();
    expect(onStatusChange).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.needsRelogin.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns immediately for an existing Azure CLI session', async () => {
    mocks.isAzCliLoggedIn.mockResolvedValue(true);

    await expect(login()).resolves.toBe(true);
    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
  });

  test('returns false when login initiation fails', async () => {
    mocks.isAzCliLoggedIn.mockResolvedValue(false);
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'Command exited with code 1',
    });

    await expect(login()).resolves.toBe(false);
  });

  test('polls until Azure CLI reports a session', async () => {
    mocks.isAzCliLoggedIn
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.runCommandAsync.mockResolvedValue({ stdout: '[{"isDefault":true}]', stderr: '' });

    const result = login();
    await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);

    await expect(result).resolves.toBe(true);
  });

  test('returns false after the login timeout', async () => {
    mocks.isAzCliLoggedIn.mockResolvedValue(false);
    mocks.runCommandAsync.mockResolvedValue({ stdout: '[{"isDefault":true}]', stderr: '' });

    const result = login(1);
    await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);

    await expect(result).resolves.toBe(false);
  });

  test('returns false when an Azure CLI status check hangs past the timeout', async () => {
    mocks.isAzCliLoggedIn.mockReturnValue(new Promise(() => {}));

    const result = login(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(Promise.race([result, Promise.resolve('pending')])).resolves.toBe(false);
  });

  test('returns false when Azure CLI login initiation hangs past the timeout', async () => {
    mocks.isAzCliLoggedIn.mockResolvedValue(false);
    mocks.runCommandAsync.mockReturnValue(new Promise(() => {}));

    const result = login(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(Promise.race([result, Promise.resolve('pending')])).resolves.toBe(false);
  });

  test('returns false when the post-login status check hangs past the timeout', async () => {
    mocks.isAzCliLoggedIn.mockResolvedValueOnce(false).mockReturnValueOnce(new Promise(() => {}));
    mocks.runCommandAsync.mockResolvedValue({ stdout: '[{"isDefault":true}]', stderr: '' });

    const result = login(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(Promise.race([result, Promise.resolve('pending')])).resolves.toBe(false);
  });
});
