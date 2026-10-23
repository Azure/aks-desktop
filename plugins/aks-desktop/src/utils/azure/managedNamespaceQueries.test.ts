// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { isCancelledError, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AzureLoginStatus } from './az-auth';
import type { ManagedNamespaceTarget } from './managedNamespaceQueries';

const target: ManagedNamespaceTarget = {
  subscriptionId: 'subscription',
  resourceGroup: 'resource-group',
  clusterName: 'cluster',
  namespaceName: 'namespace',
};
const loggedIn: AzureLoginStatus = {
  isLoggedIn: true,
  username: 'user@example.com',
  tenantId: 'tenant',
  subscriptionId: 'subscription',
};

let runtime: typeof import('./managedNamespaceQueries');
const clients = new Set<QueryClient>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  runtime = await import('./managedNamespaceQueries');
  clients.add(runtime.managedNamespaceQueryClient);
});

afterEach(() => {
  clients.forEach(client => client.clear());
  clients.clear();
  vi.useRealTimers();
});

describe('managed namespace query client', () => {
  test('uses bounded freshness and disables automatic work', () => {
    const client = runtime.createManagedNamespaceQueryClient();
    clients.add(client);

    expect(client).not.toBe(runtime.managedNamespaceQueryClient);
    expect(client.getDefaultOptions()).toEqual({
      queries: {
        staleTime: 60_000,
        gcTime: 300_000,
        retry: false,
        networkMode: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
      },
      mutations: { retry: false },
    });
  });

  test('reuses fresh reads and refetches only after they become stale', async () => {
    vi.useFakeTimers();
    const client = runtime.managedNamespaceQueryClient;
    const queryKey = runtime.managedNamespaceQueryKey(target, 1);
    const queryFn = vi.fn().mockResolvedValue({ labels: { app: 'test' } });

    await client.fetchQuery({ queryKey, queryFn });
    vi.advanceTimersByTime(59_999);
    await client.fetchQuery({ queryKey, queryFn });
    expect(queryFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await client.fetchQuery({ queryKey, queryFn });
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  test('does not retry failed reads or writes', async () => {
    const client = runtime.managedNamespaceQueryClient;
    const error = new Error('Azure operation failed');
    const queryFn = vi.fn().mockRejectedValue(error);
    const mutationFn = vi.fn().mockRejectedValue(error);

    await expect(
      client.fetchQuery({ queryKey: runtime.managedNamespaceQueryKey(target, 1), queryFn })
    ).rejects.toBe(error);
    await expect(
      client.getMutationCache().build(client, { mutationFn }).execute(undefined)
    ).rejects.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});

describe('managed namespace query keys', () => {
  test('uses a structured target and a distinct disabled-query key', () => {
    expect(runtime.managedNamespaceQueryKey(target, 3)).toEqual([
      'aks-desktop',
      'managed-namespace',
      'details',
      3,
      target,
    ]);
    expect(runtime.managedNamespaceQueryKey(null, 3)).toEqual([
      'aks-desktop',
      'managed-namespace',
      'details',
      3,
      null,
    ]);
  });

  test('isolates each resource dimension and authentication generation', () => {
    const client = runtime.managedNamespaceQueryClient;
    const key = runtime.managedNamespaceQueryKey(target, 1);
    client.setQueryData(key, 'original');

    for (const field of Object.keys(target) as (keyof ManagedNamespaceTarget)[]) {
      const otherTarget = { ...target, [field]: `${target[field]}-other` };
      expect(client.getQueryData(runtime.managedNamespaceQueryKey(otherTarget, 1))).toBeUndefined();
    }
    expect(client.getQueryData(runtime.managedNamespaceQueryKey(target, 2))).toBeUndefined();
    expect(client.getQueryData(runtime.managedNamespaceQueryKey({ ...target }, 1))).toBe(
      'original'
    );
  });
});

describe('managed namespace authentication', () => {
  test('starts gated with a stable snapshot', () => {
    expect(runtime.getManagedNamespaceAuthState()).toEqual({ generation: 0, ready: false });
    expect(runtime.getManagedNamespaceAuthState()).toBe(runtime.getManagedNamespaceAuthState());
  });

  test('notifies on transitions but preserves snapshots and cache for the same identity', () => {
    const listener = vi.fn();
    const unsubscribe = runtime.subscribeManagedNamespaceAuth(listener);
    runtime.updateManagedNamespaceAuth(loggedIn);
    const snapshot = runtime.getManagedNamespaceAuthState();
    const key = runtime.managedNamespaceQueryKey(target, snapshot.generation);
    runtime.managedNamespaceQueryClient.setQueryData(key, 'cached');

    runtime.updateManagedNamespaceAuth({ ...loggedIn });
    runtime.updateManagedNamespaceAuth({ ...loggedIn, username: 'USER@EXAMPLE.COM' });

    expect(snapshot.ready).toBe(true);
    expect(runtime.getManagedNamespaceAuthState()).toBe(snapshot);
    expect(runtime.managedNamespaceQueryClient.getQueryData(key)).toBe('cached');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    runtime.invalidateManagedNamespaceAuth();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('synchronously gates and clears details and metadata before notifying', () => {
    runtime.updateManagedNamespaceAuth(loggedIn);
    const client = runtime.managedNamespaceQueryClient;
    const generation = runtime.getManagedNamespaceAuthState().generation;
    const detailsKey = runtime.managedNamespaceQueryKey(target, generation);
    const metadataKey = [
      'aks-desktop',
      'managed-namespace',
      'metadata',
      generation,
      target.clusterName,
      target.namespaceName,
    ];
    const unrelatedKey = ['aks-desktop', 'another-feature'];
    client.setQueryData(detailsKey, 'details');
    client.setQueryData(metadataKey, 'metadata');
    client.setQueryData(unrelatedKey, 'unrelated');
    const statesDuringRemoval: boolean[] = [];
    const unsubscribeCache = client.getQueryCache().subscribe(event => {
      if (event.type === 'removed') {
        statesDuringRemoval.push(runtime.getManagedNamespaceAuthState().ready);
      }
    });
    const unsubscribeAuth = runtime.subscribeManagedNamespaceAuth(() => {
      expect(client.getQueryData(detailsKey)).toBeUndefined();
      expect(client.getQueryData(metadataKey)).toBeUndefined();
    });

    runtime.invalidateManagedNamespaceAuth();

    expect(runtime.getManagedNamespaceAuthState()).toEqual({
      generation: generation + 1,
      ready: false,
    });
    expect(statesDuringRemoval).toEqual([false, false]);
    expect(client.getQueryData(unrelatedKey)).toBe('unrelated');
    runtime.updateManagedNamespaceAuth(loggedIn);
    expect(runtime.getManagedNamespaceAuthState()).toEqual({
      generation: generation + 1,
      ready: true,
    });
    unsubscribeCache();
    unsubscribeAuth();
  });

  test.each([
    { username: 'other@example.com' },
    { tenantId: 'other-tenant' },
    { subscriptionId: 'other-subscription' },
    { isLoggedIn: false },
    { isLoggedIn: false, error: 'Expired credentials' },
  ])('clears old identity data when status changes: %j', changedStatus => {
    runtime.updateManagedNamespaceAuth(loggedIn);
    const previous = runtime.getManagedNamespaceAuthState();
    const key = runtime.managedNamespaceQueryKey(target, previous.generation);
    runtime.managedNamespaceQueryClient.setQueryData(key, 'old account');
    const status = { ...loggedIn, ...changedStatus };

    runtime.updateManagedNamespaceAuth(status);

    expect(runtime.getManagedNamespaceAuthState()).toEqual({
      generation: previous.generation + 1,
      ready: status.isLoggedIn,
    });
    expect(runtime.managedNamespaceQueryClient.getQueryData(key)).toBeUndefined();
    const snapshot = runtime.getManagedNamespaceAuthState();
    runtime.updateManagedNamespaceAuth(status);
    expect(runtime.getManagedNamespaceAuthState()).toBe(snapshot);
  });

  test.each([
    { active: false, changeIdentity: false },
    { active: true, changeIdentity: false },
    { active: false, changeIdentity: true },
    { active: true, changeIdentity: true },
  ])('discards nonabortable late reads: %j', async ({ active, changeIdentity }) => {
    runtime.updateManagedNamespaceAuth(loggedIn);
    const client = runtime.managedNamespaceQueryClient;
    const key = runtime.managedNamespaceQueryKey(
      target,
      runtime.getManagedNamespaceAuthState().generation
    );
    const lateRead = deferred<string>();
    const queryFn = vi.fn(() => lateRead.promise);
    const result = client.fetchQuery({ queryKey: key, queryFn }).catch(error => error);
    const observer = new QueryObserver(client, { queryKey: key, queryFn });
    const unsubscribe = active ? observer.subscribe(() => {}) : () => {};
    expect(client.getQueryCache().find({ queryKey: key })?.isActive()).toBe(active);

    if (changeIdentity) {
      runtime.updateManagedNamespaceAuth({ ...loggedIn, username: 'other@example.com' });
    } else {
      runtime.invalidateManagedNamespaceAuth();
      runtime.updateManagedNamespaceAuth(loggedIn);
    }

    expect(isCancelledError(await result)).toBe(true);
    const freshKey = runtime.managedNamespaceQueryKey(
      target,
      runtime.getManagedNamespaceAuthState().generation
    );
    await client.fetchQuery({ queryKey: freshKey, queryFn: async () => 'new account' });
    lateRead.resolve('old account');
    await lateRead.promise;
    await Promise.resolve();

    expect(client.getQueryState(key)).toBeUndefined();
    expect(client.getQueryData(freshKey)).toBe('new account');
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
    observer.destroy();
  });
});
