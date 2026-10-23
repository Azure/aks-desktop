// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import React, { useSyncExternalStore } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AzureLoginStatus } from './utils/azure/az-auth';
import { AZURE_ACCOUNT_POLL_INTERVAL_MS } from './utils/constants/timing';

const mocks = vi.hoisted(() => ({
  getLoginStatus: vi.fn(),
}));

vi.mock('./utils/azure/az-auth', async importOriginal => ({
  ...(await importOriginal<typeof import('./utils/azure/az-auth')>()),
  getLoginStatus: mocks.getLoginStatus,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', async importOriginal => ({
  ...(await importOriginal<typeof import('@kinvolk/headlamp-plugin/lib')>()),
  Headlamp: { isRunningAsApp: () => true, setAppMenu: vi.fn() },
  registerAddClusterProvider: vi.fn(),
  registerAppBarAction: vi.fn(),
  registerAppLogo: vi.fn(),
  registerAppTheme: vi.fn(),
  registerClusterEmptyState: vi.fn(),
  registerClusterProviderDialog: vi.fn(),
  registerClusterProviderMenuItem: vi.fn(),
  registerClusterProviderPreOpen: vi.fn(),
  registerCustomCreateProject: vi.fn(),
  registerPluginSettings: vi.fn(),
  registerProjectDeleteButton: vi.fn(),
  registerProjectDetailsTab: vi.fn(),
  registerProjectHeaderAction: vi.fn(),
  registerProjectOverviewSection: vi.fn(),
  registerRoute: vi.fn(),
  registerSidebarEntry: vi.fn(),
}));

const loggedIn: AzureLoginStatus = {
  isLoggedIn: true,
  username: 'user@example.com',
  tenantId: 'tenant',
  subscriptionId: 'subscription',
};
const newIdentity: AzureLoginStatus = {
  isLoggedIn: true,
  username: 'other@example.com',
  tenantId: 'other-tenant',
  subscriptionId: 'other-subscription',
};
const target = {
  subscriptionId: 'subscription',
  resourceGroup: 'resource-group',
  clusterName: 'cluster',
  namespaceName: 'namespace',
};
let runtime: typeof import('./utils/azure/managedNamespaceQueries');
let removeBootstrapListeners: () => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pollAccount() {
  return vi.advanceTimersByTimeAsync(AZURE_ACCOUNT_POLL_INTERVAL_MS);
}

function metadataKey(generation: number) {
  return [
    'aks-desktop',
    'managed-namespace',
    'metadata',
    generation,
    target.clusterName,
    target.namespaceName,
  ] as const;
}

