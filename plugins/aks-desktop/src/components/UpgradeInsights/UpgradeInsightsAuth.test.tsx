// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Insight } from '../../types/upgradeInsights';
import { getLoginStatus } from '../../utils/azure/az-auth';
import { cluster, passed, provider } from './__fixtures__/fixtures';
import UpgradeInsightsPage from './UpgradeInsightsPage';

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  subscriptions: vi.fn(),
  createProvider: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  Headlamp: { isRunningAsApp: () => true },
  K8s: { useCluster: () => null },
  useTranslation: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => String(values?.[key] ?? '')),
  }),
}));
vi.mock('../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ upgradeInsights: true }),
}));
vi.mock('../../utils/azure/upgrade-insights', () => ({
  getUpgradeInsightSubscriptions: mocks.subscriptions,
  createUpgradeInsightsProvider: mocks.createProvider,
}));
vi.mock('../../utils/azure/az-cli-core', () => ({
  runCommandAsync: mocks.command,
  debugLog: vi.fn(),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unknown error'),
  isAzCliLoggedIn: vi.fn(),
  isAzError: (stderr: string) => stderr.includes('ERROR:'),
  isCliNotFoundError: () => false,
  needsRelogin: () => false,
}));
vi.mock('../../utils/azure/az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI.',
}));

const account = (name: string) => ({
  stdout: JSON.stringify({
    id: cluster.subscription,
    tenantId: name,
    user: { name: `${name}@example.test` },
  }),
  stderr: '',
});
const subscription = { id: cluster.subscription, name: 'Test subscription', tenantId: 'first' };
const mountPage = () =>
  render(
    <MemoryRouter>
      <UpgradeInsightsPage />
    </MemoryRouter>
  );
async function loadSubscriptions() {
  fireEvent.click(await screen.findByRole('checkbox', { name: /Test subscription/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Load selected subscriptions' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.command.mockResolvedValue(account('first'));
  mocks.subscriptions.mockResolvedValue([subscription]);
  mocks.createProvider.mockReturnValue(provider());
});
afterEach(cleanup);

describe('detected CLI account changes with the real authentication hook', () => {
  it('aborts pending readiness and requires a fresh subscription selection after an external switch', async () => {
    let oldRead!: (insights: Insight[]) => void;
    const first = provider({
      listInsights: vi.fn().mockReturnValue(new Promise(resolve => (oldRead = resolve))),
    });
    const second = provider();
    mocks.createProvider.mockReturnValueOnce(first).mockReturnValue(second);
    mountPage();
    await loadSubscriptions();
    await waitFor(() => expect(first.listInsights).toHaveBeenCalled());
    const signal = vi.mocked(first.listInsights).mock.calls[0][1]!;

    let finishCheck!: (value: ReturnType<typeof account>) => void;
    mocks.command
      .mockResolvedValueOnce(account('second'))
      .mockReturnValueOnce(new Promise(resolve => (finishCheck = resolve)))
      .mockResolvedValue(account('second'));
    await act(async () => {
      await getLoginStatus();
    });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Choose subscriptions')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Checking Azure account' })).toBeTruthy();
    await act(async () => {
      oldRead([passed()]);
      finishCheck(account('second'));
    });
    const checkbox = await screen.findByRole('checkbox', { name: /Test subscription/ });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('table')).toBeNull();
    expect(second.listClusters).not.toHaveBeenCalled();
    await loadSubscriptions();
    await screen.findByRole('table');
    expect(mocks.createProvider).toHaveBeenCalledTimes(2);
  });

  it('aborts confirmed generation and drops late results after external logout', async () => {
    let complete!: (insight: Insight) => void;
    const api = provider({
      generate: vi.fn().mockReturnValue(new Promise(resolve => (complete = resolve))),
    });
    mocks.createProvider.mockReturnValue(api);
    mountPage();
    await loadSubscriptions();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: cluster.name }));
    await screen.findByText('Stored readiness: Ready');
    const target = screen.getByRole('combobox', { name: 'Target Kubernetes version' });
    await waitFor(() => expect(target.getAttribute('aria-disabled')).not.toBe('true'));
    fireEvent.mouseDown(target);
    fireEvent.click(await screen.findByRole('option', { name: '1.34.2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm POST and generate' }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(api.generate).mock.calls[0][2]!;
    mocks.command.mockResolvedValue({ stdout: '', stderr: 'ERROR: Please run az login' });
    await act(async () => {
      await getLoginStatus();
    });
    expect(signal.aborted).toBe(true);
    await screen.findByRole('link', { name: 'Sign in to Azure' });
    await act(async () => complete(passed()));
    expect(screen.queryByText(/Stored readiness/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Choose subscriptions')).toBeNull();
  }, 10000);

  it('does not reset the session on an unchanged focus or periodic account observation', async () => {
    const api = provider();
    mocks.createProvider.mockReturnValue(api);
    mountPage();
    await loadSubscriptions();
    await screen.findByRole('table');
    const reads = mocks.command.mock.calls.length;
    const discovery = mocks.subscriptions.mock.calls.length;
    await act(async () => {
      await getLoginStatus();
    });
    expect(mocks.command).toHaveBeenCalledTimes(reads + 1);
    expect(mocks.subscriptions).toHaveBeenCalledTimes(discovery);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(mocks.createProvider).toHaveBeenCalledTimes(1);
  });
});
