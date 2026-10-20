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
  vi.doMock('react', () => React);
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
