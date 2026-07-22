// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNamespaceAsProject: vi.fn(),
  getClusterSettings: vi.fn(),
  push: vi.fn(),
  setClusterSettings: vi.fn(),
  trackAksFeature: vi.fn(),
  trackError: vi.fn(),
  useTelemetryFeatureOpened: vi.fn(),
}));

vi.mock('@iconify/react', () => ({ Icon: () => null }));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useClustersConf: () => ({ 'private-cluster': {} }),
  },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values
        ? Object.entries(values).reduce(
            (message, [name, value]) => message.replace(`{{${name}}}`, value),
            key
          )
        : key,
  }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  PageGrid: ({ children }: React.PropsWithChildren) => <>{children}</>,
  SectionBox: ({
    backLink,
    children,
  }: React.PropsWithChildren<{ backLink?: string | boolean }>) => (
    <>
      {typeof backLink === 'string' ? (
        <button onClick={() => mocks.push(backLink)}>Back</button>
      ) : null}
      {children}
    </>
  ),
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mocks.push }),
}));

vi.mock('../../hooks/useTelemetryFeatureOpened', () => ({
  useTelemetryFeatureOpened: mocks.useTelemetryFeatureOpened,
}));

vi.mock('../../telemetry/aksFeature', () => ({
  trackAksFeature: mocks.trackAksFeature,
}));

vi.mock('../../telemetry', () => ({
  trackError: mocks.trackError,
}));

vi.mock('../../utils/kubernetes/namespaceUtils', () => ({
  createNamespaceAsProject: mocks.createNamespaceAsProject,
}));

vi.mock('../../utils/shared/clusterSettings', () => ({
  getClusterSettings: mocks.getClusterSettings,
  setClusterSettings: mocks.setClusterSettings,
}));

vi.mock('../CreateAKSProject/components/Breadcrumb', () => ({
  Breadcrumb: () => null,
}));

