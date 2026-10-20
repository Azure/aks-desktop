// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredTokens } from './github-auth';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  initiate: vi.fn(),
  poll: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('./github-auth', async original => ({
  ...(await original<typeof import('./github-auth')>()),
  loadTokens: mocks.load,
  saveTokens: mocks.save,
  clearTokens: mocks.clear,
}));
vi.mock('./github-device-flow', () => ({
  initiateDeviceFlow: mocks.initiate,
  waitForDeviceTokens: mocks.poll,
  refreshDeviceToken: mocks.refresh,
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ getHeadlampAPIHeaders: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const stored = (token = 'account-a-token', seconds = 3600): StoredTokens => ({
  accessToken: token,
  refreshToken: 'refresh-a',
  expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
});
let session: typeof import('./github-session');
let OAuthError: typeof import('./github-oauth-transport').GitHubOAuthError;
let releases: (() => void)[];
let sent: (string | null)[];
const settle = () => vi.advanceTimersByTimeAsync(0);
function retain() {
  const owner = Symbol();
  releases.push(session.retainGitHubSession(owner));
  return owner;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.clearAllMocks();
  releases = [];
  sent = [];
  mocks.load.mockResolvedValue(null);
  mocks.save.mockResolvedValue(true);
  mocks.clear.mockResolvedValue({ success: true });
  mocks.initiate.mockResolvedValue({
    deviceCode: 'private-device-code',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device',
    expiresAt: Date.now() + 900000,
    intervalMs: 5000,
  });
  mocks.poll.mockResolvedValue({
    accessToken: 'account-a-token',
    refreshToken: 'refresh-a',
    expiresIn: 3600,
  });
  mocks.refresh.mockResolvedValue({
    accessToken: 'rotated-a-token',
    refreshToken: 'rotated-refresh',
    expiresIn: 3600,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, options) => {
      const bearer = new Headers(options?.headers).get('authorization');
      sent.push(bearer);
      const login = bearer?.includes('account-b') ? 'account-b' : 'account-a';
      return new Response(JSON.stringify({ login, avatar_url: 'https://example.invalid/avatar' }), {
        headers: { 'content-type': 'application/json' },
      });
    })
  );
  session = await import('./github-session');
  OAuthError = (await import('./github-oauth-transport')).GitHubOAuthError;
});
afterEach(() => {
  releases.forEach(release => release());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared GitHub session', () => {
  it.each([false, true])(
    'rolls back a cancelled native save, preserving prior credentials: %s',
    async prior => {
      let disk: StoredTokens | null = prior ? stored('prior-token') : null;
      mocks.load.mockImplementation(async () => disk);
      if (prior)
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response('{"message":"Bad credentials"}', { status: 401 })
        );
      const owner = retain();
      await settle();
      const previous = disk;
      const write = deferred<void>();
      mocks.save.mockImplementation(async tokens => {
        await write.promise;
        disk = tokens;
        return true;
      });
      mocks.clear.mockImplementation(async () => {
        disk = null;
        return { success: true };
      });
      const login = session.startDeviceLogin(owner);
      await settle();
      expect(mocks.save).toHaveBeenCalledTimes(1);
      session.cancelDeviceLogin(owner);
      const pendingCleanup = session.getGitHubSessionSnapshot().authState.isDisconnecting;
      write.resolve();
      await login;
      expect(disk).toEqual(previous);
      expect(pendingCleanup).toBe(true);
      expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(false);
    }
  );

  it('blocks new login when rollback of a cancelled save fails, until explicit cleanup succeeds', async () => {
    const write = deferred<boolean>();
    mocks.save.mockReturnValueOnce(write.promise);
    const owner = retain();
    await settle();
    const login = session.startDeviceLogin(owner);
    await settle();
    session.cancelDeviceLogin(owner);
    mocks.clear.mockResolvedValueOnce({ success: false, reason: 'storage-failed' });
    write.resolve(true);
    await login;
    expect(session.getGitHubSessionSnapshot().authState.disconnectError).toBeTruthy();
    await session.startDeviceLogin(owner);
    expect(mocks.initiate).toHaveBeenCalledTimes(1);
    await session.disconnectGitHub();
    expect(session.getGitHubSessionSnapshot().authState.disconnectError).toBeNull();
  });

  it('lets an explicit Cancel from another retained view abort the shared attempt', async () => {
    const poll = deferred<{ accessToken: string; refreshToken: string; expiresIn: number }>();
    mocks.poll.mockReturnValueOnce(poll.promise);
    const owner = retain();
    const viewer = retain();
    await settle();
    const login = session.startDeviceLogin(owner);
    await settle();
    session.cancelDeviceLogin(viewer);
    expect(mocks.poll.mock.calls[0][1].aborted).toBe(false);
    expect(typeof session.abortDeviceLogin).toBe('function');
    session.abortDeviceLogin(viewer);
    expect(mocks.poll.mock.calls[0][1].aborted).toBe(true);
    poll.resolve({ accessToken: 'late', refreshToken: 'late-refresh', expiresIn: 3600 });
    await login;
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['profile', 'refresh'])(
    'retries transient startup %s failure without starting a new device grant',
    async failure => {
      let disk = stored('account-a-token', -1);
      mocks.load.mockImplementation(async () => disk);
      mocks.save.mockImplementation(async tokens => {
        disk = tokens;
        return true;
      });
      if (failure === 'profile') {
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response('{"message":"unavailable"}', { status: 503 })
        );
      } else {
        mocks.refresh.mockRejectedValueOnce(
          new OAuthError('http_error', { status: 503, retryable: true })
        );
      }
      const owner = retain();
      await settle();
      if (failure === 'profile') expect(disk.refreshToken).toBe('rotated-refresh');
      expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(false);
      await session.startDeviceLogin(owner);
      expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(true);
      expect(mocks.initiate).not.toHaveBeenCalled();
      expect(mocks.refresh).toHaveBeenCalledTimes(failure === 'profile' ? 1 : 2);
    }
  );

  it('bootstraps once for independent owners and retains one cached snapshot/client', async () => {
    mocks.load.mockResolvedValueOnce(stored());
    retain();
    retain();
    await settle();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    const snapshot = session.getGitHubSessionSnapshot();
    expect(snapshot).toBe(session.getGitHubSessionSnapshot());
    expect(snapshot.authState.username).toBe('account-a');
    expect(snapshot.octokit).not.toBeNull();
  });

  it('never lets deferred restore resurrect an explicitly disconnected session', async () => {
    const restore = deferred<StoredTokens | null>();
    mocks.load.mockReturnValueOnce(restore.promise);
    retain();
    await session.disconnectGitHub();
    restore.resolve(stored());
    await settle();
    expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(false);
    expect(session.getGitHubSessionSnapshot().octokit).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('shares one authorization and cancels it when its owner leaves, not when another owner leaves', async () => {
    const result = deferred<{ accessToken: string; refreshToken: string; expiresIn: number }>();
    mocks.poll.mockReturnValueOnce(result.promise);
    const owner = retain();
    retain();
    await settle();
    const login = session.startDeviceLogin(owner);
    await settle();
    expect(session.getGitHubSessionSnapshot().authState.deviceAuthorization).toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: Date.now() + 900000,
    });
    expect(JSON.stringify(session.getGitHubSessionSnapshot())).not.toContain('private-device-code');
    releases[1]();
    expect(mocks.poll.mock.calls[0][1].aborted).toBe(false);
    releases[0]();
    expect(mocks.poll.mock.calls[0][1].aborted).toBe(true);
    result.resolve({ accessToken: 'late-a', refreshToken: 'late-refresh', expiresIn: 3600 });
    await login;
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(false);
  });

  it('orders an already-running save before disconnect deletion and the next account save', async () => {
    const write = deferred<boolean>();
    mocks.save.mockReturnValueOnce(write.promise);
    const owner = retain();
    await settle();
    const loginA = session.startDeviceLogin(owner);
    await settle();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const disconnect = session.disconnectGitHub();
    const sameDisconnect = session.disconnectGitHub();
    expect(sameDisconnect).toBe(disconnect);
    expect(session.getGitHubSessionSnapshot().octokit).toBeNull();
    expect(session.getGitHubSessionSnapshot().authState.isDisconnecting).toBe(true);
    expect(mocks.clear).not.toHaveBeenCalled();
    await session.startDeviceLogin(owner);
    expect(mocks.initiate).toHaveBeenCalledTimes(1);
    write.resolve(true);
    await expect(disconnect).resolves.toEqual({ success: true });
    await loginA;
    mocks.poll.mockResolvedValueOnce({
      accessToken: 'account-b-token',
      refreshToken: 'refresh-b',
      expiresIn: 3600,
    });
    await session.startDeviceLogin(owner);
    expect(session.getGitHubSessionSnapshot().authState.username).toBe('account-b');
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls.at(-1)?.[0].accessToken).toBe('account-b-token');
  });

  it.each(['storage-unavailable', 'storage-failed'] as const)(
    'keeps a retryable cleanup tombstone on %s across remounts',
    async reason => {
      mocks.load.mockResolvedValueOnce(stored());
      const owner = retain();
      await settle();
      mocks.clear.mockResolvedValueOnce({ success: false, reason });
      await expect(session.disconnectGitHub()).resolves.toEqual({ success: false, reason });
      expect(session.getGitHubSessionSnapshot().authState.disconnectError).toBeTruthy();
      releases[0]();
      retain();
      await session.startDeviceLogin(owner);
      expect(mocks.initiate).not.toHaveBeenCalled();
      expect(mocks.load).toHaveBeenCalledTimes(1);
      await expect(session.disconnectGitHub()).resolves.toEqual({ success: true });
      expect(session.getGitHubSessionSnapshot().authState.disconnectError).toBeNull();
    }
  );

  it('retains the same client and identity on refresh but dispatches the newly rotated bearer', async () => {
    mocks.load.mockResolvedValueOnce(stored());
    retain();
    retain();
    await settle();
    const before = session.getGitHubSessionSnapshot();
    const client = before.octokit!;
    await vi.advanceTimersByTimeAsync(55 * 60000);
    const after = session.getGitHubSessionSnapshot();
    expect(after.octokit).toBe(client);
    expect(after.authState.sessionVersion).toBe(before.authState.sessionVersion);
    expect(after.authState.isAuthenticated).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await client.users.getAuthenticated();
    expect(sent.at(-1)).toBe('Bearer rotated-a-token');
    await session.disconnectGitHub();
    await expect(client.users.getAuthenticated()).rejects.toMatchObject({
      name: 'SessionInvalidatedError',
    });
  });

  it('keeps a valid client during refresh, but publishes no usable client once the access token expires', async () => {
    mocks.load.mockResolvedValueOnce(stored());
    const refresh = deferred<{ accessToken: string; refreshToken: string; expiresIn: number }>();
    mocks.refresh.mockReturnValueOnce(refresh.promise);
    retain();
    await settle();
    const client = session.getGitHubSessionSnapshot().octokit;
    await vi.advanceTimersByTimeAsync(55 * 60000);
    expect(session.getGitHubSessionSnapshot().octokit).toBe(client);
    await vi.advanceTimersByTimeAsync(5 * 60000 + 1);
    expect(session.getGitHubSessionSnapshot().octokit).toBeNull();
    await expect(client!.users.getAuthenticated()).rejects.toMatchObject({
      name: 'SessionInvalidatedError',
    });
    refresh.resolve({
      accessToken: 'rotated-a-token',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    });
    await settle();
    expect(session.getGitHubSessionSnapshot().octokit).toBe(client);
  });

  it('offers reauthentication on definitive untagged refresh rejection without deleting pipeline state', async () => {
    localStorage.setItem('pipeline-fixture', '{"state":"PipelineRunning","runId":42}');
    mocks.load.mockResolvedValueOnce(stored('account-a-token', -1));
    mocks.refresh.mockRejectedValueOnce(new OAuthError('bad_refresh_token'));
    retain();
    await settle();
    expect(mocks.refresh).toHaveBeenCalledWith('refresh-a', expect.any(AbortSignal));
    expect(session.getGitHubSessionSnapshot().octokit).toBeNull();
    expect(session.getGitHubSessionSnapshot().authState.error).toBeTruthy();
    expect(localStorage.getItem('pipeline-fixture')).toBe('{"state":"PipelineRunning","runId":42}');
    expect(mocks.clear).not.toHaveBeenCalled();
    localStorage.removeItem('pipeline-fixture');
  });

  it('does not loop refresh retries indefinitely after a transient failure', async () => {
    mocks.load.mockResolvedValueOnce(stored());
    retain();
    await settle();
    mocks.refresh.mockRejectedValueOnce(new OAuthError('network_error', { retryable: true }));
    await vi.advanceTimersByTimeAsync(65 * 60000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(session.getGitHubSessionSnapshot().octokit).toBeNull();
    expect(session.getGitHubSessionSnapshot().authState.error).toBeTruthy();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('refreshes an expired cached session when a provider returns without deleting credentials', async () => {
    mocks.load.mockResolvedValueOnce(stored());
    retain();
    await settle();
    const client = session.getGitHubSessionSnapshot().octokit;
    releases[0]();
    await vi.advanceTimersByTimeAsync(65 * 60000);
    retain();
    await settle();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(session.getGitHubSessionSnapshot().octokit).toBe(client);
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('does not start refresh on an unpublished login while its first save is pending', async () => {
    const write = deferred<boolean>();
    mocks.save.mockReturnValueOnce(write.promise);
    const owner = retain();
    await settle();
    const login = session.startDeviceLogin(owner);
    await settle();
    retain();
    await vi.advanceTimersByTimeAsync(55 * 60000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    write.resolve(true);
    await login;
  });

  it('does not persist an access token that expires during identity verification', async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise)
    );
    const owner = retain();
    await settle();
    const login = session.startDeviceLogin(owner);
    await settle();
    await vi.advanceTimersByTimeAsync(3600001);
    response.resolve(
      new Response('{"login":"account-a"}', { headers: { 'content-type': 'application/json' } })
    );
    await login;
    expect(mocks.save).not.toHaveBeenCalled();
    expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(false);
  });

  it('does not undo completed authentication when success unmounts the initiating UI', async () => {
    const owner = retain();
    await settle();
    const unsubscribe = session.subscribeGitHubSession(() => {
      if (session.getGitHubSessionSnapshot().authState.isAuthenticated) releases[0]();
    });
    await session.startDeviceLogin(owner);
    expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(true);
    expect(mocks.clear).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('reports cleanup exceptions as failure and permits an explicit retry', async () => {
    retain();
    await settle();
    mocks.clear.mockRejectedValueOnce(new Error('synthetic-storage-failure'));
    await expect(session.disconnectGitHub()).resolves.toEqual({
      success: false,
      reason: 'storage-failed',
    });
    expect(session.getGitHubSessionSnapshot().authState.disconnectError).toBeTruthy();
    await expect(session.disconnectGitHub()).resolves.toEqual({ success: true });
  });

  it('does not publish login success when credential persistence fails', async () => {
    mocks.save.mockResolvedValueOnce(false);
    const owner = retain();
    await settle();
    await session.startDeviceLogin(owner);
    expect(session.getGitHubSessionSnapshot().octokit).toBeNull();
    expect(session.getGitHubSessionSnapshot().authState.isAuthenticated).toBe(false);
    expect(session.getGitHubSessionSnapshot().authState.error).toBeTruthy();
  });
});
