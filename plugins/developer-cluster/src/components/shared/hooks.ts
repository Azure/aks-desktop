// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// React bindings for the workflow state and the Setup draft. Both stores replace their frozen state
// on every change, so `useSyncExternalStore` re-renders only after an update. Overview's refresh
// when it opens is here too, because it follows the workflow state, and so is its Status probe.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSetupDraft, SetupDraft, subscribeSetupDraft } from '../../common/setupDraft';
import { apiServerReady } from '../../native/apiServerProbe';
import { finishedOverviewRefreshes, refreshOverview } from '../../workflow/setup';
import { getWorkflowState, subscribeWorkflow, WorkflowState } from '../../workflow/store';

export function useWorkflow(): WorkflowState {
  return useSyncExternalStore(subscribeWorkflow, getWorkflowState);
}

export function useSetupDraft(): SetupDraft {
  return useSyncExternalStore(subscribeSetupDraft, getSetupDraft);
}

/**
 * Refreshes Overview once when it opens. While another operation runs, such as Setup's checks or
 * Create, the workflow refuses the refresh, so it waits until the operation ends, and skips it when
 * an Overview refresh finished meanwhile, such as the one after a failed Delete. `busy` is the
 * rendered state; the check reads the latest state, which can be newer.
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

export type ApiServerStatus = 'checking' | 'active' | 'unreachable';

/** How long Overview waits to probe again after the API server did not answer. */
export const STATUS_RETRY_MS = 10_000;

/**
 * Probes `/readyz` when the cluster layout opens and whenever the listed cluster changes, and
 * again every STATUS_RETRY_MS until the API server answers, for example while it is still
 * starting. Probing stops when the layout closes.
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
        if (!ready) retry = setTimeout(probe, STATUS_RETRY_MS);
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
