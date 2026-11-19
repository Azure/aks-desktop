// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLLING_INTERVAL_MS } from '../constants';
import { usePRPolling } from './usePRPolling';

const mocks = vi.hoisted(() => ({
  getPullRequest: vi.fn(),
  getStatusChecks: vi.fn(),
}));
vi.mock('../../../utils/github/github-api', () => mocks);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const octokit = {} as Octokit;
const open = { state: 'open', merged: false, mergeable: true, headSha: 'head' };
const merged = { ...open, state: 'closed', merged: true };

describe('usePRPolling PR isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.getPullRequest.mockResolvedValue(open);
    mocks.getStatusChecks.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('hides the old merged PR while disabled and when a replacement PR starts polling', async () => {
    mocks.getPullRequest.mockResolvedValueOnce(merged);
    const { result, rerender } = renderHook(
      ({ number, enabled }) => usePRPolling(octokit, 'owner', 'repo', number, enabled),
      { initialProps: { number: 1, enabled: true } }
    );
    await act(async () => {});
    expect(result.current.isMerged).toBe(true);

    rerender({ number: 1, enabled: false });
    expect(result.current.isMerged).toBe(false);
    expect(result.current.prStatus).toBeNull();
    const replacement = deferred<typeof open>();
    mocks.getPullRequest.mockReturnValueOnce(replacement.promise);
    rerender({ number: 2, enabled: true });
    expect(result.current.isMerged).toBe(false);
    expect(result.current.prStatus).toBeNull();
    await act(async () => replacement.resolve(open));
    expect(result.current.prStatus?.state).toBe('open');
    expect(mocks.getPullRequest).toHaveBeenLastCalledWith(octokit, 'owner', 'repo', 2);
  });

  it('ignores an out-of-order old merge without stopping the replacement PR polling', async () => {
    const old = deferred<typeof merged>();
    const replacement = deferred<typeof open>();
    mocks.getPullRequest.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const { result, rerender } = renderHook(
      ({ number }) => usePRPolling(octokit, 'owner', 'repo', number, true),
      { initialProps: { number: 1 } }
    );
    rerender({ number: 2 });
    await act(async () => replacement.resolve(open));
    await act(async () => old.resolve(merged));
    expect(result.current.isMerged).toBe(false);
    expect(result.current.prStatus?.state).toBe('open');
    await act(async () => vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS));
    expect(mocks.getPullRequest).toHaveBeenCalledTimes(3);
    expect(mocks.getPullRequest).toHaveBeenLastCalledWith(octokit, 'owner', 'repo', 2);
  });

  it('ignores old status checks and errors after changing repository with the same PR number', async () => {
    const checks = deferred<[]>();
    mocks.getStatusChecks.mockReturnValueOnce(checks.promise);
    const { result, rerender } = renderHook(
      ({ repo }) => usePRPolling(octokit, 'owner', repo, 1, true),
      { initialProps: { repo: 'old' } }
    );
    await act(async () => {});
    mocks.getPullRequest.mockResolvedValueOnce(merged);
    rerender({ repo: 'new' });
    await act(async () => {});
    expect(result.current.isMerged).toBe(true);
    await act(async () => checks.resolve([]));
    expect(result.current.isMerged).toBe(true);
    expect(result.current.statusChecks).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('does not expose errors from a superseded request', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const old = deferred<typeof open>();
      mocks.getPullRequest.mockReturnValueOnce(old.promise);
      const { result, rerender } = renderHook(
        ({ number }) => usePRPolling(octokit, 'owner', 'repo', number, true),
        { initialProps: { number: 1 } }
      );
      rerender({ number: 2 });
      await act(async () => {});
      await act(async () => old.reject(new Error('old request failed')));
      expect(result.current.error).toBeNull();
      expect(result.current.prStatus?.state).toBe('open');
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('logs active-session PR polling errors for diagnostics', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failure = new Error('rate limit exceeded');
      mocks.getPullRequest.mockRejectedValueOnce(failure);
      const { result } = renderHook(() => usePRPolling(octokit, 'owner', 'repo', 1, true));
      await act(async () => {});
      expect(result.current.error).toBe('rate limit exceeded');
      expect(errorSpy).toHaveBeenCalledWith('Polling error:', failure);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('stops polling once the PR is merged or closed without merging', async () => {
    mocks.getPullRequest.mockResolvedValueOnce(open).mockResolvedValueOnce(merged);
    const { result } = renderHook(() => usePRPolling(octokit, 'owner', 'repo', 1, true));
    await act(async () => {});
    expect(result.current.isMerged).toBe(false);
    expect(result.current.isClosed).toBe(false);

    await act(async () => vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS));
    expect(result.current.isMerged).toBe(true);
    expect(mocks.getPullRequest).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 3));
    expect(mocks.getPullRequest).toHaveBeenCalledTimes(2);

    mocks.getPullRequest.mockResolvedValueOnce({
      state: 'closed' as const,
      merged: false,
      mergeable: null,
      headSha: 'abc',
    });
    const closed = renderHook(() => usePRPolling(octokit, 'owner', 'repo', 2, true));
    await act(async () => {});
    expect(closed.result.current.isClosed).toBe(true);
    expect(closed.result.current.isMerged).toBe(false);

    await act(async () => vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 3));
    expect(mocks.getPullRequest).toHaveBeenCalledTimes(3);
  });

  it('sets isTimedOut and stops polling at PR_POLLING_MAX_POLLS, then clears it on target change', async () => {
    const { PR_POLLING_MAX_POLLS } = await import('../constants');
    mocks.getPullRequest.mockResolvedValue(open);
    const { result, rerender } = renderHook(
      ({ number }) => usePRPolling(octokit, 'owner', 'repo', number, true),
      { initialProps: { number: 1 } }
    );
    await act(async () => {});
    for (let i = 1; i < PR_POLLING_MAX_POLLS; i++) {
      expect(result.current.isTimedOut).toBe(false);
      await act(async () => vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS));
    }
    expect(result.current.isTimedOut).toBe(true);
    expect(mocks.getPullRequest).toHaveBeenCalledTimes(PR_POLLING_MAX_POLLS);

    await act(async () => vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 2));
    expect(mocks.getPullRequest).toHaveBeenCalledTimes(PR_POLLING_MAX_POLLS);

    rerender({ number: 2 });
    expect(result.current.isTimedOut).toBe(false);
    await act(async () => {});
    expect(result.current.isTimedOut).toBe(false);
  });
});
