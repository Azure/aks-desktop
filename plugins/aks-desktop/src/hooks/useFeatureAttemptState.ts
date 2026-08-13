// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useRef } from 'react';

export type FeatureAttemptOutcome = 'active' | 'cancelled' | 'failed' | 'succeeded';

export interface FeatureAttemptState {
  cancel: () => boolean;
  finish: (
    generation: number,
    outcome: Extract<FeatureAttemptOutcome, 'failed' | 'succeeded'>
  ) => boolean;
  invalidate: () => void;
  is: (generation: number, outcome: FeatureAttemptOutcome) => boolean;
  start: () => number;
}

export function createFeatureAttemptState(): FeatureAttemptState {
  let generation = 0;
  let outcome: FeatureAttemptOutcome = 'active';

  return {
    cancel: () => {
      if (outcome !== 'active') return false;
      outcome = 'cancelled';
      generation += 1;
      return true;
    },
    finish: (attemptGeneration, attemptOutcome) => {
      if (generation !== attemptGeneration || outcome !== 'active') return false;
      outcome = attemptOutcome;
      return true;
    },
    invalidate: () => {
      generation += 1;
    },
    is: (attemptGeneration, attemptOutcome) =>
      generation === attemptGeneration && outcome === attemptOutcome,
    start: () => {
      generation += 1;
      outcome = 'active';
      return generation;
    },
  };
}

/**
 * Lazily instantiates a `FeatureAttemptState` for the lifetime of a
 * component instance, returning the same state object on every render.
 */
export function useFeatureAttemptState(): FeatureAttemptState {
  const attemptStateRef = useRef<FeatureAttemptState | null>(null);
  if (attemptStateRef.current === null) {
    attemptStateRef.current = createFeatureAttemptState();
  }
  return attemptStateRef.current;
}
