// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  getSubscriptions: vi.fn(),
}));

vi.mock('../shared/openExternalUrl', () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock('./az-subscriptions', () => ({
  getSubscriptions: mocks.getSubscriptions,
}));

function capability(overrides: Record<string, unknown> = {}) {
  const api = {
    startAzureLogin: vi.fn().mockResolvedValue({
      success: true,
      pending: true,
      prompt: {
        userCode: 'CODE',
        verificationUri: 'https://microsoft.com/devicelogin',
        message: 'Enter CODE',
      },
    }),
    getAzureLoginStatus: vi.fn().mockResolvedValue({
      success: true,
      pending: false,
      account: { username: 'José Müller', tenantId: 'home-tenant' },
    }),
    getAzureToken: vi.fn().mockResolvedValue({
      success: true,
      accessToken: 'access-token',
      expiresOnTimestamp: Date.now() + 60_000,
    }),
    cancelAzureLogin: vi.fn().mockResolvedValue({ success: true }),
    logoutAzure: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
  vi.stubGlobal('pluginAzureOAuth', api);
  return api;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function load() {
  return import('./native-auth');
}

async function establishSession(api = capability()) {
  mocks.getSubscriptions.mockResolvedValue([
    {
      id: 'subscription-id',
      tenant: 'guest-tenant',
      status: 'Enabled',
    },
  ]);
  const auth = await load();
  await auth.initiateNativeLogin();
  await auth.synchronizeNativeLogin();
  return { api, auth };
}

describe('native authentication facade', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test('starts device login through the scoped desktop capability', async () => {
    const api = capability();
    const auth = await load();

    await expect(auth.initiateNativeLogin()).resolves.toMatchObject({ userCode: 'CODE' });

    expect(api.startAzureLogin).toHaveBeenCalledWith(
      'AzureCloud',
      'https://management.core.windows.net//.default'
    );
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://microsoft.com/devicelogin');
    expect(auth.hasNativeSession()).toBe(true);
  });

  test('rejects sign-in when the private capability is unavailable', async () => {
    const auth = await load();
    await expect(auth.initiateNativeLogin()).rejects.toThrow(
      'Desktop Azure authentication is not available'
    );
    expect(auth.hasNativeSession()).toBe(false);
    expect(auth.isAzureExplicitlySignedOut()).toBe(false);
  });

  test('uses the selected sovereign cloud configuration', async () => {
    const api = capability();
    const auth = await load();

    await auth.initiateNativeLogin(undefined, 'AzureUSGovernment');

    expect(api.startAzureLogin).toHaveBeenCalledWith(
      'AzureUSGovernment',
      'https://management.core.usgovcloudapi.net//.default'
    );
  });

  test('cancels the main-process flow when the caller aborts', async () => {
    const api = capability();
    const auth = await load();
    const controller = new AbortController();
    await auth.initiateNativeLogin(controller.signal);

    controller.abort();
    await vi.waitFor(() => expect(api.cancelAzureLogin).toHaveBeenCalledOnce());
    expect(auth.hasNativeSession()).toBe(false);
  });

  test('does not let a superseded attempt cancel a newer main-process session', async () => {
    const firstStart = deferred<{
      success: true;
      pending: true;
      prompt: { userCode: string; verificationUri: string; message: string };
    }>();
    const api = capability({
      startAzureLogin: vi
        .fn()
        .mockReturnValueOnce(firstStart.promise)
        .mockResolvedValueOnce({
          success: true,
          pending: true,
          prompt: {
            userCode: 'NEW',
            verificationUri: 'https://microsoft.com/devicelogin',
            message: 'Enter NEW',
          },
        }),
    });
    const auth = await load();
    const first = auth.initiateNativeLogin();
    const second = auth.initiateNativeLogin();

    firstStart.resolve({
      success: true,
      pending: true,
      prompt: {
        userCode: 'OLD',
        verificationUri: 'https://microsoft.com/devicelogin',
        message: 'Enter OLD',
      },
    });

    await expect(first).rejects.toThrow('cancelled');
    await expect(second).resolves.toMatchObject({ userCode: 'NEW' });
    expect(api.cancelAzureLogin).not.toHaveBeenCalled();
    expect(auth.hasNativeSession()).toBe(true);
  });

  test('keeps pending status without repeating subscription discovery', async () => {
    const api = capability({
      getAzureLoginStatus: vi.fn().mockResolvedValue({ success: true, pending: true }),
    });
    const auth = await load();
    await auth.initiateNativeLogin();

    await Promise.all([auth.synchronizeNativeLogin(), auth.synchronizeNativeLogin()]);

    expect(api.getAzureLoginStatus).toHaveBeenCalledOnce();
    expect(mocks.getSubscriptions).not.toHaveBeenCalled();
    expect(auth.hasNativeSession()).toBe(true);
  });

  test('publishes an account only after strict subscription discovery', async () => {
    const { auth } = await establishSession();

    expect(mocks.getSubscriptions).toHaveBeenCalledWith(false, { strict: true });
    expect(auth.getNativeAccount()).toEqual({
      username: 'José Müller',
      tenantId: 'guest-tenant',
      subscriptionId: 'subscription-id',
      environmentName: 'AzureCloud',
    });
  });

  test('updates only the selected account tenant after verified reconciliation', async () => {
    const { auth } = await establishSession();

    expect(auth.updateNativeAccountTenant('other-subscription', 'other-tenant')).toBe(false);
    expect(auth.updateNativeAccountTenant('SUBSCRIPTION-ID', 'reconciled-tenant')).toBe(true);
    expect(auth.getNativeAccount()).toMatchObject({
      subscriptionId: 'subscription-id',
      tenantId: 'reconciled-tenant',
    });
  });

  test('records a terminal main-process login failure', async () => {
    capability({
      getAzureLoginStatus: vi.fn().mockResolvedValue({
        success: false,
        error: 'Device authorization was declined',
      }),
    });
    const auth = await load();
    await auth.initiateNativeLogin();

    await auth.synchronizeNativeLogin();

    expect(auth.hasNativeSession()).toBe(false);
    expect(auth.getNativeLoginError()).toBe('Device authorization was declined');
  });

  test('reports the genuine empty-subscription case separately', async () => {
    const api = capability();
    mocks.getSubscriptions.mockResolvedValue([]);
    const auth = await load();
    await auth.initiateNativeLogin();

    await auth.synchronizeNativeLogin();

    expect(auth.getNativeLoginError()).toBe(
      'No enabled Azure subscriptions were found for this account'
    );
    expect(api.logoutAzure).toHaveBeenCalledOnce();
    await expect(
      auth.nativeCredential.getToken('https://management.azure.com/.default')
    ).rejects.toThrow('Azure login is required');
  });

  test('returns access tokens acquired in the main process', async () => {
    const { api, auth } = await establishSession();

    await expect(
      auth.nativeCredential.getToken('https://graph.microsoft.com/.default', {
        tenantId: 'guest-tenant',
      })
    ).resolves.toMatchObject({ token: 'access-token' });
    expect(api.getAzureToken).toHaveBeenCalledWith(
      'https://graph.microsoft.com/.default',
      'guest-tenant'
    );
  });

  test('maps the default ARM endpoint scope to the configured native resource scope', async () => {
    const { api, auth } = await establishSession();

    await auth.nativeCredential.getToken('https://management.azure.com/.default');

    expect(api.getAzureToken).toHaveBeenCalledWith(
      'https://management.core.windows.net//.default',
      'guest-tenant'
    );
  });

  test('invalidates renderer state after a token-wide credential failure', async () => {
    const api = capability();
    const { auth } = await establishSession(api);
    api.getAzureToken.mockResolvedValueOnce({
      success: false,
      error: 'AADSTS700082: refresh token expired',
      sessionExpired: true,
    });

    await expect(
      auth.nativeCredential.getToken('https://graph.microsoft.com/.default')
    ).rejects.toThrow('AADSTS700082');

    expect(auth.hasNativeSession()).toBe(false);
    expect(auth.isAzureExplicitlySignedOut()).toBe(true);
  });

  test('lets a caller stop waiting without cancelling the shared desktop session', async () => {
    const pending = new Promise<never>(() => {});
    const api = capability({ getAzureToken: vi.fn().mockReturnValue(pending) });
    const { auth } = await establishSession(api);
    const controller = new AbortController();
    const token = auth.nativeCredential.getToken('https://graph.microsoft.com/.default', {
      abortSignal: controller.signal,
    });

    controller.abort(new Error('caller stopped'));

    await expect(token).rejects.toThrow('caller stopped');
    expect(api.cancelAzureLogin).not.toHaveBeenCalled();
  });

  test('applies a terminal host expiry even after the caller stops waiting', async () => {
    const tokenResponse = deferred<{
      success: false;
      error: string;
      sessionExpired: true;
    }>();
    const api = capability({ getAzureToken: vi.fn().mockReturnValue(tokenResponse.promise) });
    const { auth } = await establishSession(api);
    const controller = new AbortController();
    const token = auth.nativeCredential.getToken('https://graph.microsoft.com/.default', {
      abortSignal: controller.signal,
    });

    controller.abort(new Error('caller stopped'));
    await expect(token).rejects.toThrow('caller stopped');
    tokenResponse.resolve({
      success: false,
      error: 'AADSTS700082: refresh token expired',
      sessionExpired: true,
    });

    await vi.waitFor(() => expect(auth.hasNativeSession()).toBe(false));
    expect(auth.isAzureExplicitlySignedOut()).toBe(true);
  });

  test('logs out both renderer and main-process native state', async () => {
    const { api, auth } = await establishSession();

    await expect(auth.logoutNative()).resolves.toBe(true);

    expect(api.logoutAzure).toHaveBeenCalledOnce();
    expect(auth.getNativeAccount()).toBeUndefined();
    expect(auth.isAzureExplicitlySignedOut()).toBe(true);
  });

  test('cleans up a bridge-less renderer when no native session exists', async () => {
    const auth = await load();

    await expect(auth.logoutNative()).resolves.toBe(true);

    expect(auth.hasNativeSession()).toBe(false);
    expect(auth.isAzureExplicitlySignedOut()).toBe(true);
  });

  test('fails closed when the bridge disappears during an existing native session', async () => {
    const { auth } = await establishSession();
    vi.stubGlobal('pluginAzureOAuth', undefined);

    await expect(auth.logoutNative()).rejects.toThrow(
      'Desktop Azure authentication is not available'
    );
    expect(auth.hasNativeSession()).toBe(true);
  });

  test('keeps the local session when main-process sign-out fails', async () => {
    const api = capability({
      logoutAzure: vi.fn().mockResolvedValue({ success: false, error: 'cleanup failed' }),
    });
    const { auth } = await establishSession(api);

    await expect(auth.logoutNative()).rejects.toThrow('cleanup failed');

    expect(auth.getNativeAccount()).toBeDefined();
    expect(auth.hasNativeSession()).toBe(true);
  });

  test('ignores a sign-out response superseded by a newer login', async () => {
    const cleanup = deferred<{ success: true }>();
    const api = capability();
    const { auth } = await establishSession(api);
    api.logoutAzure.mockReturnValueOnce(cleanup.promise);
    const logout = auth.logoutNative();

    await auth.initiateNativeLogin();
    cleanup.resolve({ success: true });

    await expect(logout).rejects.toThrow('account changed');
    expect(auth.hasNativeSession()).toBe(true);
    expect(auth.isAzureExplicitlySignedOut()).toBe(false);
  });

  test('allows explicit CLI fallback after native sign-out', async () => {
    const { auth } = await establishSession();
    await auth.logoutNative();

    auth.allowAzureCliFallback();

    expect(auth.isAzureExplicitlySignedOut()).toBe(false);
  });
});
