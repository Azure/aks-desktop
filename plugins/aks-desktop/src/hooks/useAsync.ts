// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAsyncOptions {
  /** Whether to run the async function immediately on mount. Defaults to true. */
  immediate?: boolean;
}

export interface UseAsyncResult<T, Args extends unknown[]> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (...args: Args) => Promise<T | null>;
  reset: () => void;
}

// Overload: immediate mode (default) — only zero-arg async functions
export function useAsync<T>(
  asyncFn: () => Promise<T>,
  options?: { immediate?: true }
): UseAsyncResult<T, []>;

// Overload: deferred mode — any arg signature
export function useAsync<T, Args extends unknown[]>(
  asyncFn: (...args: Args) => Promise<T>,
  options: { immediate: false }
): UseAsyncResult<T, Args>;

// Implementation
export function useAsync<T, Args extends unknown[] = []>(
  asyncFn: (...args: Args) => Promise<T>,
  options?: UseAsyncOptions
): UseAsyncResult<T, Args> {
  const { immediate = true } = options ?? {};

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      const currentRequestId = ++requestIdRef.current;
      if (!mountedRef.current) return null;
      setLoading(true);
      setError(null);

      try {
        const result = await asyncFn(...args);
        if (mountedRef.current && requestIdRef.current === currentRequestId) {
          setData(result);
          setLoading(false);
        }
        return mountedRef.current && requestIdRef.current === currentRequestId ? result : null;
      } catch (err) {
        if (mountedRef.current && requestIdRef.current === currentRequestId) {
          console.error('useAsync: async operation failed', err);
          const message =
            err instanceof Error
              ? err.message
              : typeof err === 'string'
              ? err
              : 'An unexpected error occurred';
          setError(message);
          setData(null);
          setLoading(false);
        }
        return null;
      }
    },
    [asyncFn]
  );

  const reset = useCallback(() => {
    requestIdRef.current++;
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (immediate) {
      // Overload signatures enforce Args = [] when immediate is a literal true.
      // Dynamic booleans bypass this — callers using variables should use immediate: false + manual execute().
      execute(...([] as unknown as Args));
    }
    return () => {
      mountedRef.current = false;
      requestIdRef.current++;
    };
  }, [immediate, execute]);

  return { data, loading, error, execute, reset };
}
