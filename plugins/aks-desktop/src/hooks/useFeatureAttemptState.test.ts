// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFeatureAttemptState, useFeatureAttemptState } from './useFeatureAttemptState';

// This project's Vitest config does not enable @testing-library/react's
// automatic afterEach cleanup (it only detects a true global `afterEach`,
// which globals:true does not provide), so each renderHook call must be
// unmounted explicitly or state leaks into the next test.
afterEach(cleanup);

describe('createFeatureAttemptState', () => {
  it('start increments and returns a generation', () => {
    const state = createFeatureAttemptState();
    expect(state.start()).toBe(1);
    expect(state.start()).toBe(2);
  });

  it('cancel only succeeds from active', () => {
    const state = createFeatureAttemptState();
    state.start();
    expect(state.cancel()).toBe(true);
    // Already cancelled, so a second cancel should not succeed.
    expect(state.cancel()).toBe(false);
  });

  it('finish rejects a stale generation', () => {
    const state = createFeatureAttemptState();
    const firstGeneration = state.start();
    const secondGeneration = state.start();
    expect(secondGeneration).not.toBe(firstGeneration);

    // A late result for the first (superseded) attempt must not apply.
    expect(state.finish(firstGeneration, 'succeeded')).toBe(false);
    expect(state.is(firstGeneration, 'succeeded')).toBe(false);

    expect(state.finish(secondGeneration, 'succeeded')).toBe(true);
    expect(state.is(secondGeneration, 'succeeded')).toBe(true);
  });

  it('invalidate supersedes an in-flight attempt', () => {
    const state = createFeatureAttemptState();
    const generation = state.start();
    state.invalidate();
    expect(state.finish(generation, 'succeeded')).toBe(false);
    expect(state.is(generation, 'active')).toBe(false);
  });

  it('is matches generation and outcome together', () => {
    const state = createFeatureAttemptState();
    const generation = state.start();
    expect(state.is(generation, 'active')).toBe(true);
    expect(state.is(generation, 'succeeded')).toBe(false);
    expect(state.is(generation + 1, 'active')).toBe(false);
  });
});

describe('useFeatureAttemptState', () => {
  it('returns the same state instance across re-renders', () => {
    const { result, rerender } = renderHook(() => useFeatureAttemptState());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
