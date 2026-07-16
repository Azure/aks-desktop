// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { HeadlampEvent } from '@kinvolk/headlamp-plugin/lib/redux/headlampEventSlice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so the vi.mock factories below can reference these mocks.
const registerMock = vi.hoisted(() => ({ registerHeadlampEventCallback: vi.fn() }));
const { registerHeadlampEventCallback } = registerMock;
vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const actual = await vi.importActual<any>('@kinvolk/headlamp-plugin/lib');
  return { ...actual, registerHeadlampEventCallback: registerMock.registerHeadlampEventCallback };
});

// Mock index.ts track* so we can observe what setup forwards.
const indexMocks = vi.hoisted(() => ({
  trackFeature: vi.fn(),
  trackPluginsLoaded: vi.fn(),
}));
const { trackFeature, trackPluginsLoaded } = indexMocks;
vi.mock('./index', () => ({
  trackFeature: indexMocks.trackFeature,
  trackPluginsLoaded: indexMocks.trackPluginsLoaded,
}));

import {
  __resetReduxRegistrationForTests,
  extractKindFromPayload,
  registerReduxCallback,
  TELEMETRY_EVENT_ALLOWLIST,
} from './setup';

beforeEach(() => {
  trackFeature.mockClear();
  trackPluginsLoaded.mockClear();
  registerHeadlampEventCallback.mockClear();
  __resetReduxRegistrationForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TELEMETRY_EVENT_ALLOWLIST', () => {
  // Snapshot — forces any addition to be reviewed alongside the privacy posture.
  it('matches the documented plugin-owned allowlist verbatim', () => {
    expect([...TELEMETRY_EVENT_ALLOWLIST].sort()).toEqual(
      [
        'headlamp.create-resource',
        'headlamp.delete-resource',
        'headlamp.delete-resources',
        'headlamp.details-view',
        'headlamp.edit-resource',
        'headlamp.list-view',
        'headlamp.logs',
        'headlamp.object-events',
        'headlamp.plugin-loading-error',
        'headlamp.plugins-loaded',
        'headlamp.pod-attach',
        'headlamp.restart-resource',
        'headlamp.restart-resources',
        'headlamp.rollback-resource',
        'headlamp.scale-resource',
        'headlamp.terminal',
      ].sort()
    );
  });
});

