// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import TelemetrySettings from './TelemetrySettings';

vi.mock('./telemetrySettingsStore', () => ({
  TELEMETRY_DEFAULTS: { enabled: true },
  telemetrySettingsStore: {
    useConfig: () => () => ({ enabled: true }),
    update: vi.fn(),
  },
}));

describe('TelemetrySettings privacy disclosure', () => {
  it('describes telemetry as pseudonymous per-install data, not anonymous data', () => {
    render(<TelemetrySettings />);

    expect(screen.getByText(/pseudonymous installation identifier/i)).toBeTruthy();
    expect(screen.getByText(/sessions from the same installation can be counted/i)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /send pseudonymous usage data/i })).toBeTruthy();
    expect(screen.queryByText(/anonymous usage data/i)).toBeNull();
  });
});
