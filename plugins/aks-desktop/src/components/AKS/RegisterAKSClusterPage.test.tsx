// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  trackAksFeature: vi.fn(),
  useTelemetryFeatureOpened: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mocks.push }),
}));

vi.mock('../../telemetry/aksFeature', () => ({
  trackAksFeature: mocks.trackAksFeature,
}));

vi.mock('../../hooks/useTelemetryFeatureOpened', () => ({
  useTelemetryFeatureOpened: mocks.useTelemetryFeatureOpened,
}));

vi.mock('./RegisterAKSClusterDialog', () => ({
  default: ({
    onClose,
    onClusterRegistered,
    onRegistrationFinished,
    onRegistrationStarted,
  }: {
    onClose: () => void;
    onClusterRegistered?: () => void;
    onRegistrationFinished?: (outcome: 'failed' | 'succeeded') => void;
    onRegistrationStarted?: () => void;
  }) => (
    <div>
      <button onClick={onClose}>Close</button>
      <button onClick={onClusterRegistered}>Registered</button>
      <button onClick={onRegistrationStarted}>Start registration</button>
      <button
        onClick={() => {
          onRegistrationStarted?.();
          mocks.trackAksFeature('aksd.cluster-add', 'failed');
          onRegistrationFinished?.('failed');
        }}
      >
        Fail registration
      </button>
    </div>
  ),
}));

import RegisterAKSClusterPage from './RegisterAKSClusterPage';

describe('RegisterAKSClusterPage telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test('records the cluster-add page opening through the shared hook', () => {
    render(<RegisterAKSClusterPage />);

    expect(mocks.useTelemetryFeatureOpened).toHaveBeenCalledWith('aksd.cluster-add');
  });

  test('emits cancelled once when closing before registration succeeds', () => {
    render(<RegisterAKSClusterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(mocks.trackAksFeature.mock.calls).toEqual([['aksd.cluster-add', 'cancelled']]);

    vi.advanceTimersByTime(100);
    expect(mocks.push).toHaveBeenCalledWith('/');
  });

  test('suppresses cancellation when close follows terminal registration success', () => {
    render(<RegisterAKSClusterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Registered' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(mocks.trackAksFeature).not.toHaveBeenCalledWith('aksd.cluster-add', 'cancelled');
  });

  test('does not emit cancelled when close follows a failed registration attempt', () => {
    render(<RegisterAKSClusterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Fail registration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(mocks.trackAksFeature.mock.calls).toEqual([['aksd.cluster-add', 'failed']]);
  });

  test('emits cancelled when closing during a retry after failure', () => {
    render(<RegisterAKSClusterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Fail registration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start registration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.cluster-add', 'failed'],
      ['aksd.cluster-add', 'cancelled'],
    ]);
  });

  test('clears pending navigation when unmounted', () => {
    const rendered = render(<RegisterAKSClusterPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    rendered.unmount();
    vi.advanceTimersByTime(100);

    expect(mocks.push).not.toHaveBeenCalled();
  });
});
