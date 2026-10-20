// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './usePolling';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('poll-cycle and semantic identity ownership', () => {
  it('rejects an old result/finally across disable and re-enable, even with the same identity', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const poll = vi
      .fn()
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)
      .mockResolvedValue('extra');
    const shouldStop = vi.fn(() => false);
    const view = renderHook(
      ({ enabled }) =>
        usePolling({
          enabled,
          intervalMs: 1000,
          maxPolls: 5,
          pollFn: poll,
          shouldStop,
          resetKey: 'same-session-repo',
        }),
      { initialProps: { enabled: true } }
    );
    view.rerender({ enabled: false });
    view.rerender({ enabled: true });
    a.resolve('stale-a');
    await settle();
    expect(view.result.current.data).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(poll).toHaveBeenCalledTimes(2);
    expect(shouldStop).not.toHaveBeenCalled();
    b.resolve('current-b');
    await settle();
    expect(view.result.current.data).toBe('current-b');
  });

  it('hides old data on a semantic reset while enabled and ignores a late old callback', async () => {
    const pending = deferred<string>();
    const poll = vi
      .fn()
      .mockResolvedValueOnce('account-a-data')
      .mockReturnValueOnce(pending.promise);
    const view = renderHook(
      ({ key }) =>
        usePolling({ enabled: true, intervalMs: 1000, maxPolls: 5, pollFn: poll, resetKey: key }),
      { initialProps: { key: 'a/repo/1' } }
    );
    await settle();
    expect(view.result.current.data).toBe('account-a-data');
    view.rerender({ key: 'b/repo/1' });
    expect(view.result.current.data).toBeNull();
    expect(poll).toHaveBeenCalledTimes(2);
    pending.resolve('account-b-data');
    await settle();
    expect(view.result.current.data).toBe('account-b-data');
  });

  it('does not reset results or restart when only the polling callback changes', async () => {
    const first = vi.fn().mockResolvedValue('existing-progress');
    const second = vi.fn().mockResolvedValue('continued-progress');
    const view = renderHook(
      ({ pollFn }) =>
        usePolling({
          enabled: true,
          intervalMs: 1000,
          maxPolls: 5,
          pollFn,
          resetKey: 'same-session-repo-run',
        }),
      { initialProps: { pollFn: first } }
    );
    await settle();
    view.rerender({ pollFn: second });
    expect(view.result.current.data).toBe('existing-progress');
    expect(second).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(second).toHaveBeenCalledTimes(1);
    expect(view.result.current.data).toBe('continued-progress');
  });

  it('preserves the existing no-key pause and next-enable reset semantics', async () => {
    const pending = deferred<string>();
    const poll = vi.fn().mockResolvedValueOnce('saved').mockReturnValueOnce(pending.promise);
    const view = renderHook(
      ({ enabled }) => usePolling({ enabled, intervalMs: 1000, maxPolls: 5, pollFn: poll }),
      { initialProps: { enabled: true } }
    );
    await settle();
    view.rerender({ enabled: false });
    expect(view.result.current.data).toBe('saved');
    view.rerender({ enabled: true });
    expect(view.result.current.data).toBeNull();
    view.result.current.stopPolling();
    pending.resolve('late');
    await settle();
    expect(view.result.current.data).toBeNull();
  });
});
