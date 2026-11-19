// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The one panel that Overview shows. In order of precedence: a running Create or Delete, and the
// local cluster.

import { WorkflowState } from '../workflow/store';

export type OverviewPanel = 'creating' | 'deleting' | 'loading' | 'target' | 'none';

/** The first panel that applies, in the order above. */
export function overviewPanel(state: WorkflowState): OverviewPanel {
  if (state.createPhase === 'running') return 'creating';
  if (state.deletePhase === 'running') return 'deleting';
  if (!state.overviewInitialized) return 'loading';
  if (state.target !== null) return 'target';
  return 'none';
}
