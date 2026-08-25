// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Every other test mocks one side of the consent/index seam: consent.test.ts
// mocks `./index` wholesale, and index.test.ts never composes with
// `consent.ts`. This file composes the REAL consent.ts against the REAL
// index.ts, mocking only the App Insights SDK transport (the same
// vi.hoisted pattern index.test.ts uses), and asserts on the event names
// that actually reach that transport across a full revoke -> grant cycle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aiMocks = vi.hoisted(() => {
  const trackEvent = vi.fn();
  const loadAppInsights = vi.fn();
  const addTelemetryInitializer = vi.fn();
  const unload = vi.fn();
  const config: Record<string, unknown> = {};
  const context = { location: {}, user: {} };
  const ApplicationInsightsCtor = vi.fn().mockImplementation(() => ({
    trackEvent,
    loadAppInsights,
    addTelemetryInitializer,
    unload,
    config,
    context,
  }));
  return {
    trackEvent,
    loadAppInsights,
    addTelemetryInitializer,
    unload,
    config,
    context,
    ApplicationInsightsCtor,
  };
});
const {
  trackEvent,
  loadAppInsights,
  addTelemetryInitializer,
  unload,
  config,
  context,
  ApplicationInsightsCtor,
} = aiMocks;

vi.mock('@microsoft/applicationinsights-web', () => ({
  ApplicationInsights: aiMocks.ApplicationInsightsCtor,
}));

const registerMock = vi.hoisted(() => ({ registerHeadlampEventCallback: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const actual = await vi.importActual<any>('@kinvolk/headlamp-plugin/lib');
  return { ...actual, registerHeadlampEventCallback: registerMock.registerHeadlampEventCallback };
});

// Imported AFTER mocks are registered. Both the orchestrator (consent.ts)
// and the producers/gate (index.ts) are real — nothing under test here is
// mocked.
import { grantConsent, revokeConsent } from './consent';
import { __resetForTests, initTelemetry, setTelemetryEnabled, trackFeature } from './index';

const VALID_INSTALL_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_PROPS = {
  appVersion: '1.0.0',
  locale: 'en-US',
  os: 'linux' as const,
  arch: 'x64',
  electronVersion: '32.1.0',
  headlampVersion: '0.30.0',
};

function realInitialize(): void {
  initTelemetry({
    connectionString: 'InstrumentationKey=test',
    installId: VALID_INSTALL_ID,
    sessionProps: SESSION_PROPS,
  });
}

function eventNames(): string[] {
  return trackEvent.mock.calls.map(([envelope]) => envelope.name);
}

beforeEach(() => {
  trackEvent.mockClear();
  loadAppInsights.mockClear();
  addTelemetryInitializer.mockClear();
  unload.mockClear();
  for (const key of Object.keys(config)) delete config[key];
  ApplicationInsightsCtor.mockReset();
  ApplicationInsightsCtor.mockImplementation(() => ({
    trackEvent,
    loadAppInsights,
    addTelemetryInitializer,
    unload,
    config,
    context,
  }));
  context.location = {};
  context.user = {};
  registerMock.registerHeadlampEventCallback.mockClear();
  __resetForTests();
  setTelemetryEnabled(true);
  realInitialize();
  trackEvent.mockClear();
});

afterEach(() => {
  // Don't call vi.restoreAllMocks(): it would wipe the ApplicationInsightsCtor
  // mockImplementation re-applied in beforeEach.
});

describe('consent <-> index integration: revoke -> grant cycle', () => {
  it('revoke delivers the revoked event and suppresses an ordinary event during the transition', async () => {
    const revokePromise = revokeConsent();
    // An ordinary event fired mid-transition (gate closed by beginConsentTransition)
    // must not reach the transport.
    trackFeature({ feature: 'headlamp.logs', status: 'opened' });
    await revokePromise;

    expect(eventNames()).toContain('headlamp.telemetry-consent');
    expect(eventNames()).not.toContain('headlamp.feature');
    const consentCall = trackEvent.mock.calls.find(
      ([e]) => e.name === 'headlamp.telemetry-consent'
    );
    expect(consentCall?.[0].properties.consent).toBe('revoked');
  });

  it('grant delivers both session-start and the granted consent event', async () => {
    // Simulate a real disable (as revokeConsent would have left things),
    // then grant. `initialize` here is the real initTelemetry, exactly as
    // TelemetryBoot wires it up.
    await revokeConsent();
    trackEvent.mockClear();

    await grantConsent(() => {
      realInitialize();
    });

    // This is the assertion that would fail before the session-start fix:
    // grantConsent closes the gate via beginConsentTransition before calling
    // initialize, and initTelemetry's trackSessionStart used to route
    // through the gated `emit`, so it was dropped every time. With
    // trackSessionStart routed through emitInternal (bypassing the gate,
    // the same carve-out emitConsentEvent already takes), it reaches the
    // transport even while the gate is still closed during initialize().
    expect(eventNames()).toContain('headlamp.session-start');
    expect(eventNames()).toContain('headlamp.telemetry-consent');
    const consentCall = trackEvent.mock.calls.find(
      ([e]) => e.name === 'headlamp.telemetry-consent'
    );
    expect(consentCall?.[0].properties.consent).toBe('granted');
  });
});
