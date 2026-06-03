// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ApplicationInsights } from '@microsoft/applicationinsights-web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitClusterShapeIfReady } from './clusterShape';

let trackEventMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  trackEventMock = vi.fn();
  window.appInsights = { trackEvent: trackEventMock } as unknown as ApplicationInsights;
});

afterEach(() => {
  window.appInsights = undefined;
});

describe('emitClusterShapeIfReady', () => {
  const full = {
    kubernetesVersion: 'v1.29.4',
    nodeCount: 12,
    namespaceCount: 30,
    region: 'eastus',
    aksTier: 'Standard',
  };

  it('emits when all fields present', () => {
    expect(emitClusterShapeIfReady(full)).toBe(true);
    expect(trackEventMock).toHaveBeenCalledWith({
      name: 'headlamp.cluster-shape',
      properties: {
        provider: 'AKS',
        kubernetesMinor: '1.29',
        nodeCountBucket: '6-20',
        namespaceCountBucket: '11-50',
        region: 'eastus',
        aksTier: 'Standard',
      },
    });
  });

  it('returns false (no emission) when kubernetesVersion missing', () => {
    expect(emitClusterShapeIfReady({ ...full, kubernetesVersion: undefined })).toBe(false);
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('returns false when nodeCount missing', () => {
    expect(emitClusterShapeIfReady({ ...full, nodeCount: undefined })).toBe(false);
  });

  it('returns false when namespaceCount missing', () => {
    expect(emitClusterShapeIfReady({ ...full, namespaceCount: undefined })).toBe(false);
  });

  it('returns false when region missing', () => {
    expect(emitClusterShapeIfReady({ ...full, region: undefined })).toBe(false);
  });

  it('returns false when aksTier missing', () => {
    expect(emitClusterShapeIfReady({ ...full, aksTier: undefined })).toBe(false);
  });

  it('sanitizes unknown region to Other', () => {
    emitClusterShapeIfReady({ ...full, region: 'madeup' });
    expect(trackEventMock.mock.calls[0][0].properties.region).toBe('Other');
  });

  it('sanitizes unknown aksTier to Unknown', () => {
    emitClusterShapeIfReady({ ...full, aksTier: 'NewTierName' });
    expect(trackEventMock.mock.calls[0][0].properties.aksTier).toBe('Unknown');
  });
});