describe('index Azure authentication bootstrap', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const addListener = vi.spyOn(window, 'addEventListener');
    mocks.getLoginStatus.mockResolvedValue(loggedIn);
    await import('./index');
    runtime = await import('./utils/azure/managedNamespaceQueries');
    expect(runtime.getManagedNamespaceAuthState().ready).toBe(true);
    const bootstrapListeners = addListener.mock.calls.filter(([type]) =>
      ['azure-auth-update', 'focus', 'blur'].includes(type)
    );
    removeBootstrapListeners = () => {
      bootstrapListeners.forEach(([type, listener, options]) =>
        window.removeEventListener(type, listener, options)
      );
    };
  });

  beforeEach(async () => {
    mocks.getLoginStatus.mockReset().mockResolvedValue(loggedIn);
    await pollAccount();
    mocks.getLoginStatus.mockClear();
  });

  afterEach(() => {
    cleanup();
    runtime.managedNamespaceQueryClient.clear();
  });

  afterAll(() => {
    removeBootstrapListeners?.();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (window as any).__azureAuthStatus;
  });

  test.each(['resolve', 'reject'] as const)(
    'ignores an older account check that later %ss',
    async outcome => {
      const older = deferred<AzureLoginStatus>();
      mocks.getLoginStatus.mockReturnValueOnce(older.promise).mockResolvedValueOnce(newIdentity);
      await pollAccount();
      expect(mocks.getLoginStatus).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('azure-auth-update'));
      await vi.advanceTimersByTimeAsync(0);
      const newestSnapshot = runtime.getManagedNamespaceAuthState();
      const key = runtime.managedNamespaceQueryKey(target, newestSnapshot.generation);
      runtime.managedNamespaceQueryClient.setQueryData(key, 'new identity');
      expect(newestSnapshot.ready).toBe(true);
      expect((window as any).__azureAuthStatus).toMatchObject(newIdentity);

      if (outcome === 'resolve') {
        older.resolve(loggedIn);
      } else {
        older.reject(new Error('Old account lookup failed'));
      }
      await vi.advanceTimersByTimeAsync(0);

      expect(runtime.getManagedNamespaceAuthState()).toBe(newestSnapshot);
      expect((window as any).__azureAuthStatus).toMatchObject(newIdentity);
      expect(runtime.managedNamespaceQueryClient.getQueryData(key)).toBe('new identity');
    }
  );

  test('preserves cached data and the auth generation during a same-identity poll', async () => {
    const snapshot = runtime.getManagedNamespaceAuthState();
    const key = runtime.managedNamespaceQueryKey(target, snapshot.generation);
    runtime.managedNamespaceQueryClient.setQueryData(key, 'cached');

    await pollAccount();

    expect(mocks.getLoginStatus).toHaveBeenCalledTimes(1);
    expect(runtime.getManagedNamespaceAuthState()).toBe(snapshot);
    expect(runtime.managedNamespaceQueryClient.getQueryData(key)).toBe('cached');
  });

  test('gates active queries synchronously until the new account check resolves', async () => {
    const status = deferred<AzureLoginStatus>();
    mocks.getLoginStatus.mockReturnValueOnce(status.promise);
    const client = runtime.managedNamespaceQueryClient;
    const previous = runtime.getManagedNamespaceAuthState();
    const previousDetailsKey = runtime.managedNamespaceQueryKey(target, previous.generation);
    const previousMetadataKey = metadataKey(previous.generation);
    client.setQueryData(previousDetailsKey, 'old details');
    client.setQueryData(previousMetadataKey, 'old metadata');
    const readDetails = vi.fn(async () => 'new details');
    const readMetadata = vi.fn(async () => 'new metadata');

    function GatedQueries() {
      const auth = useSyncExternalStore(
        runtime.subscribeManagedNamespaceAuth,
        runtime.getManagedNamespaceAuthState
      );
      useQuery({
        queryKey: runtime.managedNamespaceQueryKey(target, auth.generation),
        queryFn: readDetails,
        enabled: auth.ready,
      });
      useQuery({
        queryKey: metadataKey(auth.generation),
        queryFn: readMetadata,
        enabled: auth.ready,
      });
      return null;
    }

    render(
      React.createElement(QueryClientProvider, {
        client,
        children: React.createElement(GatedQueries),
      })
    );
    expect(client.getQueryCache().find({ queryKey: previousDetailsKey })?.isActive()).toBe(true);
    expect(client.getQueryCache().find({ queryKey: previousMetadataKey })?.isActive()).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event('azure-auth-update'));
      expect(runtime.getManagedNamespaceAuthState()).toEqual({
        generation: previous.generation + 1,
        ready: false,
      });
      expect(client.getQueryData(previousDetailsKey)).toBeUndefined();
      expect(client.getQueryData(previousMetadataKey)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(0);
    });

    const pending = runtime.getManagedNamespaceAuthState();
    expect(pending.ready).toBe(false);
    expect(client.getQueryState(previousDetailsKey)).toBeUndefined();
    expect(client.getQueryState(previousMetadataKey)).toBeUndefined();
    expect(
      client.getQueryState(runtime.managedNamespaceQueryKey(target, pending.generation))
        ?.fetchStatus
    ).toBe('idle');
    expect(client.getQueryState(metadataKey(pending.generation))?.fetchStatus).toBe('idle');
    expect(readDetails).not.toHaveBeenCalled();
    expect(readMetadata).not.toHaveBeenCalled();

    await act(async () => {
      status.resolve(newIdentity);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(runtime.getManagedNamespaceAuthState().ready).toBe(true);
    expect(readDetails).toHaveBeenCalledTimes(1);
    expect(readMetadata).toHaveBeenCalledTimes(1);
  });
});
