// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAsync } from './useAsync';

describe('useAsync', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns initial state when immediate is false', () => {
    const asyncFn = vi.fn().mockResolvedValue('result');
    const { result } = renderHook(() => useAsync(asyncFn, { immediate: false }));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(asyncFn).not.toHaveBeenCalled();
  });

  it('runs asyncFn on mount when immediate is true and transitions loading', async () => {
    const asyncFn = vi.fn().mockResolvedValue('hello');
    const { result } = renderHook(() => useAsync(asyncFn));

    // Should be loading initially
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe('hello');
    expect(result.current.error).toBeNull();
  });

  it('captures error message when asyncFn rejects', async () => {
    const asyncFn = vi.fn().mockRejectedValue(new Error('something broke'));
    const { result } = renderHook(() => useAsync(asyncFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('something broke');
    expect(result.current.data).toBeNull();
  });

  it('cancels stale requests when execute is called rapidly', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const asyncFn = vi.fn().mockImplementation(
      () =>
        new Promise<string>(resolve => {
          resolvers.push(resolve);
        })
    );

    const { result } = renderHook(() => useAsync(asyncFn, { immediate: false }));

    // Fire two rapid calls
    act(() => {
      result.current.execute();
    });
    act(() => {
      result.current.execute();
    });

    expect(asyncFn).toHaveBeenCalledTimes(2);

    // Resolve first (stale) request — should be ignored
    act(() => {
      resolvers[0]('stale');
    });
    await waitFor(() => {
      expect(result.current.data).toBeNull();
    });

    // Resolve second (current) request
    act(() => {
      resolvers[1]('fresh');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Only the second result should be applied
    expect(result.current.data).toBe('fresh');
  });

  it('passes args through to asyncFn via execute', async () => {
    const asyncFn = vi
      .fn()
      .mockImplementation(async (name: string, count: number) => `${name}-${count}`);

    const { result } = renderHook(() => useAsync(asyncFn, { immediate: false }));

    await act(async () => {
      await result.current.execute('test', 42);
    });

    expect(asyncFn).toHaveBeenCalledWith('test', 42);
    expect(result.current.data).toBe('test-42');
  });

  it('resets state back to initial values', async () => {
    const asyncFn = vi.fn().mockResolvedValue('data');
    const { result } = renderHook(() => useAsync(asyncFn));

    await waitFor(() => {
      expect(result.current.data).toBe('data');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('captures string error when asyncFn rejects with a string', async () => {
    const asyncFn = vi.fn().mockRejectedValue('plain string error');
    const { result } = renderHook(() => useAsync(asyncFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('plain string error');
    expect(result.current.data).toBeNull();
  });

  it('uses generic message when asyncFn rejects with a non-string non-Error', async () => {
    const asyncFn = vi.fn().mockRejectedValue(42);
    const { result } = renderHook(() => useAsync(asyncFn));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('An unexpected error occurred');
    expect(result.current.data).toBeNull();
  });

  it('does not update state after unmount', async () => {
    let resolver: (value: string) => void;
    const asyncFn = vi.fn().mockImplementation(
      () =>
        new Promise<string>(resolve => {
          resolver = resolve;
        })
    );

    const { result, unmount } = renderHook(() => useAsync(asyncFn, { immediate: false }));

    act(() => {
      result.current.execute();
    });

    expect(result.current.loading).toBe(true);

    // Unmount before resolving
    unmount();

    // Resolve after unmount — should not throw
    expect(() => {
      resolver!('late');
    }).not.toThrow();
  });
});
