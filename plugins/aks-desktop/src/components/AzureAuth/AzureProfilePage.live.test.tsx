// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import React from 'react';
import { Router } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { getLoginStatus } from '../../utils/azure/az-auth';
import {
  readLiveAzure,
  runReadOnlyAzureAuthCommand,
} from '../../utils/test/azureAuthLiveTestUtils';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../telemetry', () => ({ trackError: vi.fn() }));
vi.mock('../../telemetry/aksFeature', () => ({ trackAksFeature: vi.fn() }));

import { useAzureProfilePage } from './hooks/useAzureProfilePage';

describe.runIf(process.env.AZ_LIVE_TESTS === '1')('Azure profile state (live, no sign-in)', () => {
  beforeAll(() => {
    for (const method of ['debug', 'log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation(() => {});
    }
    vi.stubGlobal('pluginRunCommand', runReadOnlyAzureAuthCommand);
  });
  afterAll(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('loads the cached account and allows navigation without opening a browser', async () => {
    const account = await readLiveAzure(getLoginStatus);
    if (!account.isLoggedIn || !account.subscriptionId || !account.tenantId) {
      throw new Error('A cached Azure login is required; the live runner never starts az login.');
    }
    const browser = vi.spyOn(window, 'open');
    const history = createMemoryHistory({ initialEntries: ['/azure/profile'] });
    const wrapper = ({ children }: React.PropsWithChildren) => (
      <Router history={history}>{children}</Router>
    );
    const { result } = renderHook(useAzureProfilePage, { wrapper });
    // A hook-only render keeps account identifiers out of automatic DOM failure reports.
    await waitFor(() => expect(result.current.isChecking).toBe(false), { timeout: 45_000 });
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.username === account.username).toBe(true);
    expect(result.current.tenantId === account.tenantId).toBe(true);
    expect(result.current.subscriptionId === account.subscriptionId).toBe(true);
    act(() => result.current.handleAddCluster());
    expect(history.location.pathname).toBe('/add-cluster-aks');
    expect(browser).not.toHaveBeenCalled();
  }, 60_000);
});
