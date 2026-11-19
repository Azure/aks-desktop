// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// React bindings for the workflow state and the Setup draft. Both stores replace their frozen state
// on every change, so `useSyncExternalStore` re-renders only after an update.

import { useSyncExternalStore } from 'react';
import { getSetupDraft, SetupDraft, subscribeSetupDraft } from '../../common/setupDraft';
import { getWorkflowState, subscribeWorkflow, WorkflowState } from '../../workflow/store';

export function useWorkflow(): WorkflowState {
  return useSyncExternalStore(subscribeWorkflow, getWorkflowState);
}

export function useSetupDraft(): SetupDraft {
  return useSyncExternalStore(subscribeSetupDraft, getSetupDraft);
}
