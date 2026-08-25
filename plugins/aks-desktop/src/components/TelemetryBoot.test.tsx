// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppInfo: vi.fn(),
  getOrCreateInstallId: vi.fn(),
  initTelemetry: vi.fn(),
  setTelemetryEnabled: vi.fn(),
  grantConsent: vi.fn(),
  revokeConsent: vi.fn(),
  storeConfig: { enabled: true } as { enabled: boolean },
}));

vi.mock('../telemetry', () => ({
  initTelemetry: mocks.initTelemetry,
  setTelemetryEnabled: mocks.setTelemetryEnabled,
}));
vi.mock('../telemetry/appInfo', () => ({ getAppInfo: mocks.getAppInfo }));
vi.mock('../telemetry/installId', () => ({ getOrCreateInstallId: mocks.getOrCreateInstallId }));
vi.mock('../telemetry/consent', () => ({
  grantConsent: mocks.grantConsent,
  revokeConsent: mocks.revokeConsent,
}));
vi.mock('./PluginSettings/telemetrySettingsStore', () => ({
  TELEMETRY_DEFAULTS: { enabled: true },
  isTelemetryEnabled: () => mocks.storeConfig.enabled,
  telemetrySettingsStore: {
    useConfig: () => () => ({ ...mocks.storeConfig }),
  },
}));

import TelemetryBoot from './TelemetryBoot';

