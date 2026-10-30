// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OAuthCallbackResult } from '../../../utils/github/github-auth';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock('../../../utils/github/secure-storage', () => ({
  isSecureStorageAvailable: () => true,
  secureStorageLoad: storage.load,
  secureStorageSave: storage.save,
  secureStorageDelete: storage.remove,
}));
const tokens = () => ({
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
let disk: string | null;
let pauseNextCallback: Promise<void> | null;
let callbacks: ((result: OAuthCallbackResult) => void)[];
let useAuth: typeof import('./useGitHubAuth').useGitHubAuth;
let bridge: {
  startGitHubOAuth: ReturnType<typeof vi.fn>;
  onGitHubOAuthCallback: ReturnType<typeof vi.fn>;
  refreshGitHubOAuth: ReturnType<typeof vi.fn>;
};
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
beforeEach(async () => {
  vi.resetModules();
  pauseNextCallback = null;
  vi.doMock('react', () => ({
    ...React,
    useCallback: (callback: (...args: unknown[]) => unknown, deps: React.DependencyList) =>
      React.useCallback((...args: unknown[]) => {
        // Model a future asynchronous boundary before a memoized auth operation starts.
        const pause = pauseNextCallback;
        pauseNextCallback = null;
        return pause ? pause.then(() => callback(...args)) : callback(...args);
      }, deps),
  }));
  vi.useFakeTimers();
  vi.clearAllMocks();
  disk = JSON.stringify(tokens());
  callbacks = [];
  storage.load.mockImplementation(async () => disk);
  storage.save.mockImplementation(async (_key, value) => {
    disk = value;
    return true;
  });
  storage.remove.mockImplementation(async () => {
    disk = null;
    return true;
  });
  bridge = {
    startGitHubOAuth: vi.fn().mockResolvedValue({ success: true }),
    onGitHubOAuthCallback: vi.fn(callback => {
      callbacks.push(callback);
      return () => {
        callbacks = callbacks.filter(listener => listener !== callback);
      };
    }),
    refreshGitHubOAuth: vi.fn(),
  };
  Object.assign(window, { desktopApi: bridge });
  vi.stubGlobal('pluginGitHubOAuth', bridge);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('{"login":"account-a","avatar_url":""}', {
          headers: { 'content-type': 'application/json' },
        })
    )
  );
  useAuth = (await import('./useGitHubAuth')).useGitHubAuth;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('react');
  Reflect.deleteProperty(window, 'desktopApi');
  localStorage.removeItem('pipeline-fixture');
});

it('disconnects independent views without erasing pipeline configuration or invalidating an existing client', async () => {
  localStorage.setItem('pipeline-fixture', '{"pr":42,"state":"PipelineRunning"}');
  const a = renderHook(useAuth);
  const b = renderHook(useAuth);
  await settle();
  expect(a.result.current.authState.isAuthenticated).toBe(true);
  expect(b.result.current.authState.isAuthenticated).toBe(true);
  const existingClient = a.result.current.octokit!;
  await act(async () => {
    await a.result.current.reset();
  });
  expect(a.result.current.authState.isAuthenticated).toBe(false);
  expect(b.result.current.authState.isAuthenticated).toBe(false);
  expect(b.result.current.octokit).toBeNull();
  expect(disk).toBeNull();
  expect(localStorage.getItem('pipeline-fixture')).toBe('{"pr":42,"state":"PipelineRunning"}');
  await expect(existingClient.users.getAuthenticated()).resolves.toMatchObject({
    data: { login: 'account-a' },
  });
});

it('does not let a late refresh save credentials or reconnect after disconnect', async () => {
  const refreshed = deferred<OAuthCallbackResult>();
  bridge.refreshGitHubOAuth.mockReturnValue(refreshed.promise);
  const view = renderHook(useAuth);
  await settle();
  await act(() => vi.advanceTimersByTimeAsync(55 * 60000));
  expect(bridge.refreshGitHubOAuth).toHaveBeenCalledTimes(1);
  await act(async () => {
    await view.result.current.reset();
  });
  refreshed.resolve({ success: true, ...tokens(), accessToken: 'late-token' });
  await settle();
  expect(disk).toBeNull();
  expect(view.result.current.authState.isAuthenticated).toBe(false);
  expect(storage.save).not.toHaveBeenCalled();
});

