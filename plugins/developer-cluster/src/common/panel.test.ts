// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, test } from 'vitest';
import { WorkflowState } from '../workflow/store';
import { overviewPanel } from './panel';

function state(patch: Partial<WorkflowState> = {}): WorkflowState {
  return {
    busy: false,
    overviewInitialized: false,
    windowsX64: undefined,
    environment: null,
    versions: null,
    target: null,
    refreshFailure: null,
    createPhase: 'idle',
    createFailure: null,
    deletePhase: 'idle',
    deleteFailure: null,
    ...patch,
  };
}

describe('overviewPanel', () => {
  test('waits for initial cluster discovery before showing the new-cluster landing page', () => {
    expect(overviewPanel(state())).toBe('loading');
    expect(overviewPanel(state({ overviewInitialized: true }))).toBe('none');
  });

  test('shows a discovered cluster after initialization', () => {
    expect(
      overviewPanel(
        state({
          overviewInitialized: true,
          target: {
            distribution: 'K8s',
            name: 'developer-cluster',
            contextName: 'developer-cluster',
            listName: 'developer-cluster',
            kubernetesVersion: 'v1.36.5',
            image: 'Ubuntu-24.04',
          },
        })
      )
    ).toBe('target');
  });
});
