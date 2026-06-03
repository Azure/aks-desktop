// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@microsoft/applicationinsights-web', () => {
  const loadAppInsights = vi.fn();
  const addTelemetryInitializer = vi.fn();
  const trackEvent = vi.fn();
  return {
    ApplicationInsights: vi.fn().mockImplementation(() => ({
      loadAppInsights,
      addTelemetryInitializer,
      trackEvent,
    })),
    __mock: { loadAppInsights, addTelemetryInitializer, trackEvent },
  };
});

// Mock the headlamp-plugin export so we don't need a real store.
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  registerHeadlampEventCallback: vi.fn(),
}));

import * as ai from '@microsoft/applicationinsights-web';
import { enableTelemetry } from './setup';

const VALID_INSTALL_ID = '11111111-1111-4111-8111-111111111111';
const sessionProps = {
  installId: VALID_INSTALL_ID,
  appVersion: '1.4.2',
  headlampVersion: '0.27.0',
  electronVersion: '30.0.0',
  os: 'darwin' as const,
  osMajor: '14',
  arch: 'arm64' as const,
  locale: 'en',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.appInsights = undefined;
});

afterEach(() => {
  window.appInsights = undefined;
});

describe('enableTelemetry', () => {
  it('no-ops when connection string is empty', () => {
    const register = vi.fn();
    enableTelemetry({
      connectionString: '',
      installId: VALID_INSTALL_ID,
      sessionProps,
      registerEventCallback: register,
    });
    expect(ai.ApplicationInsights).not.toHaveBeenCalled();
    expect(window.appInsights).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it('no-ops when install ID is missing', () => {
    const register = vi.fn();
    enableTelemetry({
      connectionString: 'InstrumentationKey=fake',
      installId: undefined,
      sessionProps,
      registerEventCallback: register,
    });
    expect(ai.ApplicationInsights).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('initializes SDK, attaches initializer, sets window.appInsights, fires session-start, registers callback', () => {
    const register = vi.fn();
    enableTelemetry({
      connectionString: 'InstrumentationKey=fake',
      installId: VALID_INSTALL_ID,
      sessionProps,
      registerEventCallback: register,
    });
    expect(ai.ApplicationInsights).toHaveBeenCalledTimes(1);
    const mock = (ai as any).__mock;
    expect(mock.addTelemetryInitializer).toHaveBeenCalledTimes(1);
    expect(mock.loadAppInsights).toHaveBeenCalledTimes(1);
    expect(window.appInsights).toBeDefined();
    expect(mock.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'headlamp.session-start' })
    );
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('the registered callback routes feature events through trackFeature with extracted kind', () => {
    const register = vi.fn();
    enableTelemetry({
      connectionString: 'InstrumentationKey=fake',
      installId: VALID_INSTALL_ID,
      sessionProps,
      registerEventCallback: register,
    });
    const callback = register.mock.calls[0][0];
    const mock = (ai as any).__mock;
    mock.trackEvent.mockClear();

    callback({
      type: 'headlamp.delete-resource',
      data: { resource: { kind: 'Pod' }, status: 'confirmed' },
    });

    expect(mock.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'headlamp.feature',
        properties: expect.objectContaining({
          feature: 'headlamp.delete-resource',
          status: 'confirmed',
          resourceKind: 'Pod',
        }),
      })
    );
  });

  it('routes PLUGINS_LOADED to trackPluginsLoaded, not trackFeature', () => {
    const register = vi.fn();
    enableTelemetry({
      connectionString: 'InstrumentationKey=fake',
      installId: VALID_INSTALL_ID,
      sessionProps,
      registerEventCallback: register,
    });
    const callback = register.mock.calls[0][0];
    const mock = (ai as any).__mock;
    mock.trackEvent.mockClear();

    callback({
      type: 'headlamp.plugins-loaded',
      data: {
        plugins: [
          { name: 'aks-desktop', version: '1.0', isEnabled: true },
          { name: 'random-third-party', version: '0.1', isEnabled: true },
          { name: 'disabled-plugin', version: '0.2', isEnabled: false },
        ],
      },
    });

    expect(mock.trackEvent).toHaveBeenCalledWith({
      name: 'headlamp.plugins-loaded',
      properties: {
        totalCount: '3',
        enabledCount: '2',
        knownEnabledIds: 'aks-desktop',
        thirdPartyCount: '1',
      },
    });
  });
});
