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
