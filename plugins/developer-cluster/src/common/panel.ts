// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The one panel that Overview shows. In order of precedence: a running Create or Delete, and the
// local cluster.

import { WorkflowState } from '../workflow/store';

/**
 * A panel of Overview: `creating` or `deleting` while that operation runs, `loading` until the
 * first refresh ends, `target` for the local cluster and `none` for the landing page.
 */
export type OverviewPanel = 'creating' | 'deleting' | 'loading' | 'target' | 'none';

/**
 * The first panel that applies, in the order above.
 *
 * @param state - The workflow state.
 * @returns The panel Overview shows.
 */
export function overviewPanel(state: WorkflowState): OverviewPanel {
  if (state.createPhase === 'running') return 'creating';
  if (state.deletePhase === 'running') return 'deleting';
  if (!state.overviewInitialized) return 'loading';
  if (state.target !== null) return 'target';
  return 'none';
}
