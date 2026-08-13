// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const indexMocks = vi.hoisted(() => ({
  beginConsentTransition: vi.fn(),
  isCurrentConsentGeneration: vi.fn(),
  endConsentTransition: vi.fn(),
  emitConsentEvent: vi.fn(),
  flushTelemetry: vi.fn(),
  resetInitAttempted: vi.fn(),
  setTelemetryEnabled: vi.fn(),
}));

vi.mock('./index', () => indexMocks);

import {
  __resetConsentForTests,
  CONSENT_FLUSH_TIMEOUT_MS,
  getConsentEpoch,
  grantConsent,
  revokeConsent,
  subscribeConsentEpoch,
} from './consent';

let nextGen = 1;

beforeEach(() => {
  nextGen = 1;
  indexMocks.beginConsentTransition.mockReset().mockImplementation(() => nextGen++);
  indexMocks.isCurrentConsentGeneration.mockReset().mockReturnValue(true);
  indexMocks.endConsentTransition.mockReset();
  indexMocks.emitConsentEvent.mockReset();
  indexMocks.flushTelemetry.mockReset().mockResolvedValue(undefined);
  indexMocks.resetInitAttempted.mockReset();
  indexMocks.setTelemetryEnabled.mockReset();
  __resetConsentForTests();
});

describe('revokeConsent ordering', () => {
  it('closes the gate before emitting the revoke event, before disabling', async () => {
    const order: string[] = [];
    indexMocks.beginConsentTransition.mockImplementation(() => {
      order.push('begin');
      return 1;
    });
    indexMocks.emitConsentEvent.mockImplementation(() => order.push('emit'));
    indexMocks.flushTelemetry.mockImplementation(async () => {
      order.push('flush');
    });
    indexMocks.setTelemetryEnabled.mockImplementation(() => order.push('disable'));

    await revokeConsent();

    expect(order).toEqual(['begin', 'emit', 'flush', 'disable']);
    expect(indexMocks.emitConsentEvent).toHaveBeenCalledWith('revoked');
    expect(indexMocks.setTelemetryEnabled).toHaveBeenCalledWith(false);
  });

  it('passes the bounded timeout through to flushTelemetry', async () => {
    await revokeConsent();
    expect(indexMocks.flushTelemetry).toHaveBeenCalledWith(CONSENT_FLUSH_TIMEOUT_MS);
  });

  it('ends the transition after disabling', async () => {
    const order: string[] = [];
    indexMocks.setTelemetryEnabled.mockImplementation(() => order.push('disable'));
    indexMocks.endConsentTransition.mockImplementation(() => order.push('end'));

    await revokeConsent();

    expect(order).toEqual(['disable', 'end']);
  });
});

describe('revoke/grant race', () => {
  it('a revoke superseded by a grant leaves telemetry enabled, not dead', async () => {
    // Generation sequence: revoke takes gen 1, grant takes gen 2. The
    // revoke's flush is held open until after the grant has fully
    // completed, then released — simulating the revoke continuation
    // resuming late. isCurrentConsentGeneration reflects "only the most
    // recently begun transition is current."
    let resolveRevokeFlush: () => void = () => {};
    indexMocks.flushTelemetry.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveRevokeFlush = resolve;
        })
    );
    indexMocks.isCurrentConsentGeneration.mockImplementation((gen: number) => gen === nextGen - 1);

    const revokePromise = revokeConsent();

    const grantInitialize = vi.fn().mockResolvedValue(undefined);
    await grantConsent(grantInitialize);

    // Grant completed as generation 2, which is current.
    expect(indexMocks.setTelemetryEnabled).toHaveBeenLastCalledWith(true);
    expect(indexMocks.emitConsentEvent).toHaveBeenLastCalledWith('granted');
    expect(getConsentEpoch()).toBe(1);

    // Now let the stale revoke continuation resume.
    resolveRevokeFlush();
    await revokePromise;

    // The revoke was superseded (gen 1 !== current gen 2): it must NOT have
    // disabled telemetry after the grant completed.
    expect(indexMocks.setTelemetryEnabled).toHaveBeenLastCalledWith(true);
    expect(indexMocks.endConsentTransition).not.toHaveBeenCalledWith(1);
  });
});

describe('grantConsent error handling', () => {
  it('a throwing initialize still completes the transition, not left rejected', async () => {
    const throwingInitialize = vi.fn().mockRejectedValue(new Error('synthetic init failure'));

    await expect(grantConsent(throwingInitialize)).resolves.toBeUndefined();

    expect(indexMocks.emitConsentEvent).toHaveBeenCalledWith('granted');
    expect(indexMocks.endConsentTransition).toHaveBeenCalled();
  });
});

describe('consent epoch', () => {
  it('does not bump the epoch on revoke', async () => {
    await revokeConsent();
    expect(getConsentEpoch()).toBe(0);
  });

  it('bumps the epoch only once a grant completes', async () => {
    expect(getConsentEpoch()).toBe(0);
    await grantConsent(() => undefined);
    expect(getConsentEpoch()).toBe(1);
  });

  it('does not bump the epoch for a superseded grant', async () => {
    indexMocks.isCurrentConsentGeneration.mockReturnValue(false);
    await grantConsent(() => undefined);
    expect(getConsentEpoch()).toBe(0);
  });

  it('notifies subscribers on a completed grant, and stops after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsentEpoch(listener);

    await grantConsent(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await grantConsent(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('consent epoch listener isolation', () => {
  it('one throwing listener does not block another or break the transition', async () => {
    const throwingListener = vi.fn(() => {
      throw new Error('synthetic listener failure');
    });
    const healthyListener = vi.fn();
    subscribeConsentEpoch(throwingListener);
    subscribeConsentEpoch(healthyListener);

    await expect(grantConsent(() => undefined)).resolves.toBeUndefined();

    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(healthyListener).toHaveBeenCalledTimes(1);
    expect(getConsentEpoch()).toBe(1);
  });
});

describe('install ID stability across a consent cycle', () => {
  it('revoking and re-granting consent does not change the install ID', async () => {
    const { __resetInstallIdCacheForTests, getOrCreateInstallId } = await import('./installId');
    __resetInstallIdCacheForTests();

    const before = getOrCreateInstallId();
    await revokeConsent();
    await grantConsent(() => undefined);
    const after = getOrCreateInstallId();

    expect(after).toBe(before);
  });
});
