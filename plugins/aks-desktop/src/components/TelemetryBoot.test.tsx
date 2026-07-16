// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppInfo: vi.fn(),
  getOrCreateInstallId: vi.fn(),
  initTelemetry: vi.fn(),
  isTelemetryEnabled: vi.fn(),
  setTelemetryEnabled: vi.fn(),
}));

vi.mock('../telemetry', () => ({
  initTelemetry: mocks.initTelemetry,
  setTelemetryEnabled: mocks.setTelemetryEnabled,
}));
vi.mock('../telemetry/appInfo', () => ({ getAppInfo: mocks.getAppInfo }));
vi.mock('../telemetry/installId', () => ({ getOrCreateInstallId: mocks.getOrCreateInstallId }));
vi.mock('./PluginSettings/telemetrySettingsStore', () => ({
  isTelemetryEnabled: mocks.isTelemetryEnabled,
}));

import TelemetryBoot from './TelemetryBoot';

describe('TelemetryBoot', () => {
  beforeEach(() => {
    delete (window as { desktopApi?: unknown }).desktopApi;
    mocks.getAppInfo.mockReset();
    mocks.getOrCreateInstallId.mockReset();
    mocks.initTelemetry.mockReset();
    mocks.isTelemetryEnabled.mockReset();
    mocks.setTelemetryEnabled.mockReset();
    mocks.isTelemetryEnabled.mockReturnValue(true);
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
    mocks.isTelemetryEnabled.mockReturnValue(false);
    render(<TelemetryBoot />);
    expect(mocks.setTelemetryEnabled).toHaveBeenCalledWith(false);
    await waitFor(() => expect(mocks.initTelemetry).not.toHaveBeenCalled());
  });

  it('synchronously marks telemetry enabled before initialization', () => {
    render(<TelemetryBoot />);
    expect(mocks.setTelemetryEnabled).toHaveBeenCalledWith(true);
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

    expect(mocks.initTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionProps: expect.objectContaining({ appVersion: '0.3.0-beta' }),
      })
    );
    vi.advanceTimersByTime(1500);
    expect(send).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('requests appConfig after a grace period and falls back when it never arrives', () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const send = vi.fn();
    (window as { desktopApi?: unknown }).desktopApi = {
      receive: vi.fn(() => unsubscribe),
      send,
    };

    render(<TelemetryBoot />);
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledWith('appConfig');
    expect(mocks.initTelemetry).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1400);
    expect(mocks.initTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionProps: expect.objectContaining({ appVersion: 'unknown' }),
      })
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the launch-time consent snapshot across rerenders', async () => {
    const { rerender } = render(<TelemetryBoot />);
    await waitFor(() => expect(mocks.initTelemetry).toHaveBeenCalledTimes(1));

    mocks.isTelemetryEnabled.mockReturnValue(false);
    rerender(<TelemetryBoot />);

    expect(mocks.setTelemetryEnabled).not.toHaveBeenCalledWith(false);
    expect(mocks.initTelemetry).toHaveBeenCalledTimes(1);
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
});
