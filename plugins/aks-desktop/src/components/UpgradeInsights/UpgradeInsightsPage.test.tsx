// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AzureAuthStatus } from '../../hooks/useAzureAuth';
import type { ClusterInventory, Insight } from '../../types/upgradeInsights';
import { cluster, passed, provider } from './__fixtures__/fixtures';
import UpgradeInsightsPage from './UpgradeInsightsPage';

const mocks = vi.hoisted(() => ({
  preview: true,
  app: true,
  context: null as string | null,
  auth: {
    isLoggedIn: true,
    isChecking: false,
    username: 'first@example.test',
    tenantId: 'tenant',
  } as AzureAuthStatus,
  subscriptions: vi.fn(),
  createProvider: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  Headlamp: { isRunningAsApp: () => mocks.app },
  K8s: { useCluster: () => mocks.context },
  useTranslation: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => String(values?.[key] ?? '')),
  }),
}));
vi.mock('../../hooks/useAzureAuth', () => ({ useAzureAuth: () => mocks.auth }));
vi.mock('../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ upgradeInsights: mocks.preview }),
}));
vi.mock('../../utils/azure/upgrade-insights', () => ({
  getUpgradeInsightSubscriptions: mocks.subscriptions,
  createUpgradeInsightsProvider: mocks.createProvider,
}));

const subscription = { id: cluster.subscription, name: 'Test subscription', tenantId: 'tenant' };
const renderPage = (selected = false) =>
  render(
    <MemoryRouter>
      <UpgradeInsightsPage requireClusterSelection={selected} />
    </MemoryRouter>
  );
