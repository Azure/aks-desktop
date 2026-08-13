// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  beginConsentTransition,
  emitConsentEvent,
  endConsentTransition,
  flushTelemetry,
  isCurrentConsentGeneration,
  resetInitAttempted,
  setTelemetryEnabled,
} from './index';

/**
 * Upper bound on how long a revoke waits for in-flight events (including the
 * revoke event itself) to drain before disabling anyway. Losing one consent
 * event to a dead network is strictly better than honouring opt-out late.
 */
export const CONSENT_FLUSH_TIMEOUT_MS = 2000;

let consentEpoch = 0;
const epochListeners = new Set<() => void>();

export function getConsentEpoch(): number {
  return consentEpoch;
}

export function subscribeConsentEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
}

function bumpEpoch(): void {
  consentEpoch += 1;
  for (const listener of epochListeners) {
    try {
      listener();
    } catch {
      // Fail closed. One misbehaving subscriber must not break the others
      // or the transition that notified them.
    }
  }
}

/** Test-only state reset. Do not call from production code. */
export function __resetConsentForTests(): void {
  consentEpoch = 0;
  epochListeners.clear();
}

/**
 * Revoke telemetry consent. Closes the ordinary-event gate FIRST, so no
 * application event can be transmitted between the user opting out and the
 * SDK actually unloading. Emits the revoke event, drains within a bounded
 * timeout, then disables.
 */
export async function revokeConsent(): Promise<void> {
  const gen = beginConsentTransition();
  emitConsentEvent('revoked');
  await flushTelemetry(CONSENT_FLUSH_TIMEOUT_MS);
  if (!isCurrentConsentGeneration(gen)) {
    // Superseded by a grant while the flush was pending. Disabling now
    // would kill the freshly (re-)enabled SDK. Leave state untouched.
    return;
  }
  // setTelemetryEnabled(false) clears pendingEvents and unloads the SDK,
  // but leaves session-derived state such as emittedShapeFor and
  // errorCounts untouched across the opted-out period. The crash marker
  // (workstream 2) and the feature timing map (workstream 3) will need
  // explicit clearing calls added here once they exist, or a later grant
  // would report activity belonging to an opted-out period — this
  // function does not already clear session-derived state for them.
  setTelemetryEnabled(false);
  endConsentTransition(gen);
}

/**
 * Grant telemetry consent. Enables the flag before re-initialising so any
 * event emitted during `initialize` is accepted rather than dropped.
 */
export async function grantConsent(initialize: () => Promise<void> | void): Promise<void> {
  const gen = beginConsentTransition();
  setTelemetryEnabled(true);
  resetInitAttempted();
  try {
    await initialize();
  } catch {
    // Fail closed. A throwing initializer must not leave the gate closed
    // forever — fall through to the generation check and cleanup below.
  }
  if (!isCurrentConsentGeneration(gen)) {
    return;
  }
  emitConsentEvent('granted');
  endConsentTransition(gen);
  bumpEpoch();
}
