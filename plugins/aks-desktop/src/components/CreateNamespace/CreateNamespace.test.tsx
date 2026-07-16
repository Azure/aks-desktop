// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockPush = vi.hoisted(() => vi.fn());
const mockCreateNamespaceAsProject = vi.hoisted(() => vi.fn());
const mockTrackFeature = vi.hoisted(() => vi.fn());
const mockTrackError = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockPush }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { useClustersConf: () => ({ 'cluster-a': {} }) },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (result, [name, value]) => result.replace(`{{${name}}}`, value),
            key
          )
        : key,
  }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  PageGrid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionBox: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

vi.mock('../CreateAKSProject/components/Breadcrumb', () => ({
  Breadcrumb: () => null,
}));

vi.mock('../CreateAKSProject/components/SearchableSelect', () => ({
  SearchableSelect: ({ value, onChange }: any) => (
    <select aria-label="Cluster" value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Select</option>
      <option value="cluster-a">cluster-a</option>
    </select>
  ),
}));

vi.mock('../shared/FormField', () => ({
  FormField: ({ label, value, onChange }: any) => (
    <input aria-label={label} value={value} onChange={event => onChange(event.target.value)} />
  ),
}));

vi.mock('../../utils/kubernetes/namespaceUtils', () => ({
  createNamespaceAsProject: mockCreateNamespaceAsProject,
}));

vi.mock('../../utils/shared/clusterSettings', () => ({
  getClusterSettings: () => ({ allowedNamespaces: [] }),
  setClusterSettings: vi.fn(),
}));

vi.mock('../../telemetry', () => ({
  trackFeature: mockTrackFeature,
  trackError: mockTrackError,
}));

vi.mock('@iconify/react', () => ({ Icon: () => <span /> }));

import CreateNamespace from './CreateNamespace';

function completeBasicsStep() {
  fireEvent.change(screen.getByLabelText('Cluster'), { target: { value: 'cluster-a' } });
  fireEvent.change(screen.getByLabelText('Namespace Name'), { target: { value: 'team-one' } });
  fireEvent.click(screen.getByText('Next'));
}

describe('CreateNamespace telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrackFeature.mockImplementation(() => {});
    mockTrackError.mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('tracks opened and cancellation', () => {
    render(<CreateNamespace />);

    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.namespace-create',
      status: 'opened',
      resourceKind: 'Namespace',
    });

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.namespace-create',
      status: 'cancelled',
      resourceKind: 'Namespace',
    });
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  test('tracks started and succeeded', async () => {
    vi.useFakeTimers();
    mockCreateNamespaceAsProject.mockResolvedValue(undefined);
    render(<CreateNamespace />);
    completeBasicsStep();

    fireEvent.click(screen.getByText('Create Namespace'));
    await act(async () => vi.advanceTimersByTimeAsync(1600));

    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.namespace-create',
      status: 'started',
      resourceKind: 'Namespace',
    });
    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.namespace-create',
      status: 'succeeded',
      resourceKind: 'Namespace',
    });
  });

  test('clears the pending success timeout on unmount', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockCreateNamespaceAsProject.mockResolvedValue(undefined);
    const { unmount } = render(<CreateNamespace />);
    completeBasicsStep();

    await act(async () => {
      fireEvent.click(screen.getByText('Create Namespace'));
      await Promise.resolve();
    });

    const successTimeoutCall = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 1500);
    expect(successTimeoutCall).toBeGreaterThanOrEqual(0);
    const successTimeoutId = setTimeoutSpy.mock.results[successTimeoutCall].value;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(successTimeoutId);
  });

  test('tracks a categorical failure without changing the error UI', async () => {
    mockCreateNamespaceAsProject.mockRejectedValue(new Error('private details'));
    render(<CreateNamespace />);
    completeBasicsStep();

    fireEvent.click(screen.getByText('Create Namespace'));

    await waitFor(() => expect(screen.getByText('private details')).toBeInTheDocument());
    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.namespace-create',
      status: 'failed',
      resourceKind: 'Namespace',
    });
    expect(mockTrackError).toHaveBeenCalledWith({
      area: 'namespace-create',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
  });

  test('telemetry failures do not interrupt cancellation', () => {
    mockTrackFeature.mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });

    render(<CreateNamespace />);

    expect(() => fireEvent.click(screen.getByText('Cancel'))).not.toThrow();
    expect(mockPush).toHaveBeenCalledWith('/');
  });
});
