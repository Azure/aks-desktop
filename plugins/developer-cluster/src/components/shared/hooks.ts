// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// React bindings for the workflow state and the Setup draft. Both stores replace their frozen state
// on every change, so `useSyncExternalStore` re-renders only after an update. Overview's refreshes,
// when it opens and when Headlamp's cluster list changes, are here too, because they follow the
// workflow state, and so is its Status probe.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSetupDraft, SetupDraft, subscribeSetupDraft } from '../../common/setupDraft';
import { apiServerReady } from '../../native/apiServerProbe';
import { finishedOverviewRefreshes, refreshOverview } from '../../workflow/setup';
import { getWorkflowState, subscribeWorkflow, WorkflowState } from '../../workflow/store';

/**
 * The workflow state; the component re-renders after every update.
 *
 * @returns The current frozen workflow state.
 */
export function useWorkflow(): WorkflowState {
  return useSyncExternalStore(subscribeWorkflow, getWorkflowState);
}

/**
 * The Setup draft; the component re-renders after every change.
 *
 * @returns The current frozen draft.
 */
export function useSetupDraft(): SetupDraft {
  return useSyncExternalStore(subscribeSetupDraft, getSetupDraft);
}

/**
 * Refreshes Overview once when it opens. While another operation runs, such as Setup's checks or
 * Create, the workflow refuses the refresh, so it waits until the operation ends, and skips it when
 * an Overview refresh finished meanwhile, such as the one after a failed Delete. `busy` is the
 * rendered state; the check reads the latest state, which can be newer.
 *
 * @param busy - The rendered state's `busy`; the hook tries again when it changes.
 */
export function useOverviewRefresh(busy: boolean): void {
  const pending = useRef(true);
  // The count when Overview opened: useRef keeps the first render's value.
  const finishedAtOpen = useRef(finishedOverviewRefreshes());
  useEffect(() => {
    if (!pending.current || getWorkflowState().busy) return;
    pending.current = false;
    if (finishedOverviewRefreshes() !== finishedAtOpen.current) return;
    void refreshOverview();
  }, [busy]);
}

/**
 * Refreshes Overview when the names in Headlamp's cluster list change, for example when a cluster
 * created outside the plugin, or by a Create that finished after a page reload, appears. Headlamp
 * refetches the list every 10 seconds while its window is visible. A change while another
 * operation runs, which may have read the list before the change, stays pending and refreshes
 * Overview once that operation ends.
 *
 * @param busy - The rendered state's `busy`; the hook tries again when it changes.
 */
export function useClusterListRefresh(busy: boolean): void {
  const clusters = K8s.useClustersConf();
  const names = clusters ? Object.keys(clusters).sort().join('\n') : null;
  // The names last seen, and whether a change still needs a refresh: useRef keeps both.
  const seen = useRef(names);
  const pending = useRef(false);
  useEffect(() => {
    if (names !== seen.current) {
      seen.current = names;
      pending.current = true;
    }
    if (!pending.current || getWorkflowState().busy) return;
    pending.current = false;
    void refreshOverview();
  }, [names, busy]);
}

/**
 * The Overview Status: `checking` until the first probe of the listed cluster settles, then
 * `active` when the API server answered and `unreachable` when it did not.
 */
export type ApiServerStatus = 'checking' | 'active' | 'unreachable';

/** How long Overview waits after a probe settles before it probes the API server again. */
export const STATUS_PROBE_INTERVAL_MS = 10_000;

/**
 * Probes `/readyz` when the cluster layout opens and whenever the listed cluster changes, then
 * again STATUS_PROBE_INTERVAL_MS after each probe settles, so Status follows an API server that
 * is still starting or has stopped. Probing stops when the layout closes.
 *
 * @param listName - The name AKS Desktop lists the cluster under.
 * @returns `checking` until the first probe settles, then the result of the latest probe.
 */
export function useApiServerStatus(listName: string): ApiServerStatus {
  const [status, setStatus] = useState<ApiServerStatus>('checking');
  useEffect(() => {
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const probe = () => {
      void apiServerReady(listName).then(ready => {
        if (!current) return;
        setStatus(ready ? 'active' : 'unreachable');
        retry = setTimeout(probe, STATUS_PROBE_INTERVAL_MS);
      });
    };
    setStatus('checking');
    probe();
    return () => {
      current = false;
      clearTimeout(retry);
    };
  }, [listName]);
  return status;
}
