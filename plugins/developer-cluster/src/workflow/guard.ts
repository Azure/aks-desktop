// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Serializes workflow operations: one operation runs at a time. The CLI's own lifecycle lock also
// refuses a second create or delete.

import { classifyFailure, WorkflowFailure } from './failure';
import { getWorkflowState, update, WorkflowState } from './store';

/**
 * Runs `operation` unless another one is running. Resolves true when it completed and false when
 * it was refused or failed; a failure is recorded with the patch from `failed`.
 *
 * @param operation - The operation to run; a rejection is its failure.
 * @param failed - Builds the state patch for the classified failure.
 * @returns A promise of whether the operation completed.
 */
export async function exclusive(
  operation: () => Promise<void>,
  failed: (failure: WorkflowFailure) => Partial<WorkflowState>
): Promise<boolean> {
  if (getWorkflowState().busy) return false;
  update({ busy: true });
  try {
    await operation();
    return true;
  } catch (error) {
    update(failed(classifyFailure(error)));
    return false;
  } finally {
    update({ busy: false });
  }
}
