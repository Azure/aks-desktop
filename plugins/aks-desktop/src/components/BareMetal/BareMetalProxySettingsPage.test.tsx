// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.hoisted(() => vi.fn());
const mockGetSubscriptions = vi.hoisted(() => vi.fn());
const mockGetAKSClusters = vi.hoisted(() => vi.fn());
const mockUseBareMetalProxy = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockPush }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon, ...props }: any) => <span data-icon={icon} {...props} />,
}));

vi.mock('../../utils/azure/aks', () => ({
  getSubscriptions: mockGetSubscriptions,
  getAKSClusters: mockGetAKSClusters,
}));

vi.mock('./useBareMetalProxy', () => ({
  useBareMetalProxy: mockUseBareMetalProxy,
}));

import BareMetalProxySettingsPage from './BareMetalProxySettingsPage';

const subscriptions = [
  {
    id: 'sub-1',
    name: 'Subscription One',
    state: 'Enabled',
    tenantId: 'tenant-1',
  },
];
const clusters = [
  {
    name: 'edge-cluster',
    resourceGroup: 'edge-rg',
    location: 'westus3',
    provisioningState: 'Connected',
    kubernetesVersion: '',
    clusterType: 'aksarc' as const,
  },
];

async function runAxe() {
  const results = await axe.run(document.body, {
    rules: {
      'color-contrast': { enabled: false },
    },
  });
  return results.violations;
}

describe('BareMetalProxySettingsPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSubscriptions.mockResolvedValue({ success: true, subscriptions });
    mockGetAKSClusters.mockResolvedValue({ success: true, clusters });
    mockUseBareMetalProxy.mockReturnValue({
      proxyStatus: { success: true, status: 'running', pid: 4242 },
      proxyActionLoading: false,
      proxyUiError: '',
      proxyDropped: false,
      refreshProxyStatus: vi.fn(),
      handleProxyStart: vi.fn(),
      handleProxyStop: vi.fn(),
      handleProxyRestart: vi.fn(),
      dismissProxyDropped: vi.fn(),
      resetProxyState: vi.fn(),
    });
  });

  it('has no axe violations for the loaded BareMetal proxy controls state', async () => {
    render(<BareMetalProxySettingsPage />);

    await screen.findByRole('heading', { name: 'BareMetal Proxy' });
    await screen.findByRole('combobox', { name: 'Subscription' });
    await screen.findByRole('combobox', { name: 'BareMetal cluster' });

    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('renders an announced status region for proxy state updates', async () => {
    render(<BareMetalProxySettingsPage />);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Status: RUNNING (PID 4242)');
  });

  it('has no axe violations for the dropped proxy recovery state', async () => {
    mockUseBareMetalProxy.mockReturnValue({
      proxyStatus: {
        success: true,
        status: 'error',
        lastError: 'Proxy disconnected unexpectedly.',
      },
      proxyActionLoading: false,
      proxyUiError: '',
      proxyDropped: true,
      refreshProxyStatus: vi.fn(),
      handleProxyStart: vi.fn(),
      handleProxyStop: vi.fn(),
      handleProxyRestart: vi.fn(),
      dismissProxyDropped: vi.fn(),
      resetProxyState: vi.fn(),
    });

    render(<BareMetalProxySettingsPage />);

    await screen.findByText('BareMetal proxy disconnected');
    expect(
      (await screen.findAllByRole('button', { name: 'Restart Proxy' })).length
    ).toBeGreaterThan(0);
    await screen.findByRole('button', { name: 'Open Proxy Controls' });

    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('shows an info alert when a subscription has no BareMetal clusters', async () => {
    mockGetAKSClusters.mockResolvedValue({ success: true, clusters: [] });

    render(<BareMetalProxySettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText('No BareMetal clusters found in this subscription.')
      ).toBeInTheDocument();
    });
  });
});