async function loadSubscriptions() {
  fireEvent.click(await screen.findByRole('checkbox', { name: /Test subscription/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Load selected subscriptions' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.preview = true;
  mocks.app = true;
  mocks.context = null;
  mocks.auth = {
    isLoggedIn: true,
    isChecking: false,
    username: 'first@example.test',
    tenantId: 'tenant',
  };
  mocks.subscriptions.mockResolvedValue([subscription]);
  mocks.createProvider.mockReturnValue(provider());
});
afterEach(cleanup);

describe('native Azure and preview gates', () => {
  it('blocks disabled preview direct navigation before subscriptions or provider calls', () => {
    mocks.preview = false;
    renderPage();
    expect(screen.getByText(/Upgrade Insights is disabled/)).toBeTruthy();
    expect(mocks.subscriptions).not.toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });
  it('blocks non-desktop use', () => {
    mocks.app = false;
    renderPage();
    expect(screen.getByText(/Upgrade Insights is disabled/)).toBeTruthy();
    expect(mocks.subscriptions).not.toHaveBeenCalled();
  });
  it('offers the existing Azure login when signed out, without listing subscriptions', () => {
    mocks.auth = { isLoggedIn: false, isChecking: false };
    renderPage();
    expect(screen.getByRole('link', { name: 'Sign in to Azure' }).getAttribute('href')).toBe(
      '/azure/login'
    );
    expect(mocks.subscriptions).not.toHaveBeenCalled();
  });
  it('requires explicit subscriptions and works without a Kubernetes context', async () => {
    const api = provider();
    mocks.createProvider.mockReturnValue(api);
    renderPage();
    await screen.findByRole('checkbox', { name: /Test subscription/ });
    expect(api.listClusters).not.toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    await loadSubscriptions();
    await screen.findByRole('table', { name: 'Cluster readiness on current page' });
    expect(mocks.createProvider).toHaveBeenCalledWith([subscription]);
    expect(api.listClusters).toHaveBeenCalledTimes(1);
  });
  it('surfaces subscription errors and supports retry without data fallback', async () => {
    mocks.subscriptions.mockRejectedValueOnce(new Error('Azure login expired'));
    renderPage();
    expect(
      await screen.findByText(/Could not load subscriptions: Azure login expired/)
    ).toBeTruthy();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('checkbox', { name: /Test subscription/ });
  });
});

describe('inventory and account isolation', () => {
  it('discards the provider and aborts readiness on same-account auth updates', async () => {
    let resolve!: (value: Insight[]) => void;
    const first = provider({
      listInsights: vi.fn().mockReturnValue(
        new Promise<Insight[]>(done => {
          resolve = done;
        })
      ),
    });
    const second = provider();
    mocks.createProvider.mockReturnValueOnce(first).mockReturnValue(second);
    const view = renderPage();
    await loadSubscriptions();
    await waitFor(() => expect(first.listInsights).toHaveBeenCalled());
    const signal = vi.mocked(first.listInsights).mock.calls[0][1]!;
    act(() => window.dispatchEvent(new Event('azure-auth-update')));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Choose subscriptions')).toBeNull();
    // The native hook publishes a new status object even when account fields are unchanged.
    mocks.auth = { ...mocks.auth };
    view.rerender(
      <MemoryRouter>
        <UpgradeInsightsPage />
      </MemoryRouter>
    );
    const checkbox = await screen.findByRole('checkbox', { name: /Test subscription/ });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    await act(async () => resolve([passed()]));
    expect(screen.queryByRole('table')).toBeNull();
    expect(second.listClusters).not.toHaveBeenCalled();
    await loadSubscriptions();
    await screen.findByRole('table');
    expect(mocks.createProvider).toHaveBeenCalledTimes(2);
    expect(second.listClusters).toHaveBeenCalledTimes(1);
  });

  it('shows partial inventory and fleet warnings explicitly', async () => {
    mocks.createProvider.mockReturnValue(
      provider({
        listClusters: vi.fn().mockResolvedValue({
          clusters: [cluster],
          warnings: ['Subscription B: Forbidden'],
          fleetWarnings: ['Fleet members denied'],
        }),
      })
    );
    renderPage();
    await loadSubscriptions();
    expect(await screen.findByText(/Partial cluster inventory/)).toBeTruthy();
    expect(screen.getByText('Subscription B: Forbidden')).toBeTruthy();
    expect(screen.getByText('Fleet members denied')).toBeTruthy();
  });
  it('surfaces an inventory error instead of showing successful empty inventory', async () => {
    mocks.createProvider.mockReturnValue(
      provider({
        listClusters: vi.fn().mockRejectedValue(new Error('Inventory forbidden')),
      })
    );
    renderPage();
    await loadSubscriptions();
    expect(
      await screen.findByText('Could not load cluster inventory: Inventory forbidden')
    ).toBeTruthy();
    expect(screen.queryByText('Ready on page: 1')).toBeNull();
  });
  it('disabling preview cancels outstanding reads and hides cached readiness', async () => {
    const api = provider({ listInsights: vi.fn().mockReturnValue(new Promise(() => {})) });
    mocks.createProvider.mockReturnValue(api);
    const view = renderPage();
    await loadSubscriptions();
    await waitFor(() => expect(api.listInsights).toHaveBeenCalled());
    const signal = vi.mocked(api.listInsights).mock.calls[0][1]!;
    mocks.preview = false;
    view.rerender(
      <MemoryRouter>
        <UpgradeInsightsPage />
      </MemoryRouter>
    );
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Choose subscriptions')).toBeNull();
    expect(screen.getByText(/Upgrade Insights is disabled/)).toBeTruthy();
  });
  it('does not auto-select a same-name context, even with one candidate', async () => {
    mocks.context = cluster.name;
    renderPage(true);
    await loadSubscriptions();
    await screen.findByRole('table');
    expect(screen.getByText(/Context names are not authoritative/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Cluster insights:/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: cluster.name }));
    expect(
      await screen.findByRole('heading', { name: `Cluster insights: ${cluster.name}` })
    ).toBeTruthy();
  });
  it('invalidates stored insights once on manual refresh', async () => {
    const api = provider();
    mocks.createProvider.mockReturnValue(api);
    renderPage();
    await loadSubscriptions();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory and current page' }));
    await waitFor(() => expect(api.invalidateInsights).toHaveBeenCalledTimes(1));
    expect(api.listInsights).toHaveBeenCalledWith(cluster, expect.any(AbortSignal));
    expect(vi.mocked(api.listInsights).mock.calls.every(call => call[2] !== true)).toBe(true);
  });
  it('cancels and clears in-flight inventory immediately on auth update; ignores late responses', async () => {
    let resolve!: (value: ClusterInventory) => void;
    const api = provider({
      listClusters: vi.fn().mockReturnValue(
        new Promise<ClusterInventory>(done => {
          resolve = done;
        })
      ),
    });
    mocks.createProvider.mockReturnValue(api);
    const view = renderPage();
    await loadSubscriptions();
    await waitFor(() => expect(api.listClusters).toHaveBeenCalled());
    const signal = vi.mocked(api.listClusters).mock.calls[0][0]!;
    act(() => window.dispatchEvent(new Event('azure-auth-update')));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Choose subscriptions')).toBeNull();
    mocks.auth = { isLoggedIn: false, isChecking: false };
    view.rerender(
      <MemoryRouter>
        <UpgradeInsightsPage />
      </MemoryRouter>
    );
    await act(async () => resolve({ clusters: [cluster], warnings: [], fleetWarnings: [] }));
    expect(screen.getByRole('link', { name: 'Sign in to Azure' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('creates a new provider and discards selection when the account changes', async () => {
    const first = provider();
    const second = provider({
      listClusters: vi.fn().mockResolvedValue({ clusters: [], warnings: [], fleetWarnings: [] }),
    });
    mocks.createProvider.mockReturnValueOnce(first).mockReturnValue(second);
    const view = renderPage();
    await loadSubscriptions();
    await screen.findByRole('table');
    const signal = vi.mocked(first.listClusters).mock.calls[0][0]!;
    mocks.auth = { ...mocks.auth, username: 'second@example.test' };
    view.rerender(
      <MemoryRouter>
        <UpgradeInsightsPage />
      </MemoryRouter>
    );
    await screen.findByRole('checkbox', { name: /Test subscription/ });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('table')).toBeNull();
    expect(second.listClusters).not.toHaveBeenCalled();
    await loadSubscriptions();
    await waitFor(() => expect(second.listClusters).toHaveBeenCalledTimes(1));
  });
});
