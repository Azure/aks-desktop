// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Options for the {@link usePolling} hook.
 */
export interface UsePollingOptions<T> {
  /** Whether polling is active. When false, polling stops (state is preserved until next enable cycle). */
  enabled: boolean;
  /** Milliseconds between polls (after each poll completes). */
  intervalMs: number;
  /** Maximum number of polls before timeout. */
  maxPolls: number;
  /**
   * The async function to call each poll cycle.
   * Return the result, or null if no meaningful result yet.
   */
  pollFn: () => Promise<T | null>;
  /**
   * Called with each non-null poll result. Return true to stop polling.
   * If omitted, polling continues until maxPolls or manual stop.
   */
  shouldStop?: (result: T) => boolean;
  /** Called when max polls exceeded. Defaults to setting isTimedOut. */
  onTimeout?: () => void;
}

export interface UsePollingResult<T> {
  data: T | null;
  /** True when polling exceeded maxPolls without shouldStop returning true. */
  isTimedOut: boolean;
  error: string | null;
  stopPolling: () => void;
}

/**
 * Generic polling hook that encapsulates the poll-sleep-repeat pattern.
 *
 * Manages refs for timeout scheduling, poll count, and active flag.
 * Polls sequentially (next poll scheduled only after current completes).
 */
export const usePolling = <T>({
  enabled,
  intervalMs,
  maxPolls,
  pollFn,
  shouldStop,
  onTimeout,
}: UsePollingOptions<T>): UsePollingResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);
  const activeRef = useRef(false);
  const pollingInFlightRef = useRef(false);

  const pollFnRef = useRef(pollFn);
  pollFnRef.current = pollFn;
  const shouldStopRef = useRef(shouldStop);
  shouldStopRef.current = shouldStop;
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const stopPolling = useCallback(() => {
    activeRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      return;
    }

    pollCountRef.current = 0;
    pollingInFlightRef.current = false;
    activeRef.current = true;
    setData(null);
    setIsTimedOut(false);
    setError(null);

    const poll = async () => {
      if (pollingInFlightRef.current) return;
      pollingInFlightRef.current = true;
      try {
        pollCountRef.current++;
        try {
          const result = await pollFnRef.current();
          if (!activeRef.current) return;
          setError(null);

          if (result !== null) {
            setData(result);
            if (shouldStopRef.current?.(result)) {
              stopPolling();
              return;
            }
          }
        } catch (err) {
          if (!activeRef.current) return;
          console.error('Polling error:', err);
          setError(err instanceof Error ? err.message : 'Polling failed');
        }

        if (pollCountRef.current >= maxPolls) {
          stopPolling();
          if (onTimeoutRef.current) {
            onTimeoutRef.current();
          } else {
            setIsTimedOut(true);
          }
          return;
        }

        if (activeRef.current) {
          timeoutRef.current = setTimeout(poll, intervalMs);
        }
      } finally {
        pollingInFlightRef.current = false;
      }
    };

    poll();

    return () => {
      stopPolling();
      pollingInFlightRef.current = false;
    };
  }, [enabled, intervalMs, maxPolls, stopPolling]);

  return { data, isTimedOut, error, stopPolling };
};
