// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockTrackFeature = vi.hoisted(() => vi.fn());

vi.mock('./index', () => ({ trackFeature: mockTrackFeature }));

import { trackAksFeature } from './aksFeature';

describe('trackAksFeature', () => {
  beforeEach(() => vi.clearAllMocks());

  test('forwards an allowlisted AKS lifecycle event', () => {
    trackAksFeature('aksd.namespace-create', 'started');
    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.namespace-create',
      status: 'started',
    });
  });

  test('synchronously protects callers from telemetry failures', () => {
    // Real SDK transport failure behavior is covered by telemetry/index.test.ts.
    mockTrackFeature.mockImplementationOnce(() => {
      throw new Error('transport failure');
    });

    expect(() => trackAksFeature('aksd.project-delete', 'failed')).not.toThrow();
  });
});
