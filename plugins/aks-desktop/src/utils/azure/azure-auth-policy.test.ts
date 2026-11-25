// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  subscriptions: vi.fn(),
}));

vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));
vi.mock('../shared/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('./az-subscriptions', () => ({ getSubscriptions: mocks.subscriptions }));

const CLI_ACCOUNT = {
  id: '11111111-2222-3333-4444-555555555555',
  tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  user: { name: 'cli@example.com' },
  cloudName: 'AzureCloud',
};
const KEY = 'aks-desktop:azure-auth-policy';
let cliAccount = CLI_ACCOUNT;

async function reload() {
  vi.resetModules();
  vi.stubGlobal('pluginAzureOAuth', {
    startAzureLogin: vi.fn().mockResolvedValue({
      success: true,
      pending: true,
      prompt: {
        userCode: 'code',
        verificationUri: 'https://microsoft.com/devicelogin',
        message: 'Enter code',
      },
    }),
    getAzureLoginStatus: vi.fn().mockResolvedValue({
      success: true,
      pending: false,
      account: {
        username: 'native@example.com',
        tenantId: CLI_ACCOUNT.tenantId,
      },
    }),
    getAzureToken: vi.fn().mockResolvedValue({
      success: true,
      accessToken: 'native-token',
      expiresOnTimestamp: Date.now() + 3_600_000,
    }),
    cancelAzureLogin: vi.fn().mockResolvedValue({ success: true }),
    logoutAzure: vi.fn().mockResolvedValue({ success: true }),
  });
  return {
    native: await import('./native-auth'),
    auth: await import('./az-auth'),
    token: await import('./az-token'),
    cli: await import('./az-cli-core'),
  };
}

describe('Azure authentication policy across renderer reloads', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    cliAccount = CLI_ACCOUNT;
    mocks.command.mockReset().mockImplementation(async (_command, args: string[]) => {
      if (args[0] === 'account' && args[1] === 'show') {
        return { stdout: JSON.stringify(cliAccount), stderr: '' };
      }
      if (args[0] === 'login') {
        return { stdout: JSON.stringify([CLI_ACCOUNT]), stderr: '' };
      }
      if (args[0] === 'cloud' && args[1] === 'show') {
        return { stdout: JSON.stringify({ name: 'AzureCloud' }), stderr: '' };
      }
      if (args[0] === 'account' && args[1] === 'get-access-token') {
        return {
          stdout: JSON.stringify({ accessToken: 'cli-token', expires_on: 4000000000 }),
          stderr: '',
        };
      }
      return { stdout: '{}', stderr: '' };
    });
    mocks.subscriptions.mockReset().mockResolvedValue([
      {
        id: CLI_ACCOUNT.id,
        tenant: CLI_ACCOUNT.tenantId,
        status: 'Enabled',
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test('preserves fresh-install CLI compatibility and explicit CLI choice after logout', async () => {
    let app = await reload();
    expect(await app.auth.getLoginStatus()).toMatchObject({
      isLoggedIn: true,
      username: 'cli@example.com',
    });
    await app.native.logoutNative();
    app = await reload();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
    expect((await app.auth.initiateCliLogin()).success).toBe(true);
    app.native.allowAzureCliFallback();
    app.cli.allowCliOperations();
    app = await reload();
    expect(await app.auth.getLoginStatus()).toMatchObject({
      isLoggedIn: true,
      username: 'cli@example.com',
    });
  });

  test('sign-out blocks account discovery, CLI operations and tokens after reload', async () => {
    let app = await reload();
    await app.native.logoutNative();
    app = await reload();
    mocks.command.mockClear();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
    await expect(app.token.getAzToken()).rejects.toThrow('Azure login is required');
    expect((await app.cli.runCommandAsync('az', ['group', 'list'])).stderr).toContain(
      'identity could not be verified'
    );
    expect(mocks.command).not.toHaveBeenCalled();
  });

  test('native login and skipped CLI cannot switch to an unrelated CLI account on reload', async () => {
    let app = await reload();
    await app.native.initiateNativeLogin();
    await app.native.synchronizeNativeLogin();
    expect(app.native.getNativeAccount()).toBeDefined();
    cliAccount = { ...CLI_ACCOUNT, user: { name: 'native@example.com' } };
    app.cli.allowCliOperations();
    expect((await app.cli.runCommandAsync('az', ['group', 'list'])).stderr).toBe('');
    app.cli.blockCliOperations();
    cliAccount = CLI_ACCOUNT;
    expect(localStorage.getItem(KEY)).toBe('cli-blocked');
    expect(JSON.stringify(localStorage)).not.toContain('secret');
    app = await reload();
    mocks.command.mockClear();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
    await expect(app.token.getAzToken()).rejects.toThrow('Azure login is required');
    expect((await app.cli.runCommandAsync('az', ['group', 'list'])).stderr).toContain(
      'identity could not be verified'
    );
    expect(mocks.command).not.toHaveBeenCalled();
  });

  test('cancelled native sign-in still requires an explicit login after reload', async () => {
    let app = await reload();
    const controller = new AbortController();
    await app.native.initiateNativeLogin(controller.signal);
    controller.abort();
    app = await reload();
    mocks.command.mockClear();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
    expect(mocks.command).not.toHaveBeenCalled();
  });

  test('unavailable or invalid policy storage fails closed until an explicit CLI choice', async () => {
    localStorage.setItem(KEY, 'unknown');
    let app = await reload();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
    localStorage.clear();
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    app = await reload();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
    app.native.allowAzureCliFallback();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: true });
    read.mockRestore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    app = await reload();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
  });

  test('a concurrent renderer block is not overwritten by the storage probe', async () => {
    const app = await reload();
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.startsWith('aks-desktop:azure-auth-policy-probe:')) {
        setItem.call(localStorage, KEY, 'cli-blocked');
      }
      setItem.call(localStorage, key, value);
    });
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
    expect(localStorage.getItem(KEY)).toBe('cli-blocked');
    expect(mocks.command).not.toHaveBeenCalled();
  });

  test("overlapping renderer policy probes do not remove each other's storage keys", async () => {
    const first = await import('./azure-auth-policy');
    vi.resetModules();
    const second = await import('./azure-auth-policy');
    const getItem = Storage.prototype.getItem;
    const probeReads: string[] = [];
    let otherBlocked: boolean | undefined;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key.startsWith('aks-desktop:azure-auth-policy-probe')) {
        probeReads.push(key);
        if (probeReads.length === 1) otherBlocked = second.isImplicitAzureCliBlocked();
      }
      return getItem.call(this, key);
    });
    expect(first.isImplicitAzureCliBlocked()).toBe(false);
    expect(otherBlocked).toBe(false);
    expect(new Set(probeReads).size).toBe(2);
    expect(localStorage.length).toBe(0);
  });

  test('does not start native sign-in when its policy cannot be persisted', async () => {
    const app = await reload();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(app.native.initiateNativeLogin()).rejects.toThrow(
      'Azure sign-in policy could not be saved'
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
  });

  test('sign-out remains effective in memory when storage fails', async () => {
    const app = await reload();
    expect((await app.auth.getLoginStatus()).isLoggedIn).toBe(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(await app.native.logoutNative()).toBe(false);
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
  });

  test.each([false, true])(
    'another renderer invalidates a failed explicit CLI override (already blocked=%s)',
    async alreadyBlocked => {
      if (alreadyBlocked) localStorage.setItem(KEY, 'cli-blocked');
      const first = await import('./azure-auth-policy');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('temporarily unavailable');
      });
      first.allowImplicitAzureCli();
      expect(first.isImplicitAzureCliBlocked()).toBe(false);
      write.mockRestore();
      vi.resetModules();
      const second = await import('./azure-auth-policy');
      expect(second.blockImplicitAzureCli()).toBe(true);
      expect(first.isImplicitAzureCliBlocked()).toBe(true);
      expect(second.isImplicitAzureCliBlocked()).toBe(true);
      warn.mockRestore();
    }
  );

  test('explicit CLI fallback is usable in memory if the persisted block cannot be cleared', async () => {
    let app = await reload();
    await app.native.logoutNative();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    app.native.allowAzureCliFallback();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: true });
    write.mockRestore();
    app = await reload();
    expect(await app.auth.getLoginStatus()).toMatchObject({ isLoggedIn: false });
  });
});
