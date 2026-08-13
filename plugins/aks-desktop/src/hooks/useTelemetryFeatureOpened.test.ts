// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockTrackAksFeature = vi.hoisted(() => vi.fn());

vi.mock('../telemetry/aksFeature', () => ({ trackAksFeature: mockTrackAksFeature }));

import { useTelemetryFeatureOpened } from './useTelemetryFeatureOpened';

describe('useTelemetryFeatureOpened', () => {
  beforeEach(() => vi.clearAllMocks());

  test('emits one opened event for the mounted surface', () => {
    const { rerender } = renderHook(() => useTelemetryFeatureOpened('aksd.cluster-add'));

    rerender();

    expect(mockTrackAksFeature).toHaveBeenCalledTimes(1);
    expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.cluster-add', 'opened');
  });
});
