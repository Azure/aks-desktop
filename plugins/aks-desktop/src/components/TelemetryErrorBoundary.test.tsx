// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackErrorMock = vi.hoisted(() => ({ trackError: vi.fn() }));
const { trackError } = trackErrorMock;
vi.mock('../telemetry', () => ({
  trackError: trackErrorMock.trackError,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { TelemetryErrorBoundary } from './TelemetryErrorBoundary';

function Boom({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

beforeEach(() => {
  trackError.mockClear();
  // Suppress React's noisy error-boundary warnings.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // The plugin's setup file doesn't auto-cleanup @testing-library
  // mounts, so multiple alerts can leak across tests.
  cleanup();
  vi.restoreAllMocks();
});

describe('TelemetryErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <TelemetryErrorBoundary>
        <div data-testid="child">hello</div>
      </TelemetryErrorBoundary>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(trackError).not.toHaveBeenCalled();
  });

  it('catches a child error and reports only a categorical plugin-ui failure', () => {
    render(
      <TelemetryErrorBoundary>
        <Boom message="boom" />
      </TelemetryErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/error occurred/i)).toBeInTheDocument();
    expect(trackError).toHaveBeenCalledWith({
      area: 'plugin-ui',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(trackError.mock.calls.flat()).not.toContainEqual(expect.any(Error));
  });

  it('still renders fallback if trackError throws', () => {
    trackError.mockImplementationOnce(() => {
      throw new Error('telemetry broken');
    });
    render(
      <TelemetryErrorBoundary>
        <Boom message="boom" />
      </TelemetryErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
