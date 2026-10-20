// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UsePollingOptions<T> {
  /** Disabling preserves state until the next enable cycle. */
  enabled: boolean;
  intervalMs: number;
  maxPolls: number;
  pollFn: () => Promise<T | null>;
  shouldStop?: (result: T) => boolean;
  onTimeout?: () => void;
  /** Stable resource/session identity, never token or callback identity. */
  resetKey?: string;
}
export interface UsePollingResult<T> {
  data: T | null;
  isTimedOut: boolean;
  error: string | null;
  stopPolling: () => void;
}
function initial<T>(resetKey: string | undefined) {
  return { resetKey, data: null as T | null, isTimedOut: false, error: null as string | null };
}

/** Sequential polling, with local ownership for every effect cycle. */
export const usePolling = <T>({
  enabled,
  intervalMs,
  maxPolls,
  pollFn,
  shouldStop,
  onTimeout,
  resetKey,
}: UsePollingOptions<T>): UsePollingResult<T> => {
  const [state, setState] = useState(() => initial<T>(resetKey));
  const latest = useRef({ enabled, resetKey });
  latest.current = { enabled, resetKey };
  const cycleRef = useRef<symbol | null>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const pollFnRef = useRef(pollFn);
  pollFnRef.current = pollFn;
  const shouldStopRef = useRef(shouldStop);
  shouldStopRef.current = shouldStop;
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  const stopPolling = useCallback(() => stopRef.current(), []);

  useEffect(() => {
    if (!enabled) return;
    const cycle = Symbol('poll-cycle');
    cycleRef.current = cycle;
    let active = true;
    let count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const belongs = () =>
      cycleRef.current === cycle && latest.current.enabled && latest.current.resetKey === resetKey;
    const current = () => active && belongs();
    const stop = () => {
      active = false;
      clearTimeout(timer);
    };
    stopRef.current = stop;
    setState(previous => (belongs() ? initial<T>(resetKey) : previous));

    const poll = async () => {
      if (!current()) return;
      count++;
      try {
        const result = await pollFnRef.current();
        if (!current()) return;
        setState(previous =>
          belongs() ? { ...previous, error: null, data: result ?? previous.data } : previous
        );
        if (result !== null && shouldStopRef.current?.(result)) {
          stop();
          return;
        }
      } catch (error) {
        if (!current()) return;
        // Octokit error objects can contain Authorization in request/cause metadata.
        const message = error instanceof Error ? error.message : 'Polling failed';
        console.error('Polling error:', message);
        setState(previous => (belongs() ? { ...previous, error: message } : previous));
      }
      if (!current()) return;
      if (count >= maxPolls) {
        if (onTimeoutRef.current) onTimeoutRef.current();
        else setState(previous => (belongs() ? { ...previous, isTimedOut: true } : previous));
        stop();
        return;
      }
      timer = setTimeout(poll, intervalMs);
    };
    void poll();
    return stop;
  }, [enabled, intervalMs, maxPolls, resetKey]);

  const visible = state.resetKey === resetKey ? state : initial<T>(resetKey);
  return { data: visible.data, isTimedOut: visible.isTimedOut, error: visible.error, stopPolling };
};
