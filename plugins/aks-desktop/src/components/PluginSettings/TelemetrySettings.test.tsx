// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./telemetrySettingsStore', () => ({
  TELEMETRY_DEFAULTS: { enabled: true },
  telemetrySettingsStore: {
    useConfig: () => () => ({ enabled: true }),
    update: vi.fn(),
  },
}));

// Dynamic import + real i18next re-init is slow (~3s) under full-suite CPU
// contention, which can exceed the default 5s test timeout; these tests use
// an explicit longer timeout.
const DYNAMIC_IMPORT_TEST_TIMEOUT = 30000;

describe('TelemetrySettings privacy disclosure', () => {
  it(
    'describes telemetry as pseudonymous per-install data, not anonymous data',
    async () => {
      const { default: TelemetrySettings } = await import('./TelemetrySettings');
      render(<TelemetrySettings />);

      expect(screen.getByText(/pseudonymous installation identifier/i)).toBeTruthy();
      expect(screen.getByText(/sessions from the same installation can be counted/i)).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: /send pseudonymous usage data/i })).toBeTruthy();
      expect(screen.queryByText(/anonymous usage data/i)).toBeNull();
    },
    DYNAMIC_IMPORT_TEST_TIMEOUT
  );
});

describe('TelemetrySettings restart notice removal', () => {
  const mocks = vi.hoisted(() => ({ config: { enabled: true } }));

  beforeEach(() => {
    vi.resetModules();
    mocks.config.enabled = true;
  });

  it(
    'never shows a restart notice after toggling the setting',
    async () => {
      vi.doMock('./telemetrySettingsStore', () => ({
        TELEMETRY_DEFAULTS: { enabled: true },
        telemetrySettingsStore: {
          useConfig: () => () => ({ ...mocks.config }),
          update: vi.fn(),
        },
      }));
      const { default: TelemetrySettings } = await import('./TelemetrySettings');

      const { rerender } = render(<TelemetrySettings />);
      expect(screen.queryByText(/restart aks desktop/i)).toBeNull();
      expect(screen.queryByText(/take effect on next launch/i)).toBeNull();

      mocks.config.enabled = false;
      rerender(<TelemetrySettings />);

      expect(screen.queryByText(/restart aks desktop/i)).toBeNull();
      expect(screen.queryByText(/take effect on next launch/i)).toBeNull();
    },
    DYNAMIC_IMPORT_TEST_TIMEOUT
  );
});
