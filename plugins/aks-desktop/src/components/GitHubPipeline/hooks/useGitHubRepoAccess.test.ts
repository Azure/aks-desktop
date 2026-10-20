// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubRepo } from '../../../types/github';
import { createSessionOctokit } from '../../../utils/github/github-session-client';
import { useGitHubRepoAccess } from './useGitHubRepoAccess';

const auth = vi.hoisted(() => ({
  sessionVersion: 1,
  accessToken: 'account-a-token',
  usable: true,
}));
vi.mock('../../../utils/github/github-session', () => ({
  isGitHubSessionCurrent: (version: number) => auth.sessionVersion === version && auth.usable,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const repo: GitHubRepo = { owner: 'owner', repo: 'repository', defaultBranch: 'main' };
const response = (status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { default_branch: 'main', full_name: 'owner/repository' }
        : { message: 'private-server-error' }
    ),
    { status, headers: { 'content-type': 'application/json' } }
  );
beforeEach(() => {
  Object.assign(auth, { sessionVersion: 1, accessToken: 'account-a-token', usable: true });
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('current-session repository access', () => {
  it.each([503, 403])(
    'offers a read-only retry after transient HTTP %s without changing the session',
    async status => {
      const failure = new Response('{"message":"unavailable"}', {
        status,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      });
      const fetcher = vi.fn().mockResolvedValueOnce(failure).mockResolvedValueOnce(response());
      vi.stubGlobal('fetch', fetcher);
      const client = createSessionOctokit(1, () => auth);
      const view = renderHook(() => useGitHubRepoAccess(client, repo, 1));
      await settle();
      expect(view.result.current.status).toBe('checking');
      expect(view.result.current.error).toBeTruthy();
      act(() => view.result.current.retry());
      await settle();
      expect(view.result.current.status).toBe('granted');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(auth.sessionVersion).toBe(1);
    }
  );

  it('retains readiness and avoids redundant access reads on token rotation', async () => {
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetcher);
    const client = createSessionOctokit(1, () => auth);
    const view = renderHook(() => useGitHubRepoAccess(client, repo, 1));
    await settle();
    expect(view.result.current.status).toBe('granted');
    auth.accessToken = 'rotated-token';
    view.rerender();
    expect(view.result.current.status).toBe('granted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never publishes account A access into account B, and denies B without raw error data', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
    const clientA = createSessionOctokit(1, () => auth);
    const view = renderHook(({ client, version }) => useGitHubRepoAccess(client, repo, version), {
      initialProps: { client: clientA, version: 1 },
    });
    await settle();
    Object.assign(auth, { sessionVersion: 2, accessToken: 'account-b-token' });
    view.rerender({ client: createSessionOctokit(2, () => auth), version: 2 });
    expect(view.result.current.status).toBe('checking');
    a.resolve(response());
    await settle();
    expect(view.result.current.status).toBe('checking');
    b.resolve(response(403));
    await settle();
    expect(view.result.current.status).toBe('denied');
    expect(view.result.current.error).not.toContain('private-server-error');
  });

  it('hides readiness without a usable client and preserves its identity through a same-session pause', async () => {
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetcher);
    const client = createSessionOctokit(1, () => auth);
    const view = renderHook(
      ({ available }) => useGitHubRepoAccess(available ? client : null, repo, 1),
      { initialProps: { available: true } }
    );
    await settle();
    expect(view.result.current.status).toBe('granted');
    auth.usable = false;
    view.rerender({ available: false });
    expect(view.result.current.status).toBe('none');
    auth.usable = true;
    view.rerender({ available: true });
    expect(view.result.current.status).toBe('granted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
