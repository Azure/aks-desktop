// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAKSClusters: vi.fn(),
  getClusterCapabilities: vi.fn(),
  getSubscriptions: vi.fn(),
  onClose: vi.fn(),
  onClusterRegistered: vi.fn(),
  onRegistrationFinished: vi.fn(),
  onRegistrationStarted: vi.fn(),
  registerAKSCluster: vi.fn(),
  replace: vi.fn(),
  trackAksFeature: vi.fn(),
  trackError: vi.fn(),
}));

const subscription = {
  id: 'sensitive-subscription-id',
  name: 'Sensitive Subscription',
  state: 'Enabled',
  tenantId: 'sensitive-tenant-id',
};

const cluster = {
  name: 'sensitive-cluster-name',
  resourceGroup: 'sensitive-resource-group',
  location: 'eastus',
  kubernetesVersion: '1.32.0',
  provisioningState: 'Succeeded',
};

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
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

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ replace: mocks.replace }),
}));

vi.mock('../../hooks/useAzureAuth', () => ({
  useAzureAuth: () => ({ isChecking: false, isLoggedIn: true }),
}));

vi.mock('../../utils/azure/aks', () => ({
  getAKSClusters: mocks.getAKSClusters,
  getSubscriptions: mocks.getSubscriptions,
  registerAKSCluster: mocks.registerAKSCluster,
}));

vi.mock('../../utils/azure/az-clusters', () => ({
  getClusterCapabilities: mocks.getClusterCapabilities,
}));

vi.mock('../../telemetry/aksFeature', () => ({
  trackAksFeature: mocks.trackAksFeature,
}));

vi.mock('../../telemetry', () => ({
  trackError: mocks.trackError,
}));

vi.mock('./RegisterAKSClusterDialogPure', () => ({
  default: ({
    onClusterChange,
    onRegister,
    onSubscriptionChange,
  }: {
    onClusterChange: (event: React.SyntheticEvent, value: typeof cluster) => void;
    onRegister: () => void;
    onSubscriptionChange: (event: React.SyntheticEvent, value: typeof subscription) => void;
  }) => (
    <div>
      <button onClick={event => onSubscriptionChange(event, subscription)}>
        Select subscription
      </button>
      <button onClick={event => onClusterChange(event, cluster)}>Select cluster</button>
      <button onClick={onRegister}>Register</button>
    </div>
  ),
}));

import RegisterAKSClusterDialog from './RegisterAKSClusterDialog';

function renderDialog() {
  return render(
    <RegisterAKSClusterDialog
      open
      onClose={mocks.onClose}
      onClusterRegistered={mocks.onClusterRegistered}
      onRegistrationFinished={mocks.onRegistrationFinished}
      onRegistrationStarted={mocks.onRegistrationStarted}
    />
  );
}

function selectRequiredValues() {
  fireEvent.click(screen.getByRole('button', { name: 'Select subscription' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select cluster' }));
}

function telemetryCallsAsJson() {
  return JSON.stringify([mocks.trackAksFeature.mock.calls, mocks.trackError.mock.calls]);
}

describe('RegisterAKSClusterDialog telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAKSClusters.mockResolvedValue({ success: true, clusters: [] });
    mocks.getSubscriptions.mockResolvedValue({ success: true, subscriptions: [] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('emits started only after required selection validation', async () => {
    mocks.registerAKSCluster.mockReturnValue(new Promise(() => {}));
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(mocks.trackAksFeature).not.toHaveBeenCalled();

    selectRequiredValues();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.cluster-add', 'started');
    expect(mocks.onRegistrationStarted).toHaveBeenCalledTimes(1);
    expect(mocks.trackAksFeature.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerAKSCluster.mock.invocationCallOrder[0]
    );
  });

  test('emits succeeded immediately after registration before the capability query settles', async () => {
    let rejectCapabilities!: (error: Error) => void;
    mocks.registerAKSCluster.mockResolvedValue({
      success: true,
      message: 'sensitive registration result',
    });
    mocks.getClusterCapabilities.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCapabilities = reject;
      })
    );
    renderDialog();
    selectRequiredValues();

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.cluster-add', 'succeeded')
    );
    expect(mocks.trackAksFeature.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.getClusterCapabilities.mock.invocationCallOrder[0]
    );
    expect(mocks.onClusterRegistered).toHaveBeenCalledTimes(1);
    expect(mocks.onRegistrationFinished).toHaveBeenCalledWith('succeeded');
    expect(telemetryCallsAsJson()).not.toContain('sensitive');

    await act(async () => {
      rejectCapabilities(new Error('sensitive capability failure'));
    });
  });

  test('emits failed and a privacy-safe error for an unsuccessful result', async () => {
    mocks.registerAKSCluster.mockResolvedValue({
      success: false,
      message: 'sensitive unsuccessful result',
    });
    renderDialog();
    selectRequiredValues();

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.cluster-add', 'failed')
    );
    expect(mocks.trackError).toHaveBeenCalledWith({
      area: 'cluster-add',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(mocks.onRegistrationFinished).toHaveBeenCalledWith('failed');
    expect(mocks.getClusterCapabilities).not.toHaveBeenCalled();
    expect(telemetryCallsAsJson()).not.toContain('sensitive');
  });

  test('emits failed and a privacy-safe error for a thrown exception', async () => {
    mocks.registerAKSCluster.mockRejectedValue(new Error('sensitive thrown exception'));
    renderDialog();
    selectRequiredValues();

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(mocks.trackAksFeature).toHaveBeenCalledWith('aksd.cluster-add', 'failed')
    );
    expect(mocks.trackError).toHaveBeenCalledWith({
      area: 'cluster-add',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
    expect(mocks.onRegistrationFinished).toHaveBeenCalledWith('failed');
    expect(telemetryCallsAsJson()).not.toContain('sensitive');
  });

  test('does not classify a non-critical capability failure as registration failure', async () => {
    mocks.registerAKSCluster.mockResolvedValue({ success: true, message: 'registered' });
    mocks.getClusterCapabilities.mockRejectedValue(new Error('capability unavailable'));
    renderDialog();
    selectRequiredValues();

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(mocks.getClusterCapabilities).toHaveBeenCalledTimes(1));
    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.cluster-add', 'started'],
      ['aksd.cluster-add', 'succeeded'],
    ]);
    expect(mocks.trackError).not.toHaveBeenCalled();
  });
});
