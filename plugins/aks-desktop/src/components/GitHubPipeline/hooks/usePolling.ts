// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Options for the {@link usePolling} hook.
 *
 * **Important**: `pollFn` and `shouldStop` must be stabilized by callers
 * via `useCallback` (or be module-level functions). If they change identity
 * on every render, the polling effect will restart each time.
 */
export interface UsePollingOptions<T> {
  /** Whether polling is active. When false, polling stops and state resets. */
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

/**
 * Return type for the {@link usePolling} hook.
 */
export interface UsePollingResult<T> {
  /** Latest non-null result from pollFn. */
  data: T | null;
  /** Whether polling exceeded maxPolls without shouldStop returning true. */
  isTimedOut: boolean;
  /** Error message from the most recent failed poll, or null. */
  error: string | null;
  /** Stops polling manually. */
  stopPolling: () => void;
  /** Triggers an immediate poll outside the normal interval schedule. */
  pollNow: () => void;
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
  const pollRequestedRef = useRef(false);
  const pollImplRef = useRef<(() => Promise<void>) | null>(null);

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

    // Reset state for new polling session
    pollCountRef.current = 0;
    activeRef.current = true;
    setData(null);
    setIsTimedOut(false);
    setError(null);

    const poll = async () => {
      if (pollingInFlightRef.current) return;
      pollingInFlightRef.current = true;
      try {
        pollCountRef.current++;

        if (pollCountRef.current >= maxPolls) {
          stopPolling();
          if (onTimeout) {
            onTimeout();
          } else {
            setIsTimedOut(true);
          }
          return;
        }

        try {
          const result = await pollFn();
          if (!activeRef.current) return;
          setError(null);

          if (result !== null) {
            setData(result);
            if (shouldStop?.(result)) {
              stopPolling();
              return;
            }
          }
        } catch (err) {
          if (!activeRef.current) return;
          console.error('Polling error:', err);
          setError(err instanceof Error ? err.message : 'Polling failed');
        }

        // Schedule next poll only after current one completes.
        // If pollNow was called while we were in-flight, poll immediately.
        if (activeRef.current) {
          const immediate = pollRequestedRef.current;
          pollRequestedRef.current = false;
          timeoutRef.current = setTimeout(poll, immediate ? 0 : intervalMs);
        }
      } finally {
        pollingInFlightRef.current = false;
      }
    };

    pollImplRef.current = poll;
    poll();

    return () => {
      stopPolling();
      pollImplRef.current = null;
    };
  }, [enabled, intervalMs, maxPolls, pollFn, shouldStop, onTimeout, stopPolling]);

  const pollNow = useCallback(() => {
    if (!activeRef.current) return;
    // If a poll is already running, flag it so the next cycle fires immediately.
    if (pollingInFlightRef.current) {
      pollRequestedRef.current = true;
      return;
    }
    // Clear the scheduled timeout so we don't double-poll
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    pollImplRef.current?.();
  }, []);

  return { data, isTimedOut, error, stopPolling, pollNow };
};