describe('TelemetryBoot', () => {
  beforeEach(() => {
    delete (window as { desktopApi?: unknown }).desktopApi;
    mocks.getAppInfo.mockReset();
    mocks.getOrCreateInstallId.mockReset();
    mocks.initTelemetry.mockReset();
    mocks.setTelemetryEnabled.mockReset();
    mocks.grantConsent.mockReset();
    mocks.revokeConsent.mockReset();
    mocks.storeConfig.enabled = true;
    mocks.getOrCreateInstallId.mockReturnValue('11111111-1111-4111-8111-111111111111');
    mocks.getAppInfo.mockReturnValue({
      os: 'linux',
      arch: 'x64',
      electronVersion: '32.1.0',
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as { desktopApi?: unknown }).desktopApi;
  });

  it('does not initialize when telemetry is disabled', async () => {
    mocks.storeConfig.enabled = false;
    render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.setTelemetryEnabled).toHaveBeenCalledWith(false));
    expect(mocks.initTelemetry).not.toHaveBeenCalled();
  });

  it('marks telemetry enabled on mount, before initialization', async () => {
    render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.setTelemetryEnabled).toHaveBeenCalledWith(true));
  });

  it('uses the installed app version from the existing appConfig channel', async () => {
    vi.useFakeTimers();
    let onAppConfig: ((config: { appVersion?: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    const send = vi.fn();
    (window as { desktopApi?: unknown }).desktopApi = {
      receive: vi.fn((channel, callback) => {
        expect(channel).toBe('appConfig');
        onAppConfig = callback;
        return unsubscribe;
      }),
      send,
    };

    const { unmount } = render(<TelemetryBoot />);

    expect(send).not.toHaveBeenCalled();
    expect(mocks.initTelemetry).not.toHaveBeenCalled();

    onAppConfig?.({ appVersion: '0.3.0-beta' });

    await waitFor(() =>
      expect(mocks.initTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionProps: expect.objectContaining({ appVersion: '0.3.0-beta' }),
        })
      )
    );
    vi.advanceTimersByTime(1500);
    expect(send).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('requests appConfig after a grace period and falls back when it never arrives', async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const send = vi.fn();
    (window as { desktopApi?: unknown }).desktopApi = {
      receive: vi.fn(() => unsubscribe),
      send,
    };

    render(<TelemetryBoot />);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledWith('appConfig');
    expect(mocks.initTelemetry).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1400);
    expect(mocks.initTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionProps: expect.objectContaining({ appVersion: 'unknown' }),
      })
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('fails closed without logging when boot helpers throw', async () => {
    mocks.getOrCreateInstallId.mockImplementation(() => {
      throw new Error('synthetic failure');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.getOrCreateInstallId).toHaveBeenCalled());
    expect(mocks.initTelemetry).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not initialize after a real unmount that beats the appConfig handshake', async () => {
    const unsubscribe = vi.fn();
    (window as { desktopApi?: unknown }).desktopApi = {
      receive: vi.fn(() => unsubscribe),
      send: vi.fn(),
    };

    // Unmount while `initialize` is still awaiting the app-version promise.
    // Cleanup resolves that promise (so a StrictMode replay cannot hang), so
    // the continuation does run — it must decline to build a client that no
    // mounted component owns.
    const { unmount } = render(<TelemetryBoot />);
    unmount();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.initTelemetry).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('still initializes across a StrictMode unmount/remount replay', async () => {
    let onAppConfig: ((config: { appVersion?: string }) => void) | undefined;
    (window as { desktopApi?: unknown }).desktopApi = {
      receive: vi.fn((_channel, callback) => {
        onAppConfig = callback;
        return vi.fn();
      }),
      send: vi.fn(),
    };

    // The replay's cleanup settles the first app-version promise, and
    // previousEnabledRef is no longer null on the re-run, so the *first*
    // initialize continuation is the only one that can reach initTelemetry.
    // The mounted guard must not cancel it.
    render(
      <React.StrictMode>
        <TelemetryBoot />
      </React.StrictMode>
    );

    onAppConfig?.({ appVersion: '0.4.0' });

    await waitFor(() => expect(mocks.initTelemetry).toHaveBeenCalledTimes(1));
  });

  it('does not initialize when opt-out lands while the appConfig handshake is pending', async () => {
    // The launch race: initialize() is parked on the ~1.5s handshake when the
    // user opts out. The passive revoke effect has not disabled telemetry yet,
    // so without a live re-check initTelemetry would run and emit session-start
    // through the deliberate emitInternal bypass — transmitting after opt-out.
    let onAppConfig: ((config: { appVersion?: string }) => void) | undefined;
    (window as { desktopApi?: unknown }).desktopApi = {
      receive: vi.fn((_channel, callback) => {
        onAppConfig = callback;
        return vi.fn();
      }),
      send: vi.fn(),
    };

    const { rerender } = render(<TelemetryBoot />);
    expect(mocks.initTelemetry).not.toHaveBeenCalled();

    // User opts out while the handshake is still outstanding.
    mocks.storeConfig.enabled = false;
    rerender(<TelemetryBoot />);

    // Handshake now lands, resuming the parked initialize().
    onAppConfig?.({ appVersion: '0.5.0' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mocks.initTelemetry).not.toHaveBeenCalled();
  });

  it('does not call grantConsent on initial mount even when enabled', async () => {
    render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.initTelemetry).toHaveBeenCalledTimes(1));
    expect(mocks.grantConsent).not.toHaveBeenCalled();
    expect(mocks.revokeConsent).not.toHaveBeenCalled();
  });

  it('calls grantConsent on a false-to-true transition, not a duplicate init', async () => {
    mocks.storeConfig.enabled = false;
    const { rerender } = render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.setTelemetryEnabled).toHaveBeenCalledWith(false));
    expect(mocks.initTelemetry).not.toHaveBeenCalled();

    mocks.storeConfig.enabled = true;
    rerender(<TelemetryBoot />);

    expect(mocks.grantConsent).toHaveBeenCalledTimes(1);
    expect(mocks.grantConsent).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.revokeConsent).not.toHaveBeenCalled();
  });

  it('calls revokeConsent on a true-to-false transition', async () => {
    const { rerender } = render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.initTelemetry).toHaveBeenCalledTimes(1));

    mocks.storeConfig.enabled = false;
    rerender(<TelemetryBoot />);

    expect(mocks.revokeConsent).toHaveBeenCalledTimes(1);
    expect(mocks.grantConsent).not.toHaveBeenCalled();
  });

  it('never disables telemetry directly on a transition — the orchestrator owns it', async () => {
    const { rerender } = render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.initTelemetry).toHaveBeenCalledTimes(1));
    mocks.setTelemetryEnabled.mockClear();

    mocks.storeConfig.enabled = false;
    rerender(<TelemetryBoot />);

    expect(mocks.revokeConsent).toHaveBeenCalledTimes(1);
    // The regression guard. Calling setTelemetryEnabled(false) from the
    // component would unload the SDK and clear the enabled flag before
    // revokeConsent could emit and flush the revoke event — which
    // emitConsentEvent then drops, because it returns early when telemetry
    // is disabled. Opt-out rate would silently read zero forever.
    expect(mocks.setTelemetryEnabled).not.toHaveBeenCalledWith(false);
  });

  it('a grantConsent-injected initialize resolves the cached app version', async () => {
    mocks.storeConfig.enabled = false;
    const { rerender } = render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.setTelemetryEnabled).toHaveBeenCalledWith(false));

    mocks.storeConfig.enabled = true;
    rerender(<TelemetryBoot />);

    expect(mocks.grantConsent).toHaveBeenCalledTimes(1);
    const initialize = mocks.grantConsent.mock.calls[0][0] as () => Promise<void>;
    await initialize();

    expect(mocks.initTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionProps: expect.objectContaining({ appVersion: 'unknown' }),
      })
    );
  });
});
