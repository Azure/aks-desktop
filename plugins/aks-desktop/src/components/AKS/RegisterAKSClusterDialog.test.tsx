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
  renderPure: vi.fn(),
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
  default: (props: {
    onClusterChange: (event: React.SyntheticEvent, value: typeof cluster) => void;
    onClose: () => void;
    onConfigured: () => void;
    onDone: () => void;
    onRegister: () => void;
    onSubscriptionChange: (event: React.SyntheticEvent, value: typeof subscription) => void;
    [key: string]: unknown;
  }) => {
    mocks.renderPure(props);
    return (
      <div>
        <button onClick={event => props.onSubscriptionChange(event, subscription)}>
          Select subscription
        </button>
        <button onClick={event => props.onClusterChange(event, cluster)}>Select cluster</button>
        <button onClick={props.onRegister}>Register</button>
        <button onClick={props.onClose}>Close</button>
        <button onClick={props.onDone}>Done</button>
        <button onClick={props.onConfigured}>Configured</button>
      </div>
    );
  },
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

/** Return the most recently rendered pure dialog props. */
function currentDialogProps() {
  const calls = mocks.renderPure.mock.calls;
  return calls[calls.length - 1][0];
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

  test('auto-selects a sole tenant and subscription and loads its clusters', async () => {
    mocks.getSubscriptions.mockResolvedValue({
      success: true,
      subscriptions: [{ ...subscription, state: 'Disabled', tenantName: 'Contoso' }],
    });
    mocks.getAKSClusters.mockResolvedValue({ success: true, clusters: [cluster] });

    renderDialog();

    await waitFor(() => expect(mocks.getAKSClusters).toHaveBeenCalledWith(subscription.id));
    await waitFor(() => expect(currentDialogProps().clusters).toEqual([cluster]));
    expect(currentDialogProps()).toMatchObject({
      selectedSubscription: { ...subscription, state: 'Disabled', tenantName: 'Contoso' },
      subscriptionInputValue: `${subscription.name} (Disabled)`,
      selectedTenant: { id: subscription.tenantId, name: 'Contoso' },
      tenantInputValue: 'Contoso',
    });
  });

  test.each([
    [{ success: false, message: 'subscription unavailable' }, 'subscription unavailable'],
    [new Error('subscription exception'), 'Failed to load subscriptions'],
  ])('reports subscription loading failures', async (outcome, message) => {
    if (outcome instanceof Error) {
      mocks.getSubscriptions.mockRejectedValue(outcome);
    } else {
      mocks.getSubscriptions.mockResolvedValue(outcome);
    }

    renderDialog();

    await waitFor(() => expect(currentDialogProps().error).toBe(message));
    expect(currentDialogProps().loadingSubscriptions).toBe(false);
  });

  test.each([
    [{ success: false, message: 'cluster unavailable' }, 'cluster unavailable'],
    [new Error('cluster exception'), 'Failed to load AKS clusters'],
  ])('reports cluster loading failures', async (outcome, message) => {
    if (outcome instanceof Error) {
      mocks.getAKSClusters.mockRejectedValue(outcome);
    } else {
      mocks.getAKSClusters.mockResolvedValue(outcome);
    }
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Select subscription' }));

    await waitFor(() => expect(currentDialogProps().error).toBe(message));
    expect(currentDialogProps().loadingClusters).toBe(false);
  });

  test('filters tenant subscriptions and resets dependent selection state', async () => {
    const otherSubscription = {
      ...subscription,
      id: 'other-subscription-id',
      name: 'Other Subscription',
      tenantId: 'other-tenant-id',
      tenantName: '',
    };
    mocks.getSubscriptions.mockResolvedValue({
      success: true,
      subscriptions: [subscription, otherSubscription],
    });
    renderDialog();
    await waitFor(() => expect(currentDialogProps().tenants).toHaveLength(2));

    act(() => {
      currentDialogProps().onTenantChange({} as React.SyntheticEvent, {
        id: subscription.tenantId,
        name: subscription.tenantId,
      });
    });

    expect(currentDialogProps().subscriptions).toEqual([subscription]);
    expect(currentDialogProps()).toMatchObject({
      selectedSubscription: null,
      selectedCluster: null,
      tenantInputValue: subscription.tenantId,
    });

    act(() => {
      currentDialogProps().onTenantInputChange({} as React.SyntheticEvent, '', 'clear');
    });
    expect(currentDialogProps()).toMatchObject({
      selectedTenant: null,
      selectedSubscription: null,
      tenantInputValue: '',
    });
  });

  test('updates and clears search inputs and selected values', async () => {
    mocks.getSubscriptions.mockResolvedValue({
      success: true,
      subscriptions: [
        { ...subscription, id: 'sub-beta', name: 'Beta' },
        { ...subscription, id: 'sub-alpha', name: 'Alpha' },
        { ...subscription, id: 'sub-gamma', name: 'Gamma' },
      ],
    });
    renderDialog();
    await waitFor(() => expect(currentDialogProps().subscriptions).toHaveLength(3));

    act(() => {
      currentDialogProps().onSubscriptionInputChange({} as React.SyntheticEvent, 'a', 'input');
    });
    expect(currentDialogProps().subscriptions.map(({ name }: { name: string }) => name)).toEqual([
      'Alpha',
      'Gamma',
      'Beta',
    ]);

    act(() => {
      currentDialogProps().onSubscriptionInputChange({} as React.SyntheticEvent, '', 'clear');
      currentDialogProps().onClusterInputChange({} as React.SyntheticEvent, 'aks', 'input');
      currentDialogProps().onClusterInputChange({} as React.SyntheticEvent, '', 'clear');
      currentDialogProps().onTenantInputChange({} as React.SyntheticEvent, 'ignored', 'reset');
    });
    expect(currentDialogProps()).toMatchObject({
      selectedSubscription: null,
      selectedCluster: null,
      clusterInputValue: '',
    });
  });

  test('blocks close while registering and navigates home when done', async () => {
    mocks.registerAKSCluster.mockReturnValue(new Promise(() => {}));
    renderDialog();
    selectRequiredValues();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  test('allows idle close and dismisses an error', async () => {
    mocks.getSubscriptions.mockResolvedValue({ success: false, message: 'unavailable' });
    renderDialog();
    await waitFor(() => expect(currentDialogProps().error).toBe('unavailable'));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);

    act(() => currentDialogProps().onDismissError());
    expect(currentDialogProps().error).toBe('');
  });

  test('dismisses success and ignores capability completion after unmount', async () => {
    let resolveCapabilities!: (value: { azureRbacEnabled: boolean }) => void;
    mocks.registerAKSCluster.mockResolvedValue({ success: true, message: 'registered' });
    mocks.getClusterCapabilities.mockReturnValue(
      new Promise(resolve => {
        resolveCapabilities = resolve;
      })
    );
    const rendered = renderDialog();
    selectRequiredValues();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(currentDialogProps().success).toContain(cluster.name));

    act(() => currentDialogProps().onDismissSuccess());
    expect(currentDialogProps().success).toBe('');

    rendered.unmount();
    await act(async () => {
      resolveCapabilities({ azureRbacEnabled: true });
    });
  });

  test('refreshes capabilities only when a cluster and subscription are selected', async () => {
    mocks.getClusterCapabilities.mockResolvedValue({ azureRbacEnabled: true });
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Configured' }));
    expect(mocks.getClusterCapabilities).not.toHaveBeenCalled();

    selectRequiredValues();
    fireEvent.click(screen.getByRole('button', { name: 'Configured' }));

    await waitFor(() => expect(mocks.getClusterCapabilities).toHaveBeenCalledTimes(1));
    expect(currentDialogProps().capabilities).toEqual({ azureRbacEnabled: true });
  });

  test('ignores a failed capability refresh', async () => {
    mocks.getClusterCapabilities.mockRejectedValue(new Error('refresh failed'));
    renderDialog();
    selectRequiredValues();

    fireEvent.click(screen.getByRole('button', { name: 'Configured' }));

    await waitFor(() => expect(mocks.getClusterCapabilities).toHaveBeenCalledTimes(1));
    expect(currentDialogProps().capabilities).toBeNull();
  });
});