vi.mock('../CreateAKSProject/components/SearchableSelect', () => ({
  SearchableSelect: ({
    label,
    onChange,
    options,
    value,
  }: {
    label: string;
    onChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value: string;
  }) => (
    <select aria-label={label} onChange={event => onChange(event.target.value)} value={value}>
      <option value="">Select</option>
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../shared/FormField', () => ({
  FormField: ({
    label,
    onChange,
    value,
  }: {
    label: string;
    onChange: (value: string) => void;
    value: string;
  }) => <input aria-label={label} onChange={event => onChange(event.target.value)} value={value} />,
}));

import CreateNamespace from './CreateNamespace';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function completeBasics() {
  fireEvent.change(screen.getByLabelText('Cluster'), {
    target: { value: 'private-cluster' },
  });
  fireEvent.change(screen.getByLabelText('Namespace Name'), {
    target: { value: 'private-namespace' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

function submitNamespace() {
  fireEvent.click(screen.getByRole('button', { name: 'Create Namespace' }));
}

function goBackOneWizardStep() {
  const backButtons = screen.getAllByRole('button', { name: 'Back' });
  fireEvent.click(backButtons[backButtons.length - 1]);
}

function clickHeaderBack() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);
}

describe('CreateNamespace telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getClusterSettings.mockReturnValue({ allowedNamespaces: ['existing-namespace'] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('records the namespace creation surface opening through the shared hook', () => {
    render(<CreateNamespace />);

    expect(mocks.useTelemetryFeatureOpened).toHaveBeenCalledTimes(1);
    expect(mocks.useTelemetryFeatureOpened).toHaveBeenCalledWith('aksd.namespace-create');
  });

  test('emits started and succeeded after namespace and settings updates complete', async () => {
    const deferred = createDeferred<void>();
    mocks.createNamespaceAsProject.mockReturnValue(deferred.promise);
    render(<CreateNamespace />);
    completeBasics();

    submitNamespace();

    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'started');
    expect(mocks.trackAksFeature.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createNamespaceAsProject.mock.invocationCallOrder[0]
    );

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    await waitFor(() => {
      expect(mocks.setClusterSettings).toHaveBeenCalledTimes(1);
      expect(mocks.trackAksFeature.mock.calls).toEqual([
        ['aksd.namespace-create', 'started'],
        ['aksd.namespace-create', 'succeeded'],
      ]);
    });
    expect(mocks.setClusterSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.trackAksFeature.mock.invocationCallOrder[1]
    );
    expect(JSON.stringify(mocks.trackAksFeature.mock.calls)).not.toContain('private-');
  });

  test('emits failed and a categorical UnknownError without transmitting the error message', async () => {
    mocks.createNamespaceAsProject.mockRejectedValue(
      new Error('private-namespace failed on private-cluster')
    );
    render(<CreateNamespace />);
    completeBasics();

    submitNamespace();

    await waitFor(() => {
      expect(mocks.trackAksFeature.mock.calls).toEqual([
        ['aksd.namespace-create', 'started'],
        ['aksd.namespace-create', 'failed'],
      ]);
      expect(mocks.trackError).toHaveBeenCalledWith({
        area: 'namespace-create',
        errorClass: 'UnknownError',
        phase: 'failed',
      });
    });
    expect(JSON.stringify(mocks.trackError.mock.calls)).not.toContain('private-');
  });

  test('emits cancelled from the explicit idle cancel action', () => {
    render(<CreateNamespace />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.trackAksFeature.mock.calls).toEqual([['aksd.namespace-create', 'cancelled']]);
    expect(mocks.push).toHaveBeenCalledWith('/');
  });

  test('emits cancelled from the accessible header back-to-home control', () => {
    render(<CreateNamespace />);

    clickHeaderBack();

    expect(mocks.trackAksFeature.mock.calls).toEqual([['aksd.namespace-create', 'cancelled']]);
    expect(mocks.push.mock.calls).toEqual([['/']]);
  });

  test('does not instrument wizard Back between visible steps', () => {
    render(<CreateNamespace />);
    completeBasics();

    goBackOneWizardStep();

    expect(mocks.trackAksFeature).not.toHaveBeenCalled();
  });

  test('does not emit cancelled from the reachable error-overlay Cancel after failure', async () => {
    mocks.createNamespaceAsProject.mockRejectedValue(new Error('private failure'));
    render(<CreateNamespace />);
    completeBasics();
    submitNamespace();
    await waitFor(() =>
      expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'failed')
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.namespace-create', 'started'],
      ['aksd.namespace-create', 'failed'],
    ]);
  });

  test('does not emit cancelled from back-to-home after success', async () => {
    mocks.createNamespaceAsProject.mockResolvedValue(undefined);
    render(<CreateNamespace />);
    completeBasics();
    submitNamespace();
    await waitFor(() =>
      expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'succeeded')
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go To Projects' }));

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.namespace-create', 'started'],
      ['aksd.namespace-create', 'succeeded'],
    ]);
  });

  test('cancels an active attempt from the reachable header Back and ignores late completion', async () => {
    const attempt = createDeferred<void>();
    mocks.createNamespaceAsProject.mockReturnValue(attempt.promise);
    render(<CreateNamespace />);
    completeBasics();
    submitNamespace();
    clickHeaderBack();
    await act(async () => {
      attempt.resolve();
      await attempt.promise;
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.namespace-create', 'started'],
      ['aksd.namespace-create', 'cancelled'],
    ]);
    expect(mocks.push.mock.calls).toEqual([['/']]);
    expect(mocks.setClusterSettings).not.toHaveBeenCalled();
  });

  test('cancels a retry after failure and ignores its late completion', async () => {
    const retry = createDeferred<void>();
    mocks.createNamespaceAsProject
      .mockRejectedValueOnce(new Error('private failure'))
      .mockReturnValueOnce(retry.promise);
    render(<CreateNamespace />);
    completeBasics();
    submitNamespace();
    await waitFor(() =>
      expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'failed')
    );

    submitNamespace();
    clickHeaderBack();
    await act(async () => {
      retry.resolve();
      await retry.promise;
    });

    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.namespace-create', 'started'],
      ['aksd.namespace-create', 'failed'],
      ['aksd.namespace-create', 'started'],
      ['aksd.namespace-create', 'cancelled'],
    ]);
    expect(mocks.push.mock.calls).toEqual([['/']]);
    expect(mocks.setClusterSettings).not.toHaveBeenCalled();
  });

  test('clears the success-dialog timer on unmount', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mocks.createNamespaceAsProject.mockResolvedValue(undefined);
    const rendered = render(<CreateNamespace />);
    completeBasics();
    submitNamespace();
    await waitFor(() =>
      expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'succeeded')
    );
    const successTimerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 1500);
    const successTimer = setTimeoutSpy.mock.results[successTimerIndex]?.value;

    rendered.unmount();

    expect(successTimer).toBeDefined();
    expect(clearTimeoutSpy.mock.calls.some(([timer]) => timer === successTimer)).toBe(true);
  });
});
