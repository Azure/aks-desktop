// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOGIN_POLL_INTERVAL_MS } from '../constants/timing';

const mocks = vi.hoisted(() => ({
  isAzCliLoggedIn: vi.fn(),
  getNativeAccount: vi.fn(),
  getNativeLoginError: vi.fn(),
  hasNativeSession: vi.fn(),
  initiateNativeLogin: vi.fn(),
  isAzureExplicitlySignedOut: vi.fn(),
  needsRelogin: vi.fn(),
  runCommandAsync: vi.fn(),
  synchronizeNativeLogin: vi.fn(),
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

vi.mock('./az-token', () => ({
  AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT: 'azure-subscription-tenant-change',
}));

vi.mock('./native-auth', () => ({
  getNativeAccount: mocks.getNativeAccount,
  getNativeLoginError: mocks.getNativeLoginError,
  hasNativeSession: mocks.hasNativeSession,
  initiateNativeLogin: mocks.initiateNativeLogin,
  isAzureExplicitlySignedOut: mocks.isAzureExplicitlySignedOut,
  synchronizeNativeLogin: mocks.synchronizeNativeLogin,
}));

import {
  getCliLoginStatus,
  getLoginStatus,
  getNativeLoginStatus,
  getSubscriptionLoginStatus,
  initiateCliLogin,
  initiateLogin,
  login,
  monitorLoginStatus,
} from './az-auth';

beforeEach(() => {
  mocks.getNativeAccount.mockReturnValue(undefined);
  mocks.getNativeLoginError.mockReturnValue(undefined);
  mocks.hasNativeSession.mockReturnValue(false);
  mocks.isAzureExplicitlySignedOut.mockReturnValue(false);
  mocks.synchronizeNativeLogin.mockResolvedValue(undefined);
  mocks.initiateNativeLogin.mockResolvedValue({
    message: 'Enter code ABCD-EFGH',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://microsoft.com/devicelogin',
  });
});

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

  test.each(['cloudName', 'environmentName'])('retains the account cloud from %s', async field => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        id: 'subscription-id',
        tenantId: 'tenant-id',
        [field]: 'AzureUSGovernment',
      }),
      stderr: '',
    });
    expect(await getLoginStatus()).toMatchObject({ environmentName: 'AzureUSGovernment' });
  });

  test('invalidates external identity changes without recursively emitting login events', async () => {
    const changed = vi.fn();
    const loginEvent = vi.fn();
    window.addEventListener('azure-account-change', changed);
    window.addEventListener('azure-auth-update', loginEvent);
    let account = {
      id: 'subscription-a',
      tenantId: 'tenant-a',
      cloudName: 'AzureCloud',
      user: { name: 'first@example.com' },
    };
    mocks.runCommandAsync.mockImplementation(async () => ({
      stdout: JSON.stringify(account),
      stderr: '',
    }));
    try {
      await getLoginStatus();
      changed.mockClear();
      await getLoginStatus();
      expect(changed).not.toHaveBeenCalled();
      for (const update of [
        { user: { name: 'second@example.com' } },
        { tenantId: 'tenant-b' },
        { id: 'subscription-b' },
        { cloudName: 'AzureChinaCloud' },
      ]) {
        account = { ...account, ...update };
        await getLoginStatus();
      }
      expect(changed).toHaveBeenCalledTimes(4);
      mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: '' });
      await getLoginStatus();
      expect(changed).toHaveBeenCalledTimes(5);
      await getLoginStatus();
      expect(changed).toHaveBeenCalledTimes(5);
      expect(loginEvent).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('azure-account-change', changed);
      window.removeEventListener('azure-auth-update', loginEvent);
    }
  });

  test('reports missing Azure CLI output', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '',
      stderr: 'az: command not found',
    });

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Azure CLI could not be started.\n\nInstall Azure CLI.',
      isLoggedIn: false,
    });
  });

  test('reports a native authentication failure without invoking Azure CLI', async () => {
    mocks.hasNativeSession.mockReturnValue(true);
    mocks.getNativeLoginError.mockReturnValue('Device authorization was declined');

    await expect(getLoginStatus()).resolves.toEqual({
      error: 'Device authorization was declined',
      isLoggedIn: false,
      needsRelogin: false,
    });

    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
  });

  test('does not silently reuse the CLI account after explicit sign-out', async () => {
    mocks.isAzureExplicitlySignedOut.mockReturnValue(true);
    await expect(getLoginStatus()).resolves.toEqual({
      isLoggedIn: false,
      error: 'Not logged in',
    });
    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
  });

  test('does not publish an in-flight CLI account read after sign-out', async () => {
    let resolve!: (value: { stdout: string; stderr: string }) => void;
    mocks.runCommandAsync.mockReturnValue(new Promise(r => (resolve = r)));
    const pending = getLoginStatus();
    mocks.isAzureExplicitlySignedOut.mockReturnValue(true);
    resolve({ stdout: '{"id":"cli","tenantId":"tenant"}', stderr: '' });
    await expect(pending).resolves.toEqual({ isLoggedIn: false, error: 'Not logged in' });
  });

  test('reads a requested CLI subscription without changing the active account', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        id: '00000000-0000-0000-0000-000000000003',
        tenantId: '00000000-0000-0000-0000-000000000006',
        user: { name: 'user@example.com' },
      }),
      stderr: '',
    });

    await expect(
      getSubscriptionLoginStatus('00000000-0000-0000-0000-000000000003')
    ).resolves.toEqual({
      isLoggedIn: true,
      subscriptionId: '00000000-0000-0000-0000-000000000003',
      tenantId: '00000000-0000-0000-0000-000000000006',
      username: 'user@example.com',
    });
    expect(mocks.runCommandAsync).toHaveBeenCalledWith('az', [
      'account',
      'show',
      '--subscription',
      '00000000-0000-0000-0000-000000000003',
      '-o',
      'json',
    ]);
  });

  test('returns the newest observation for overlapping reads of the same subscription', async () => {
    let releaseOlder!: (value: { stdout: string; stderr: string }) => void;
    const subscription = '00000000-0000-0000-0000-000000000003';
    mocks.runCommandAsync
      .mockReturnValueOnce(new Promise(resolve => (releaseOlder = resolve)))
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: subscription,
          tenantId: 'new-tenant',
          user: { name: 'new-user@example.test' },
        }),
        stderr: '',
      });
    const older = getSubscriptionLoginStatus(subscription);
    const newer = await getSubscriptionLoginStatus(subscription);
    releaseOlder({
      stdout: JSON.stringify({
        id: subscription,
        tenantId: 'old-tenant',
        user: { name: 'old-user@example.test' },
      }),
      stderr: '',
    });
    await expect(older).resolves.toEqual(newer);
  });

  test('notifies tenant-bound consumers only when an established CLI tenant changes', async () => {
    const subscription = '00000000-0000-0000-0000-000000000099';
    const changed = vi.fn();
    window.addEventListener('azure-subscription-tenant-change', changed);
    const account = {
      id: subscription,
      tenantId: 'tenant-a',
      user: { name: 'user@example.test' },
    };
    mocks.runCommandAsync.mockImplementation(async () => ({
      stdout: JSON.stringify(account),
      stderr: '',
    }));
    try {
      await getSubscriptionLoginStatus(subscription);
      await getSubscriptionLoginStatus(subscription.toUpperCase());
      expect(changed).not.toHaveBeenCalled();
      account.tenantId = 'tenant-b';
      await getSubscriptionLoginStatus(subscription);
      expect(changed).toHaveBeenCalledOnce();
      expect(changed.mock.calls[0][0].detail).toEqual({ subscriptionIds: [subscription] });
      await getSubscriptionLoginStatus(subscription);
      expect(changed).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('azure-subscription-tenant-change', changed);
    }
  });

  test.each([
    {
      stdout: JSON.stringify({
        id: 'new-subscription',
        tenantId: 'new-tenant',
        cloudName: 'AzureUSGovernment',
        user: { name: 'new-user@example.com' },
      }),
      stderr: '',
    },
    { stdout: '', stderr: 'ERROR: Please run az login' },
  ])('does not publish an older account read after a newer observation: %j', async latest => {
    let release!: (value: { stdout: string; stderr: string }) => void;
    mocks.runCommandAsync
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve;
          })
      )
      .mockResolvedValue(latest);
    const changed = vi.fn();
    window.addEventListener('azure-account-change', changed);
    try {
      const older = getLoginStatus();
      const newer = await getLoginStatus();
      changed.mockClear();
      release({
        stdout: JSON.stringify({
          id: 'old-subscription',
          tenantId: 'old-tenant',
          cloudName: 'AzureCloud',
          user: { name: 'old-user@example.com' },
        }),
        stderr: '',
      });
      await expect(older).resolves.toEqual(newer);
      expect(changed).not.toHaveBeenCalled();
      await expect(getLoginStatus()).resolves.toEqual(newer);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('azure-account-change', changed);
    }
  });

  test('an older account read waits for the newer observation before publishing', async () => {
    const releases: ((value: { stdout: string; stderr: string }) => void)[] = [];
    mocks.runCommandAsync.mockImplementation(
      () =>
        new Promise(resolve => {
          releases.push(resolve);
        })
    );
    const changed = vi.fn();
    const settled = vi.fn();
    window.addEventListener('azure-account-change', changed);
    try {
      const older = getLoginStatus().then(settled);
      const newer = getLoginStatus();
      releases[0]({
        stdout: JSON.stringify({ id: 'pending-old-subscription', tenantId: 'pending-old-tenant' }),
        stderr: '',
      });
      await vi.waitFor(() => {
        expect(mocks.runCommandAsync).toHaveBeenCalledTimes(2);
      });
      expect(settled).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      releases[1]({
        stdout: JSON.stringify({ id: 'pending-new-subscription', tenantId: 'pending-new-tenant' }),
        stderr: '',
      });
      const status = await newer;
      await older;
      expect(settled).toHaveBeenCalledWith(status);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('azure-account-change', changed);
    }
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

describe('initiateLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsRelogin.mockReturnValue(false);
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '{"name":"AzureCloud"}',
      stderr: '',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('starts native authentication in the selected CLI cloud', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '{"name":"AzureUSGovernment"}',
      stderr: '',
    });
    await expect(initiateLogin()).resolves.toEqual({
      success: true,
      message: 'Enter code ABCD-EFGH',
      userCode: 'ABCD-EFGH',
    });
    expect(mocks.initiateNativeLogin).toHaveBeenCalledWith(undefined, 'AzureUSGovernment');
    expect(mocks.runCommandAsync).toHaveBeenCalledWith('az', ['cloud', 'show', '--output', 'json']);
  });

  test('uses public cloud when CLI is unavailable', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: 'az: command not found' });
    expect(await initiateLogin()).toMatchObject({ success: true });
    expect(mocks.initiateNativeLogin).toHaveBeenCalledWith(undefined, 'AzureCloud');
  });

  test('uses an explicitly selected native cloud without querying the CLI', async () => {
    expect(await initiateLogin(undefined, 'AzureChinaCloud')).toMatchObject({ success: true });
    expect(mocks.runCommandAsync).not.toHaveBeenCalled();
    expect(mocks.initiateNativeLogin).toHaveBeenCalledWith(undefined, 'AzureChinaCloud');
  });

  test('does not silently select public cloud when CLI cloud cannot be read', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '', stderr: 'ERROR: invalid configuration' });
    expect(await initiateLogin()).toMatchObject({ success: false });
    expect(mocks.initiateNativeLogin).not.toHaveBeenCalled();
  });

  test('does not start native login after cancellation during cloud discovery', async () => {
    const controller = new AbortController();
    mocks.runCommandAsync.mockReturnValue(new Promise(() => {}));
    const attempt = initiateLogin(controller.signal);
    controller.abort();
    expect(await attempt).toMatchObject({ success: false });
    expect(mocks.initiateNativeLogin).not.toHaveBeenCalled();
  });

  describe('complementary CLI login', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test('runs browser login in the selected cloud and verifies the CLI account', async () => {
      mocks.getNativeAccount.mockReturnValue({
        tenantId: 'tenant',
        subscriptionId: 'native',
        username: 'USER@example.com',
        environmentName: 'AzureUSGovernment',
      });
      mocks.runCommandAsync
        .mockResolvedValueOnce({ stdout: '[{"id":"cli"}]', stderr: '' })
        .mockResolvedValueOnce({
          stdout:
            '{"id":"native","tenantId":"tenant","cloudName":"AzureUSGovernment","user":{"name":"user@example.com"}}',
          stderr: '',
        });
      expect(await initiateCliLogin()).toEqual({
        success: true,
        message: 'Azure CLI sign-in successful.',
      });
      expect(mocks.runCommandAsync).toHaveBeenNthCalledWith(1, 'az', ['login', '--output', 'json']);
      expect(mocks.runCommandAsync).toHaveBeenNthCalledWith(2, 'az', [
        'account',
        'show',
        '--subscription',
        'native',
        '-o',
        'json',
      ]);
    });

    test.each([
      { stdout: '', stderr: 'ERROR: authentication failed' },
      { stdout: '', stderr: 'az: command not found' },
      { stdout: '[]', stderr: '' },
      { stdout: '', stderr: '' },
    ])('reports CLI login failures: %j', async output => {
      mocks.runCommandAsync.mockResolvedValue(output);
      expect((await initiateCliLogin()).success).toBe(false);
      expect(mocks.runCommandAsync).toHaveBeenCalledOnce();
    });

    test('does not report success when the CLI account lookup fails', async () => {
      mocks.runCommandAsync
        .mockResolvedValueOnce({ stdout: '[{"id":"cli"}]', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: 'ERROR: Please run az login' });
      expect(await initiateCliLogin()).toMatchObject({ success: false });
    });

    test.each([
      { username: 'other@example.com', tenantId: 'tenant', cloudName: 'AzureCloud' },
      { username: 'user@example.com', tenantId: 'other', cloudName: 'AzureCloud' },
      { username: 'user@example.com', tenantId: 'tenant', cloudName: 'AzureChinaCloud' },
      { username: undefined, tenantId: 'tenant', cloudName: 'AzureCloud' },
    ])('rejects a mismatched or unverifiable CLI identity: %j', async account => {
      mocks.getNativeAccount.mockReturnValue({
        tenantId: 'tenant',
        subscriptionId: 'native',
        username: 'user@example.com',
        environmentName: 'AzureCloud',
      });
      mocks.runCommandAsync
        .mockResolvedValueOnce({ stdout: '[{"id":"cli"}]', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            id: 'native',
            tenantId: account.tenantId,
            cloudName: account.cloudName,
            user: { name: account.username },
          }),
          stderr: '',
        });
      expect(await initiateCliLogin()).toMatchObject({ success: false });
    });

    test('shares an in-flight CLI login across callers', async () => {
      let resolve!: (value: { stdout: string; stderr: string }) => void;
      mocks.runCommandAsync.mockReturnValueOnce(new Promise(r => (resolve = r)));
      const first = initiateCliLogin();
      const second = initiateCliLogin();
      expect(mocks.runCommandAsync).toHaveBeenCalledOnce();
      resolve({ stdout: '', stderr: 'ERROR: cancelled' });
      expect(await first).toEqual(await second);
    });

    test('keeps native status distinct from a CLI account', async () => {
      mocks.getNativeAccount.mockReturnValue(undefined);
      mocks.getNativeLoginError.mockReturnValue(undefined);
      mocks.runCommandAsync.mockResolvedValue({
        stdout: '{"id":"cli","tenantId":"tenant"}',
        stderr: '',
      });
      expect((await getNativeLoginStatus()).isLoggedIn).toBe(false);
      expect((await getCliLoginStatus()).isLoggedIn).toBe(true);
    });
  });

  test('reports thrown login errors', async () => {
    mocks.initiateNativeLogin.mockRejectedValue(new Error('identity service failed'));

    await expect(initiateLogin()).resolves.toEqual({
      success: false,
      message: 'Failed to initiate login: identity service failed',
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

  test('returns immediately for an existing session', async () => {
    mocks.getNativeAccount.mockReturnValue({
      tenantId: 'tenant-id',
      subscriptionId: 'subscription-id',
      environmentName: 'AzureCloud',
    });

    await expect(login()).resolves.toBe(true);
    expect(mocks.initiateNativeLogin).not.toHaveBeenCalled();
  });

  test('does not treat an existing CLI account as a native login', async () => {
    mocks.getNativeAccount.mockReturnValue(undefined);
    mocks.runCommandAsync.mockResolvedValue({
      stdout: '{"name":"AzureCloud"}',
      stderr: '',
    });
    mocks.initiateNativeLogin.mockRejectedValue(new Error('login failed'));

    await expect(login()).resolves.toBe(false);
    expect(mocks.initiateNativeLogin).toHaveBeenCalledOnce();
    expect(mocks.runCommandAsync).toHaveBeenCalledWith('az', ['cloud', 'show', '--output', 'json']);
  });

  test('returns false when login initiation fails', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '{"name":"AzureCloud"}', stderr: '' });
    mocks.initiateNativeLogin.mockRejectedValue(new Error('login failed'));

    await expect(login()).resolves.toBe(false);
  });

  test('polls until native authentication reports a session', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '{"name":"AzureCloud"}', stderr: '' });
    mocks.getNativeAccount
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValue({
        tenantId: 'tenant-id',
        subscriptionId: 'subscription-id',
        environmentName: 'AzureCloud',
      });
    mocks.hasNativeSession.mockReturnValueOnce(false).mockReturnValue(true);

    const result = login();
    await vi.advanceTimersByTimeAsync(LOGIN_POLL_INTERVAL_MS);

    await expect(result).resolves.toBe(true);
  });

  test('returns false after the login timeout', async () => {
    mocks.runCommandAsync.mockResolvedValue({ stdout: '{"name":"AzureCloud"}', stderr: '' });
    mocks.hasNativeSession.mockReturnValueOnce(false).mockReturnValue(true);

    const result = login(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe(false);
  });
});
