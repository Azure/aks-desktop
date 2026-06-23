// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so the vi.mock factories below can reference these mocks.
const aiMocks = vi.hoisted(() => {
  const trackEvent = vi.fn();
  const loadAppInsights = vi.fn();
  const addTelemetryInitializer = vi.fn();
  const ApplicationInsightsCtor = vi.fn().mockImplementation(() => ({
    trackEvent,
    loadAppInsights,
    addTelemetryInitializer,
  }));
  return { trackEvent, loadAppInsights, addTelemetryInitializer, ApplicationInsightsCtor };
});
const { trackEvent, loadAppInsights, addTelemetryInitializer, ApplicationInsightsCtor } = aiMocks;

vi.mock('@microsoft/applicationinsights-web', () => ({
  ApplicationInsights: aiMocks.ApplicationInsightsCtor,
}));

const registerMock = vi.hoisted(() => ({ registerHeadlampEventCallback: vi.fn() }));
const { registerHeadlampEventCallback } = registerMock;
vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const actual = await vi.importActual<any>('@kinvolk/headlamp-plugin/lib');
  return { ...actual, registerHeadlampEventCallback: registerMock.registerHeadlampEventCallback };
});

// Imported AFTER mocks are registered.
import {
  __resetForTests,
  initTelemetry,
  isTelemetryInitialized,
  trackClusterShape,
  trackException,
  trackFeature,
  trackPluginsLoaded,
  trackSessionStart,
} from './index';

const VALID_INSTALL_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_PROPS = {
  appVersion: '1.0.0',
  locale: 'en-US',
  os: 'linux' as const,
  arch: 'x64',
  electronVersion: '32.1.0',
  headlampVersion: '0.30.0',
};
const SHAPE_KEY = '/subscriptions/x/resourceGroups/y/providers/.../clusters/z';
const FULL_SHAPE = {
  kubernetesVersion: 'v1.29.4',
  nodeCount: 5,
  namespaceCount: 10,
  region: 'eastus',
  aksTier: 'Standard',
};

beforeEach(() => {
  trackEvent.mockClear();
  loadAppInsights.mockClear();
  addTelemetryInitializer.mockClear();
  ApplicationInsightsCtor.mockReset();
  ApplicationInsightsCtor.mockImplementation(() => ({
    trackEvent,
    loadAppInsights,
    addTelemetryInitializer,
  }));
  registerHeadlampEventCallback.mockClear();
  __resetForTests();
});

afterEach(() => {
  // Don't call vi.restoreAllMocks(): it would wipe the
  // ApplicationInsightsCtor mockImplementation re-applied in beforeEach.
});

