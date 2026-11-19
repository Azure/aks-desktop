// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// React bindings for the workflow state and the Setup draft. Both stores replace their frozen state
// on every change, so `useSyncExternalStore` re-renders only after an update. Overview's refresh
// when it opens is here too, because it follows the workflow state.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getSetupDraft, SetupDraft, subscribeSetupDraft } from '../../common/setupDraft';
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
