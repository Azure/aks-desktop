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

export function useAsync<T>(
  asyncFn: () => Promise<T>,
  options?: { immediate?: true }
): UseAsyncResult<T, []>;

export function useAsync<T, Args extends unknown[]>(
  asyncFn: (...args: Args) => Promise<T>,
  options: { immediate: false }
): UseAsyncResult<T, Args>;

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
  const asyncFnRef = useRef(asyncFn);
  asyncFnRef.current = asyncFn;

  const execute = useCallback(async (...args: Args): Promise<T | null> => {
    const currentRequestId = ++requestIdRef.current;
    if (!mountedRef.current) return null;
    setLoading(true);
    setError(null);

    try {
      const result = await asyncFnRef.current(...args);
      const isCurrent = mountedRef.current && requestIdRef.current === currentRequestId;
      if (isCurrent) {
        setData(result);
        setLoading(false);
      }
      return isCurrent ? result : null;
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
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current++;
    setData(null);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (immediate) {
      execute(...([] as unknown as Args));
    }
    return () => {
      mountedRef.current = false;
      requestIdRef.current++;
    };
  }, [immediate]);

  return { data, loading, error, execute, reset };
}
