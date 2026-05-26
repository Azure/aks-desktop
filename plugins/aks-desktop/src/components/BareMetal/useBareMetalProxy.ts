// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type BareMetalProxyStatus,
  getBareMetalProxyStatus,
  restartBareMetalProxy,
  startBareMetalProxy,
  stopBareMetalProxy,
} from './proxy';

/** Parameters identifying a BareMetal cluster for proxy management. */
interface BareMetalProxyTarget {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
}

export function didBareMetalProxyDrop(
  previousStatus: BareMetalProxyStatus['status'] | null,
  nextStatus: BareMetalProxyStatus['status']
): boolean {
  return previousStatus === 'running' && (nextStatus === 'stopped' || nextStatus === 'error');
}

/** Return value of the {@link useBareMetalProxy} hook. */
export interface UseBareMetalProxyResult {
  /** Latest proxy status snapshot, or `null` when no BareMetal cluster is selected. */
  proxyStatus: BareMetalProxyStatus | null;
  /** Whether a proxy action (start/stop/restart) is currently in flight. */
  proxyActionLoading: boolean;
  /** User-visible error from the most recent proxy operation. */
  proxyUiError: string;
  /** Whether the proxy appears to have dropped after previously running. */
  proxyDropped: boolean;
  /** Refreshes proxy status by querying the backend. */
  refreshProxyStatus: () => Promise<void>;
  /** Starts the BareMetal proxy for the current cluster. */
  handleProxyStart: () => void;
  /** Stops the BareMetal proxy for the current cluster. */
  handleProxyStop: () => void;
  /** Restarts the BareMetal proxy for the current cluster. */
  handleProxyRestart: () => void;
  /** Resets all proxy state (e.g. when the selected cluster changes). */
  resetProxyState: () => void;
  /** Clears the dropped-proxy alert state. */
  dismissProxyDropped: () => void;
}

/**
 * Manages the lifecycle and polling of an `az connectedk8s proxy` session
 * for BareMetal-connected clusters.
 *
 * @param open - Whether the parent dialog is open.
 * @param target - The BareMetal cluster to manage, or `null` when no BareMetal cluster is selected.
 * @param pollIntervalMs - How often to poll status (default 5000 ms).
 */
export function useBareMetalProxy(
  open: boolean,
  target: BareMetalProxyTarget | null,
  pollIntervalMs = 5000
): UseBareMetalProxyResult {
  const { t } = useTranslation();
  // tRef keeps a stable reference to the latest `t` so callbacks don't need to
  // list `t` in their dependency arrays. The headlamp plugin i18n implementation
  // returns a new `t` function on every render, which would otherwise cause an
  // infinite effect loop: new t → new callback → effect re-runs → state reset →
  // re-render → new t → ...
  const tRef = useRef(t);
  tRef.current = t;
  const [proxyStatus, setProxyStatus] = useState<BareMetalProxyStatus | null>(null);
  const [proxyActionLoading, setProxyActionLoading] = useState(false);
  const [proxyUiError, setProxyUiError] = useState('');
  const [proxyDropped, setProxyDropped] = useState(false);
  const isMountedRef = useRef(true);
  const previousProxyStatusRef = useRef<BareMetalProxyStatus['status'] | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyProxyStatus = useCallback((status: BareMetalProxyStatus) => {
    if (didBareMetalProxyDrop(previousProxyStatusRef.current, status.status)) {
      setProxyDropped(true);
    }
    if (status.status === 'running') {
      setProxyDropped(false);
    }
    previousProxyStatusRef.current = status.status;
    setProxyStatus(status);
  }, []);

  const refreshProxyStatus = useCallback(async () => {
    if (!target) {
      return;
    }

    try {
      const status = await getBareMetalProxyStatus(
        target.subscriptionId,
        target.resourceGroup,
        target.clusterName
      );
      if (isMountedRef.current) {
        applyProxyStatus(status);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setProxyUiError(
          tRef.current('Failed to fetch proxy status: {{message}}', {
            message: err instanceof Error ? err.message : tRef.current('Unknown error'),
          })
        );
      }
    }
    // t is accessed via tRef.current — see comment at top of hook.
  }, [applyProxyStatus, target]);

  const runProxyAction = useCallback(
    async (
      action: (
        subscriptionId: string,
        resourceGroup: string,
        clusterName: string
      ) => Promise<BareMetalProxyStatus>
    ) => {
      if (!target) {
        return;
      }

      setProxyActionLoading(true);
      setProxyUiError('');
      try {
        const result = await action(
          target.subscriptionId,
          target.resourceGroup,
          target.clusterName
        );
        if (isMountedRef.current) {
          applyProxyStatus(result);
          if (!result.success && result.lastError) {
            setProxyUiError(result.lastError);
          }
        }
        await refreshProxyStatus();
      } catch (err) {
        if (isMountedRef.current) {
          setProxyUiError(
            tRef.current('Failed to manage BareMetal proxy: {{message}}', {
              message: err instanceof Error ? err.message : tRef.current('Unknown error'),
            })
          );
        }
      } finally {
        if (isMountedRef.current) {
          setProxyActionLoading(false);
        }
      }
    },
    // t is accessed via tRef.current — see comment at top of hook.
    [applyProxyStatus, target, refreshProxyStatus]
  );

  // Poll proxy status while dialog is open and a BareMetal cluster is targeted.
  useEffect(() => {
    if (!open || !target) {
      setProxyStatus(null);
      setProxyUiError('');
      setProxyDropped(false);
      previousProxyStatusRef.current = null;
      return;
    }

    setProxyStatus(null);
    setProxyUiError('');
    setProxyDropped(false);
    previousProxyStatusRef.current = null;

    refreshProxyStatus();
    const id = window.setInterval(() => {
      refreshProxyStatus();
    }, pollIntervalMs);

    return () => {
      window.clearInterval(id);
    };
  }, [open, target, refreshProxyStatus, pollIntervalMs]);

  const handleProxyStart = useCallback(() => {
    runProxyAction(startBareMetalProxy);
  }, [runProxyAction]);

  const handleProxyStop = useCallback(() => {
    runProxyAction(stopBareMetalProxy);
  }, [runProxyAction]);

  const handleProxyRestart = useCallback(() => {
    runProxyAction(restartBareMetalProxy);
  }, [runProxyAction]);

  const resetProxyState = useCallback(() => {
    setProxyStatus(null);
    setProxyUiError('');
    setProxyDropped(false);
    previousProxyStatusRef.current = null;
  }, []);

  const dismissProxyDropped = useCallback(() => {
    setProxyDropped(false);
  }, []);

  return {
    proxyStatus,
    proxyActionLoading,
    proxyUiError,
    proxyDropped,
    refreshProxyStatus,
    handleProxyStart,
    handleProxyStop,
    handleProxyRestart,
    resetProxyState,
    dismissProxyDropped,
  };
}