it.each(['account-b-refresh', 'refresh-token'])(
  'isolates a pending refresh across disconnect and reconnect with %s',
  async refreshToken => {
    const accountARefresh = deferred<OAuthCallbackResult>();
    const accountBRefresh = deferred<OAuthCallbackResult>();
    bridge.refreshGitHubOAuth
      .mockReturnValueOnce(accountARefresh.promise)
      .mockReturnValueOnce(accountBRefresh.promise);
    const view = renderHook(useAuth);
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(55 * 60000));
    expect(bridge.refreshGitHubOAuth).toHaveBeenCalledWith('refresh-token');

    await act(async () => {
      await view.result.current.reset();
      await view.result.current.startOAuth();
      await callbacks[0]({
        success: true,
        ...tokens(),
        accessToken: 'account-b-access',
        refreshToken,
      });
    });
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(55 * 60000));
    expect(bridge.refreshGitHubOAuth).toHaveBeenCalledTimes(2);
    expect(bridge.refreshGitHubOAuth).toHaveBeenLastCalledWith(refreshToken);

    accountARefresh.resolve({ success: true, ...tokens(), accessToken: 'late-account-a' });
    await settle();
    expect(view.result.current.authState.token).toBe('account-b-access');
    expect(JSON.parse(disk!)).toMatchObject({ accessToken: 'account-b-access', refreshToken });

    // A's finalizer must not evict B's pending refresh; B's next check shares it.
    await act(() => vi.advanceTimersByTimeAsync(5 * 60000));
    expect(bridge.refreshGitHubOAuth).toHaveBeenCalledTimes(2);
    accountBRefresh.resolve({
      success: true,
      ...tokens(),
      accessToken: 'refreshed-account-b',
      refreshToken: 'rotated-account-b-refresh',
    });
    await settle();
    expect(view.result.current.authState.token).toBe('refreshed-account-b');
    expect(JSON.parse(disk!)).toMatchObject({
      accessToken: 'refreshed-account-b',
      refreshToken: 'rotated-account-b-refresh',
    });
  }
);

it('keys a delayed refresh to the caller session rather than the session when it starts', async () => {
  const pause = deferred<void>();
  const oldRefresh = deferred<OAuthCallbackResult>();
  const newRefresh = deferred<OAuthCallbackResult>();
  bridge.refreshGitHubOAuth
    .mockReturnValueOnce(oldRefresh.promise)
    .mockReturnValueOnce(newRefresh.promise);
  const view = renderHook(useAuth);
  await settle();
  pauseNextCallback = pause.promise;
  await act(() => vi.advanceTimersByTimeAsync(55 * 60000));
  expect(bridge.refreshGitHubOAuth).not.toHaveBeenCalled();

  await act(async () => {
    await view.result.current.reset();
    await view.result.current.startOAuth();
    await callbacks[0]({ success: true, ...tokens(), accessToken: 'new-session-access' });
    pause.resolve();
  });
  await settle();
  // Reusing the same token must not share the old session's delayed request.
  await act(() => vi.advanceTimersByTimeAsync(55 * 60000));
  expect(bridge.refreshGitHubOAuth).toHaveBeenCalledTimes(2);
  newRefresh.resolve({ success: true, ...tokens(), accessToken: 'new-session-refreshed' });
  await settle();
  oldRefresh.resolve({ success: true, ...tokens(), accessToken: 'stale-session-access' });
  await settle();
  expect(view.result.current.authState.token).toBe('new-session-refreshed');
  expect(JSON.parse(disk!)).toMatchObject({ accessToken: 'new-session-refreshed' });
});

it('finishes an already-started credential save before deleting it on disconnect', async () => {
  disk = null;
  const write = deferred<boolean>();
  storage.save.mockImplementation(async (_key, value) => {
    await write.promise;
    disk = value;
    return true;
  });
  const view = renderHook(useAuth);
  await settle();
  await act(async () => {
    await view.result.current.startOAuth();
  });
  let approval: unknown;
  act(() => {
    approval = callbacks[0]({ success: true, ...tokens() });
  });
  await settle();
  expect(storage.save).toHaveBeenCalledTimes(1);
  let disconnect!: Promise<void>;
  act(() => {
    disconnect = view.result.current.reset();
  });
  const deletedEarly = storage.remove.mock.calls.length;
  await act(async () => {
    write.resolve(true);
    await disconnect;
    await approval;
  });
  expect(disk).toBeNull();
  expect(deletedEarly).toBe(0);
  expect(view.result.current.authState.isAuthenticated).toBe(false);
});

it('accepts a pending OAuth completion after the initiating view remounts', async () => {
  disk = null;
  const view = renderHook(useAuth);
  await settle();
  await act(async () => {
    await view.result.current.startOAuth();
  });
  view.unmount();
  const next = renderHook(useAuth);
  await settle();
  expect(callbacks).toHaveLength(1);
  await act(async () => {
    await callbacks[0]({ success: true, ...tokens() });
  });
  await settle();
  expect(next.result.current.authState.isAuthenticated).toBe(true);
  expect(JSON.parse(disk!)).toMatchObject({ accessToken: 'access-token' });
});

it('shows deletion failure across remounts and allows retry before another sign-in', async () => {
  storage.remove.mockResolvedValueOnce(false);
  const view = renderHook(useAuth);
  await settle();
  await act(async () => {
    await view.result.current.reset();
  });
  view.unmount();
  const next = renderHook(useAuth);
  await settle();
  expect(next.result.current.authState.isAuthenticated).toBe(false);
  expect(next.result.current.authState.disconnectError).toBeTruthy();
  await act(async () => {
    await next.result.current.startOAuth();
  });
  expect(bridge.startGitHubOAuth).not.toHaveBeenCalled();
  await act(async () => {
    await next.result.current.reset();
  });
  expect(next.result.current.authState.disconnectError).toBeNull();
  expect(disk).toBeNull();
});