describe('registerReduxCallback', () => {
  function getCallback(): (e: HeadlampEvent) => void {
    registerReduxCallback();
    expect(registerHeadlampEventCallback).toHaveBeenCalledTimes(1);
    return registerHeadlampEventCallback.mock.calls[0][0];
  }

  it('forwards a plugins-loaded event to trackPluginsLoaded', () => {
    const cb = getCallback();
    cb({
      type: 'headlamp.plugins-loaded',
      data: {
        plugins: [
          { name: 'aks-desktop', isEnabled: true },
          { name: 'third-party', isEnabled: true },
          { name: 'disabled-one', isEnabled: false },
        ],
      },
    } as unknown as HeadlampEvent);
    expect(trackPluginsLoaded).toHaveBeenCalledWith({
      totalCount: 3,
      enabledCount: 2,
      knownEnabledIds: ['aks-desktop'],
      thirdPartyCount: 1,
    });
  });

  it('registers the Headlamp callback only once', () => {
    registerReduxCallback();
    registerReduxCallback();
    expect(registerHeadlampEventCallback).toHaveBeenCalledTimes(1);
  });

  it('does not register when persisted telemetry is disabled', () => {
    registerReduxCallback(() => false);
    expect(registerHeadlampEventCallback).not.toHaveBeenCalled();
  });

  it('drops events when telemetry becomes disabled after registration', () => {
    let enabled = true;
    registerReduxCallback(() => enabled);
    const cb = registerHeadlampEventCallback.mock.calls[0][0];
    enabled = false;
    cb({
      type: 'headlamp.plugins-loaded',
      data: { plugins: [{ name: 'aks-desktop', isEnabled: true }] },
    } as unknown as HeadlampEvent);
    expect(trackPluginsLoaded).not.toHaveBeenCalled();
    expect(trackFeature).not.toHaveBeenCalled();
  });

  it('fails closed when Headlamp callback registration throws', () => {
    registerHeadlampEventCallback.mockImplementationOnce(() => {
      throw new Error('synthetic registration failure');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => registerReduxCallback()).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();

    registerReduxCallback();
    expect(registerHeadlampEventCallback).toHaveBeenCalledTimes(2);
  });

  it('forwards an allowlisted resource event to trackFeature with status', () => {
    const cb = getCallback();
    cb({
      type: 'headlamp.delete-resource',
      data: {
        resource: { kind: 'Pod' },
        status: 'confirmed',
      },
    } as unknown as HeadlampEvent);
    expect(trackFeature).toHaveBeenCalledWith({
      feature: 'headlamp.delete-resource',
      status: 'confirmed',
      resourceKind: 'Pod',
    });
  });

  it('drops an event whose type is not on the allowlist', () => {
    const cb = getCallback();
    cb({
      type: 'headlamp.error-boundary',
      data: { error: new Error('x') },
    } as unknown as HeadlampEvent);
    expect(trackFeature).not.toHaveBeenCalled();
    expect(trackPluginsLoaded).not.toHaveBeenCalled();
  });

  it('does not throw when callback handling fails', () => {
    trackFeature.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cb = getCallback();
    expect(() =>
      cb({
        type: 'headlamp.logs',
        data: {},
      } as unknown as HeadlampEvent)
    ).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('extractKindFromPayload', () => {
  it('returns "Pod" for logs/terminal/pod-attach', () => {
    expect(extractKindFromPayload({ type: 'headlamp.logs' })).toBe('Pod');
    expect(extractKindFromPayload({ type: 'headlamp.terminal' })).toBe('Pod');
    expect(extractKindFromPayload({ type: 'headlamp.pod-attach' })).toBe('Pod');
  });

  it('returns sanitized kind for list-view from data.resourceKind', () => {
    expect(
      extractKindFromPayload({ type: 'headlamp.list-view', data: { resourceKind: 'Pod' } })
    ).toBe('Pod');
    expect(
      extractKindFromPayload({ type: 'headlamp.list-view', data: { resourceKind: 'WeirdCRD' } })
    ).toBe('CustomResource');
  });

  it('returns undefined for list-view without resourceKind (does not leak "Unknown")', () => {
    expect(extractKindFromPayload({ type: 'headlamp.list-view' })).toBeUndefined();
    expect(extractKindFromPayload({ type: 'headlamp.list-view', data: {} })).toBeUndefined();
    expect(
      extractKindFromPayload({ type: 'headlamp.list-view', data: { resourceKind: '' } })
    ).toBeUndefined();
  });

  it('returns sanitized kind for single-resource events from data.resource.kind', () => {
    for (const type of [
      'headlamp.delete-resource',
      'headlamp.edit-resource',
      'headlamp.scale-resource',
      'headlamp.restart-resource',
      'headlamp.rollback-resource',
      'headlamp.details-view',
    ]) {
      expect(extractKindFromPayload({ type, data: { resource: { kind: 'Deployment' } } })).toBe(
        'Deployment'
      );
    }
  });

  it('returns undefined for single-resource events without resource.kind', () => {
    for (const type of [
      'headlamp.delete-resource',
      'headlamp.edit-resource',
      'headlamp.scale-resource',
      'headlamp.restart-resource',
      'headlamp.rollback-resource',
      'headlamp.details-view',
    ]) {
      expect(extractKindFromPayload({ type })).toBeUndefined();
      expect(extractKindFromPayload({ type, data: {} })).toBeUndefined();
      expect(extractKindFromPayload({ type, data: { resource: {} } })).toBeUndefined();
    }
  });

  it('returns the single kind for homogeneous plural-resource events', () => {
    expect(
      extractKindFromPayload({
        type: 'headlamp.delete-resources',
        data: { resources: [{ kind: 'Pod' }, { kind: 'Pod' }] },
      })
    ).toBe('Pod');
  });

  it('returns "Multiple" for heterogeneous plural-resource events', () => {
    expect(
      extractKindFromPayload({
        type: 'headlamp.delete-resources',
        data: { resources: [{ kind: 'Pod' }, { kind: 'Deployment' }] },
      })
    ).toBe('Multiple');
  });

  it('returns undefined for plural-resource events with empty/missing array', () => {
    expect(
      extractKindFromPayload({ type: 'headlamp.delete-resources', data: { resources: [] } })
    ).toBeUndefined();
    expect(extractKindFromPayload({ type: 'headlamp.delete-resources', data: {} })).toBeUndefined();
  });

  it('returns undefined for plural-resource events when any entry lacks a kind', () => {
    // Mixing kinded + un-kinded entries cannot be honestly summarized — the
    // function returns undefined rather than emitting a misleading bucket.
    expect(
      extractKindFromPayload({
        type: 'headlamp.delete-resources',
        data: { resources: [{ kind: 'Pod' }, {}] },
      })
    ).toBeUndefined();
    expect(
      extractKindFromPayload({
        type: 'headlamp.restart-resources',
        data: { resources: [{ kind: 'Pod' }, { kind: '' }] },
      })
    ).toBeUndefined();
  });

  it('returns sanitized kind for object-events when resource is present', () => {
    expect(
      extractKindFromPayload({
        type: 'headlamp.object-events',
        data: { resource: { kind: 'Job' } },
      })
    ).toBe('Job');
  });

  it('returns undefined for object-events without resource', () => {
    expect(extractKindFromPayload({ type: 'headlamp.object-events', data: {} })).toBeUndefined();
  });

  it('returns undefined for object-events when resource is present but kind is missing', () => {
    expect(
      extractKindFromPayload({ type: 'headlamp.object-events', data: { resource: {} } })
    ).toBeUndefined();
    expect(
      extractKindFromPayload({ type: 'headlamp.object-events', data: { resource: { kind: '' } } })
    ).toBeUndefined();
  });

  it('returns undefined for events without resource semantics', () => {
    for (const type of [
      'headlamp.create-resource',
      'headlamp.plugins-loaded',
      'headlamp.plugin-loading-error',
      'headlamp.unknown-future-event',
    ]) {
      expect(extractKindFromPayload({ type })).toBeUndefined();
    }
  });
});
