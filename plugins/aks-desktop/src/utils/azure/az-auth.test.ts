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
  isValidGuid: (value: string) => /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value),
  needsRelogin: mocks.needsRelogin,
  runCommandAsync: mocks.runCommandAsync,
}));

vi.mock('./az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI.',
}));

import { getLoginStatus, initiateLogin, login, monitorLoginStatus } from './az-auth';
import { ARM_SCOPE, getSubscriptionCredential } from './az-token';

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
    expect(mocks.runCommandAsync).toHaveBeenCalledWith('az', ['account', 'show', '-o', 'json']);
  });

  test.each(['cloudName', 'environmentName'])(
    'retains the selected account cloud from %s',
    async field => {
      mocks.runCommandAsync.mockResolvedValue({
        stdout: JSON.stringify({
          id: 'other-subscription',
          tenantId: 'other-tenant',
          [field]: 'AzureUSGovernment',
        }),
        stderr: '',
      });
      await expect(getLoginStatus('other-subscription')).resolves.toMatchObject({
        environmentName: 'AzureUSGovernment',
      });
    }
  );

  test('reads the selected subscription account without changing the default account', async () => {
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({ id: 'other-subscription', tenantId: 'other-tenant' }),
      stderr: '',
    });

    await expect(getLoginStatus('other-subscription')).resolves.toMatchObject({
      isLoggedIn: true,
      subscriptionId: 'other-subscription',
      tenantId: 'other-tenant',
    });
    expect(mocks.runCommandAsync).toHaveBeenCalledExactlyOnceWith('az', [
      'account',
      'show',
      '-o',
      'json',
      '--subscription',
      'other-subscription',
    ]);
  });

  test('selected subscription reads do not replace the observed default account', async () => {
    const changed = vi.fn();
    window.addEventListener('azure-account-change', changed);
    const current = {
      stdout: JSON.stringify({
        id: 'default-subscription',
        tenantId: 'default-tenant',
        user: { name: 'default@example.com' },
      }),
      stderr: '',
    };
    try {
      mocks.runCommandAsync.mockResolvedValue(current);
      await getLoginStatus();
      changed.mockClear();
      mocks.runCommandAsync.mockResolvedValueOnce({
        stdout: JSON.stringify({ id: 'other-subscription', tenantId: 'other-tenant' }),
        stderr: '',
      });
      await getLoginStatus('other-subscription');
      await getLoginStatus();
      expect(changed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('azure-account-change', changed);
    }
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

  test('invalidates only the selected subscription on scoped identity changes and stays in sync with default account switches', async () => {
    const accountChanged = vi.fn();
    const subChanged = vi.fn((e: Event) => (e as CustomEvent<{ subscriptionId: string }>).detail);
    window.addEventListener('azure-account-change', accountChanged);
    window.addEventListener('azure-subscription-account-change', subChanged);
    try {
      mocks.runCommandAsync
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            id: 'default-sub',
            tenantId: 'tenant-a',
            cloudName: 'AzureCloud',
            user: { name: 'user-a@example.com' },
          }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            id: 'sub-other',
            tenantId: 'tenant-a',
            cloudName: 'AzureCloud',
            user: { name: 'user-a@example.com' },
          }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            id: 'sub-other',
            tenantId: 'tenant-a',
            cloudName: 'AzureCloud',
            user: { name: 'user-b@example.com' },
          }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            id: 'default-sub',
            tenantId: 'tenant-a',
            cloudName: 'AzureCloud',
            user: { name: 'user-b@example.com' },
          }),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            id: 'sub-other',
            tenantId: 'tenant-a',
            cloudName: 'AzureCloud',
            user: { name: 'user-a@example.com' },
          }),
          stderr: '',
        });

      await getLoginStatus();
      accountChanged.mockClear();
      subChanged.mockClear();

      // First scoped read invalidates only sub-other without emitting global azure-account-change
      await getLoginStatus('sub-other');
      expect(accountChanged).not.toHaveBeenCalled();
      expect(subChanged).toHaveBeenCalledTimes(1);
      expect(subChanged.mock.results[0].value).toEqual({ subscriptionId: 'sub-other' });

      // Scoped identity change A -> B invalidates sub-other
      await getLoginStatus('sub-other');
      expect(accountChanged).not.toHaveBeenCalled();
      expect(subChanged).toHaveBeenCalledTimes(2);

      // Default account change resets scoped baseline so switching back to A via scoped lookup invalidates again
      await getLoginStatus();
      expect(accountChanged).toHaveBeenCalledTimes(1);

      await getLoginStatus('sub-other');
      expect(subChanged).toHaveBeenCalledTimes(4);
    } finally {
      window.removeEventListener('azure-account-change', accountChanged);
      window.removeEventListener('azure-subscription-account-change', subChanged);
    }
  });

  test('invalidates a pre-populated token cache on the first scoped observation without global event', async () => {
    const accountChanged = vi.fn();
    const subChanged = vi.fn();
    window.addEventListener('azure-account-change', accountChanged);
    window.addEventListener('azure-subscription-account-change', subChanged);
    mocks.runCommandAsync.mockResolvedValue({
      stdout: JSON.stringify({
        id: 'first-scoped-sub',
        tenantId: 'tenant-a',
        cloudName: 'AzureCloud',
        user: { name: 'scoped@example.com' },
      }),
      stderr: '',
    });
    try {
      await getLoginStatus('first-scoped-sub');
      expect(accountChanged).not.toHaveBeenCalled();
      expect(subChanged).toHaveBeenCalledTimes(1);

      await getLoginStatus('first-scoped-sub');
      expect(subChanged).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('azure-account-change', accountChanged);
      window.removeEventListener('azure-subscription-account-change', subChanged);
    }
  });

  test('overlapping scoped reads follow the newest observation across a sign-in change', async () => {
    let releaseOlder!: (value: { stdout: string; stderr: string }) => void;
    mocks.runCommandAsync
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseOlder = resolve;
          })
      )
      .mockResolvedValue({
        stdout: JSON.stringify({
          id: 'overlapping-scoped-sub',
          tenantId: 'new-tenant',
          cloudName: 'AzureUSGovernment',
          user: { name: 'new-user@example.com' },
        }),
        stderr: '',
      });
    const changed = vi.fn();
    window.addEventListener('azure-subscription-account-change', changed);
    try {
      const older = getLoginStatus('overlapping-scoped-sub');
      const newer = await getLoginStatus('overlapping-scoped-sub');
      expect(changed).toHaveBeenCalledTimes(1);
      changed.mockClear();

      releaseOlder({
        stdout: JSON.stringify({
          id: 'overlapping-scoped-sub',
          tenantId: 'old-tenant',
          cloudName: 'AzureCloud',
          user: { name: 'old-user@example.com' },
        }),
        stderr: '',
      });
      await expect(older).resolves.toEqual(newer);
      expect(changed).not.toHaveBeenCalled();

      await expect(getLoginStatus('overlapping-scoped-sub')).resolves.toEqual(newer);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('azure-subscription-account-change', changed);
    }
  });

  test('retires a canceled newer scoped observation so an older lookup does not hang', async () => {
    let releaseOlder!: (value: { stdout: string; stderr: string }) => void;
    const hanging = new Promise<{ stdout: string; stderr: string }>(() => {});
    mocks.runCommandAsync
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseOlder = resolve;
          })
      )
      .mockReturnValueOnce(hanging)
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: 'cancel-scoped-sub',
          tenantId: 'tenant-fresh',
          cloudName: 'AzureCloud',
          user: { name: 'fresh@example.com' },
        }),
        stderr: '',
      });

    const controller = new AbortController();
    const older = getLoginStatus('cancel-scoped-sub');
    const newer = getLoginStatus('cancel-scoped-sub', controller.signal);

    controller.abort(new Error('Cancelled'));
    await expect(newer).rejects.toThrow('Cancelled');

    releaseOlder({
      stdout: JSON.stringify({
        id: 'cancel-scoped-sub',
        tenantId: 'tenant-a',
        cloudName: 'AzureCloud',
        user: { name: 'user@example.com' },
      }),
      stderr: '',
    });
    await expect(older).resolves.toMatchObject({
      isLoggedIn: true,
      subscriptionId: 'cancel-scoped-sub',
      username: 'fresh@example.com',
    });
  });

  test('invalidates cached tokens across uppercase GUID selectors, default-to-scoped switches, and interleaved default changes', async () => {
    const lowerId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const upperId = lowerId.toUpperCase();
    const tokenJson = (tok: string) =>
      JSON.stringify({
        accessToken: tok,
        expires_on: Math.floor(Date.now() / 1000) + 3600,
      });
    const accountJson = (user: string) =>
      JSON.stringify({
        id: lowerId,
        tenantId: 'tenant-a',
        cloudName: 'AzureCloud',
        user: { name: user },
      });

    // 1. Uppercase selector resolving to lowercase subscription ID invalidates the credential
    mocks.runCommandAsync
      .mockResolvedValueOnce({ stdout: accountJson('user-a@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: tokenJson('tok-a1'), stderr: '' })
      .mockResolvedValueOnce({ stdout: accountJson('user-b@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: tokenJson('tok-b1'), stderr: '' });

    await getLoginStatus(upperId);
    expect(getSubscriptionCredential(upperId)).toBe(getSubscriptionCredential(lowerId));
    expect((await getSubscriptionCredential(upperId).getToken(ARM_SCOPE)).token).toBe('tok-a1');
    await getLoginStatus(upperId);
    expect((await getSubscriptionCredential(lowerId).getToken(ARM_SCOPE)).token).toBe('tok-b1');

    // 2. Omitted-scope read as A -> scoped read as B -> omitted-scope read as A invalidates B's token
    mocks.runCommandAsync
      .mockResolvedValueOnce({ stdout: accountJson('user-a@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: accountJson('user-b@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: tokenJson('tok-b2'), stderr: '' })
      .mockResolvedValueOnce({ stdout: accountJson('user-a@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: tokenJson('tok-a2'), stderr: '' });

    await getLoginStatus();
    await getLoginStatus(lowerId);
    expect((await getSubscriptionCredential(lowerId).getToken(ARM_SCOPE)).token).toBe('tok-b2');
    await getLoginStatus();
    expect((await getSubscriptionCredential(lowerId).getToken(ARM_SCOPE)).token).toBe('tok-a2');

    // 3. In-flight scoped lookup started as A finishing after default change to B does not restore baseline A
    let releaseScopedA!: (value: { stdout: string; stderr: string }) => void;
    mocks.runCommandAsync
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseScopedA = resolve;
          })
      )
      .mockResolvedValueOnce({ stdout: accountJson('user-b@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: accountJson('user-b@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: tokenJson('tok-b3'), stderr: '' })
      .mockResolvedValueOnce({ stdout: accountJson('user-a@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: tokenJson('tok-a3'), stderr: '' });

    const inflightA = getLoginStatus(lowerId);
    await getLoginStatus();
    releaseScopedA({ stdout: accountJson('user-a@example.com'), stderr: '' });
    await inflightA;

    expect((await getSubscriptionCredential(lowerId).getToken(ARM_SCOPE)).token).toBe('tok-b3');
    await getLoginStatus(lowerId);
    expect((await getSubscriptionCredential(lowerId).getToken(ARM_SCOPE)).token).toBe('tok-a3');

    // 4. Unchanged default-account observations preserve the identity-bound token
    mocks.runCommandAsync
      .mockResolvedValueOnce({ stdout: accountJson('user-a@example.com'), stderr: '' })
      .mockResolvedValueOnce({ stdout: tokenJson('tok-a4'), stderr: '' })
      .mockResolvedValueOnce({ stdout: accountJson('user-a@example.com'), stderr: '' });

    await getLoginStatus();
    expect((await getSubscriptionCredential(lowerId).getToken(ARM_SCOPE)).token).toBe('tok-a4');
    await getLoginStatus();
    expect((await getSubscriptionCredential(lowerId).getToken(ARM_SCOPE)).token).toBe('tok-a4');
  });

  test('retries with active caller signal when a followed scoped or default observation is canceled after older read finishes', async () => {
    // Scoped: older finishes first -> sees newer pending -> newer cancels -> older retries cleanly
    let releaseOlderScoped!: (value: { stdout: string; stderr: string }) => void;
    const hangingScoped = new Promise<{ stdout: string; stderr: string }>(() => {});
    mocks.runCommandAsync
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseOlderScoped = resolve;
          })
      )
      .mockReturnValueOnce(hangingScoped)
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: 'retry-scoped-sub',
          tenantId: 'tenant-a',
          cloudName: 'AzureCloud',
          user: { name: 'retried-scoped@example.com' },
        }),
        stderr: '',
      });

    const scopedController = new AbortController();
    const olderScoped = getLoginStatus('retry-scoped-sub');
    const newerScoped = getLoginStatus('retry-scoped-sub', scopedController.signal);

    releaseOlderScoped({
      stdout: JSON.stringify({
        id: 'retry-scoped-sub',
        tenantId: 'tenant-a',
        cloudName: 'AzureCloud',
        user: { name: 'stale-scoped@example.com' },
      }),
      stderr: '',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    scopedController.abort(new Error('Newer scoped canceled'));

    await expect(newerScoped).rejects.toThrow('Newer scoped canceled');
    await expect(olderScoped).resolves.toMatchObject({
      isLoggedIn: true,
      username: 'retried-scoped@example.com',
    });

    // Default: older finishes first -> sees newer pending -> newer cancels -> older retries cleanly
    let releaseOlderDefault!: (value: { stdout: string; stderr: string }) => void;
    const hangingDefault = new Promise<{ stdout: string; stderr: string }>(() => {});
    mocks.runCommandAsync
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseOlderDefault = resolve;
          })
      )
      .mockReturnValueOnce(hangingDefault)
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          id: 'retry-default-sub',
          tenantId: 'tenant-a',
          cloudName: 'AzureCloud',
          user: { name: 'retried-default@example.com' },
        }),
        stderr: '',
      });

    const defaultController = new AbortController();
    const olderDefault = getLoginStatus();
    const newerDefault = getLoginStatus(undefined, defaultController.signal);

    releaseOlderDefault({
      stdout: JSON.stringify({
        id: 'retry-default-sub',
        tenantId: 'tenant-a',
        cloudName: 'AzureCloud',
        user: { name: 'stale-default@example.com' },
      }),
      stderr: '',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    defaultController.abort(new Error('Newer default canceled'));

    await expect(newerDefault).rejects.toThrow('Newer default canceled');
    await expect(olderDefault).resolves.toMatchObject({
      isLoggedIn: true,
      username: 'retried-default@example.com',
    });
  });

  test('does not publish an older observation after a completed and then canceled newer read', async () => {
    for (const scoped of [true, false]) {
      const releases: ((value: { stdout: string; stderr: string }) => void)[] = [];
      mocks.runCommandAsync.mockImplementation(
        () =>
          new Promise(resolve => {
            releases.push(resolve);
          })
      );
      const controller = new AbortController();
      const selector = scoped ? `three-read-${scoped}` : undefined;
      const older = getLoginStatus(selector);
      const completed = getLoginStatus(selector);
      releases[1]({
        stdout: JSON.stringify({
          id: `fresh-${scoped}`,
          tenantId: 'tenant-fresh',
          user: { name: 'fresh@example.com' },
        }),
        stderr: '',
      });
      await completed;
      const canceled = getLoginStatus(selector, controller.signal);
      controller.abort(new Error('canceled newest'));
      await expect(canceled).rejects.toThrow('canceled newest');
      releases[0]({
        stdout: JSON.stringify({
          id: `stale-${scoped}`,
          tenantId: 'tenant-stale',
          user: { name: 'stale@example.com' },
        }),
        stderr: '',
      });
      await vi.waitFor(() => expect(releases).toHaveLength(4));
      releases[3]({
        stdout: JSON.stringify({
          id: `fresh-${scoped}`,
          tenantId: 'tenant-fresh',
          user: { name: 'fresh@example.com' },
        }),
        stderr: '',
      });
      await expect(older).resolves.toMatchObject({ username: 'fresh@example.com' });
      mocks.runCommandAsync.mockReset();
    }
  });

  test('advances the default generation for an unchanged accepted observation', async () => {
    const releases: ((value: { stdout: string; stderr: string }) => void)[] = [];
    mocks.runCommandAsync.mockImplementation(
      () =>
        new Promise(resolve => {
          releases.push(resolve);
        })
    );
    const scoped = getLoginStatus('generation-sub');
    const sameDefault = getLoginStatus();
    const sameAccount = {
      id: 'generation-sub',
      tenantId: 'generation-tenant',
      user: { name: 'same@example.com' },
    };
    releases[1]({ stdout: JSON.stringify(sameAccount), stderr: '' });
    await sameDefault;
    releases[0]({ stdout: JSON.stringify(sameAccount), stderr: '' });
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[2]({ stdout: JSON.stringify(sameAccount), stderr: '' });
    await expect(scoped).resolves.toMatchObject({
      isLoggedIn: true,
      subscriptionId: 'generation-sub',
      tenantId: 'generation-tenant',
      username: 'same@example.com',
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
    expect(result.message).toContain('Azure CLI could not be started.');
    expect(result.message).toContain('Install Azure CLI.');
  });

  test('preserves Azure CLI installation guidance for a thrown ENOENT error', async () => {
    mocks.runCommandAsync.mockRejectedValue(new Error('spawn az ENOENT'));

    const result = await initiateLogin();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Azure CLI could not be started.');
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
