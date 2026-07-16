// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { HeadlampEvent } from '@kinvolk/headlamp-plugin/lib/redux/headlampEventSlice';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiMocks = vi.hoisted(() => {
  const trackEvent = vi.fn();
  const instance = {
    addTelemetryInitializer: vi.fn(),
    config: {} as Record<string, unknown>,
    flush: vi.fn(),
    loadAppInsights: vi.fn(),
    trackEvent,
    unload: vi.fn(),
  };
  return {
    ApplicationInsights: vi.fn(() => instance),
    instance,
    trackEvent,
  };
});

vi.mock('@microsoft/applicationinsights-web', () => ({
  ApplicationInsights: aiMocks.ApplicationInsights,
}));

const registerMock = vi.hoisted(() => ({ registerHeadlampEventCallback: vi.fn() }));
vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const actual = await vi.importActual<any>('@kinvolk/headlamp-plugin/lib');
  return { ...actual, registerHeadlampEventCallback: registerMock.registerHeadlampEventCallback };
});

import {
  __getPendingEventCountForTests,
  __resetForTests,
  initTelemetry,
  setTelemetryEnabled,
} from './index';
import { __resetReduxRegistrationForTests, registerReduxCallback } from './setup';

const SESSION_PROPS = {
  appVersion: '1.0.0',
  locale: 'en-US',
  os: 'linux' as const,
  arch: 'x64',
  electronVersion: '32.1.0',
  headlampVersion: '0.30.0',
};

describe('Redux opt-out buffer integration', () => {
  beforeEach(() => {
    __resetForTests();
    setTelemetryEnabled(true);
    __resetReduxRegistrationForTests();
    registerMock.registerHeadlampEventCallback.mockClear();
    aiMocks.trackEvent.mockClear();
  });

  it('does not queue a disabled early event that can flush after initialization', () => {
    let enabled = true;
    registerReduxCallback(() => enabled);
    const callback = registerMock.registerHeadlampEventCallback.mock.calls[0][0];

    enabled = false;
    callback({
      type: 'headlamp.plugins-loaded',
      data: { plugins: [{ name: 'aks-desktop', isEnabled: true }] },
    } as unknown as HeadlampEvent);
    expect(__getPendingEventCountForTests()).toBe(0);

    initTelemetry({
      connectionString: 'InstrumentationKey=test',
      installId: '11111111-1111-4111-8111-111111111111',
      sessionProps: SESSION_PROPS,
    });
    expect(aiMocks.trackEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'headlamp.plugins-loaded' })
    );
  });
});