describe('initTelemetry', () => {
  it('constructs AI once when called once', () => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    expect(ApplicationInsightsCtor).toHaveBeenCalledTimes(1);
    expect(loadAppInsights).toHaveBeenCalledTimes(1);
    expect(isTelemetryInitialized()).toBe(true);
  });

  it('is idempotent — second call does not re-construct AI', () => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    expect(ApplicationInsightsCtor).toHaveBeenCalledTimes(1);
    expect(loadAppInsights).toHaveBeenCalledTimes(1);
    expect(registerHeadlampEventCallback).toHaveBeenCalledTimes(1);
  });

  it('emits a session-start event on first init', () => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'headlamp.session-start' })
    );
  });

  it('does not include installId as a property on session-start (lives only as ai.user.id tag)', () => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    const call = trackEvent.mock.calls.find(([e]) => e.name === 'headlamp.session-start');
    expect(call?.[0].properties.installId).toBeUndefined();
  });

  it('fails closed and marks initialized when AI construction throws', () => {
    ApplicationInsightsCtor.mockImplementationOnce(() => {
      throw new Error('bad connection string');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    initTelemetry({
      connectionString: 'bogus',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    // initAttempted stays true so we don't retry on every render.
    expect(isTelemetryInitialized()).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    trackSessionStart(SESSION_PROPS);
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('registers a telemetry initializer that sets ai.user.id to the install UUID', () => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    expect(addTelemetryInitializer).toHaveBeenCalledTimes(1);
    const initializer = addTelemetryInitializer.mock.calls[0][0] as (envelope: {
      tags?: Record<string, unknown>;
    }) => void;

    const fresh: { tags?: Record<string, unknown> } = {};
    initializer(fresh);
    expect(fresh.tags?.['ai.user.id']).toBe(VALID_INSTALL_ID);

    // Overwrites a pre-existing id — install UUID wins over SDK auto-assigned.
    const preset = { tags: { 'ai.user.id': 'someone-else' } };
    initializer(preset);
    expect(preset.tags['ai.user.id']).toBe(VALID_INSTALL_ID);
  });
});

describe('track* before init', () => {
  it.each([
    ['trackSessionStart', () => trackSessionStart(SESSION_PROPS)],
    ['trackFeature', () => trackFeature({ feature: 'headlamp.logs', status: 'open' })],
    ['trackClusterShape', () => trackClusterShape(SHAPE_KEY, FULL_SHAPE)],
    ['trackException', () => trackException('Error')],
    [
      'trackPluginsLoaded',
      () =>
        trackPluginsLoaded({
          totalCount: 1,
          enabledCount: 1,
          knownEnabledIds: ['aks-desktop'],
          thirdPartyCount: 0,
        }),
    ],
  ])('%s is a silent no-op when ai is null', (_name, fn) => {
    expect(fn).not.toThrow();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe('envelope name closure', () => {
  it('only emits the 5 known envelope names across the typed helpers', () => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    trackEvent.mockClear();

    trackFeature({ feature: 'headlamp.logs', status: 'open' });
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    trackException('Error');
    trackPluginsLoaded({
      totalCount: 1,
      enabledCount: 1,
      knownEnabledIds: ['aks-desktop'],
      thirdPartyCount: 0,
    });

    const names = new Set(trackEvent.mock.calls.map(([envelope]) => envelope.name));
    expect(names).toEqual(
      new Set([
        'headlamp.feature',
        'headlamp.cluster-shape',
        'headlamp.exception',
        'headlamp.plugins-loaded',
      ])
    );
  });
});

describe('trackClusterShape null-guard', () => {
  beforeEach(() => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    trackEvent.mockClear();
  });

  it('emits when all 5 fields are present', () => {
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'headlamp.cluster-shape' })
    );
  });

  it.each(['kubernetesVersion', 'nodeCount', 'namespaceCount', 'region', 'aksTier'] as const)(
    'drops when %s is null',
    field => {
      trackClusterShape(SHAPE_KEY, { ...FULL_SHAPE, [field]: null });
      expect(trackEvent).not.toHaveBeenCalled();
    }
  );

  it.each(['kubernetesVersion', 'nodeCount', 'namespaceCount', 'region', 'aksTier'] as const)(
    'drops when %s is undefined',
    field => {
      trackClusterShape(SHAPE_KEY, { ...FULL_SHAPE, [field]: undefined });
      expect(trackEvent).not.toHaveBeenCalled();
    }
  );

  it.each(['kubernetesVersion', 'region', 'aksTier'] as const)(
    'drops when string field %s is empty',
    field => {
      trackClusterShape(SHAPE_KEY, { ...FULL_SHAPE, [field]: '' });
      expect(trackEvent).not.toHaveBeenCalled();
    }
  );

  it('keeps nodeCount=0 and namespaceCount=0 (numeric zero is valid data, not missing)', () => {
    trackClusterShape(SHAPE_KEY, { ...FULL_SHAPE, nodeCount: 0, namespaceCount: 0 });
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'headlamp.cluster-shape' })
    );
  });
});

describe('trackClusterShape dedupe', () => {
  beforeEach(() => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    trackEvent.mockClear();
  });

  it('emits once per dedupeKey, suppresses repeats', () => {
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  it('emits separately for distinct dedupeKeys', () => {
    trackClusterShape('cluster-a', FULL_SHAPE);
    trackClusterShape('cluster-b', FULL_SHAPE);
    expect(trackEvent).toHaveBeenCalledTimes(2);
  });

  it('does not mark dedupeKey as seen when fields are missing (so a later valid call still fires)', () => {
    trackClusterShape(SHAPE_KEY, { ...FULL_SHAPE, region: null });
    expect(trackEvent).not.toHaveBeenCalled();
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  it('does not mark dedupeKey as seen when called before init (so post-init call still fires)', () => {
    __resetForTests();
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    expect(trackEvent).not.toHaveBeenCalled();

    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    trackEvent.mockClear();
    trackClusterShape(SHAPE_KEY, FULL_SHAPE);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });
});

describe('trackFeature allowlist', () => {
  beforeEach(() => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    trackEvent.mockClear();
  });

  it('emits for allowlisted feature types', () => {
    trackFeature({ feature: 'headlamp.logs', status: 'open' });
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'headlamp.feature',
        properties: expect.objectContaining({ feature: 'headlamp.logs', status: 'open' }),
      })
    );
  });

  it('drops events with non-allowlisted feature types', () => {
    trackFeature({ feature: 'cluster:my-prod', status: 'open' });
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('sanitizes status field to known enum', () => {
    trackFeature({ feature: 'headlamp.logs', status: 'cluster:my-prod' });
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ status: 'unknown' }),
      })
    );
  });

  it('preserves the "Multiple" resourceKind sentinel (not clamped to CustomResource)', () => {
    // setup.ts:extractKindFromPayload returns 'Multiple' for heterogeneous
    // plural-resource events. trackFeature must not re-sanitize that to
    // 'CustomResource'.
    trackFeature({
      feature: 'headlamp.delete-resources',
      status: 'confirmed',
      resourceKind: 'Multiple',
    });
    expect(trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({ resourceKind: 'Multiple' }),
      })
    );
  });
});

describe('error swallowing', () => {
  it('does not propagate when ai.trackEvent throws', () => {
    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: VALID_INSTALL_ID,
      sessionProps: SESSION_PROPS,
    });
    trackEvent.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => trackException('Error')).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[aksd-telemetry]'),
      expect.anything(),
      expect.anything()
    );
  });
});
