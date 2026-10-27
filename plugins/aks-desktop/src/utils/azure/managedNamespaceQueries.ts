// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { QueryClient } from '@tanstack/react-query';
import type { AzureLoginStatus } from './az-auth';

export interface ManagedNamespaceTarget {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  namespaceName: string;
}

export interface ManagedNamespaceDetails {
  properties?: {
    defaultNetworkPolicy?: {
      ingress?: string;
      egress?: string;
      [key: string]: unknown;
    };
    defaultResourceQuota?: {
      cpuRequest?: string;
      cpuLimit?: string;
      memoryRequest?: string;
      memoryLimit?: string;
      [key: string]: unknown;
    };
    labels?: Record<string, string>;
    [key: string]: unknown;
  };
  metadata?: {
    labels?: Record<string, string>;
    [key: string]: unknown;
  };
  labels?: Record<string, string>;
  [key: string]: unknown;
}

const managedNamespaceQueryPrefix = ['aks-desktop', 'managed-namespace'] as const;

export function createManagedNamespaceQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: false,
        networkMode: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const managedNamespaceQueryClient = createManagedNamespaceQueryClient();

/** A null target is reserved for disabled queries before target resolution. */
export function managedNamespaceQueryKey(
  target: ManagedNamespaceTarget | null,
  generation: number
) {
  return [
    ...managedNamespaceQueryPrefix,
    'details',
    generation,
    target ? { ...target } : null,
  ] as const;
}

let authState: Readonly<{ generation: number; ready: boolean }> = {
  generation: 0,
  ready: false,
};
let authIdentity: string | null = null;
const authListeners = new Set<() => void>();

export function getManagedNamespaceAuthState() {
  return authState;
}

export function subscribeManagedNamespaceAuth(listener: () => void) {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

function clearManagedNamespaceQueries() {
  // Azure CLI reads cannot be aborted. Cancellation discards their eventual results.
  void managedNamespaceQueryClient.cancelQueries({ queryKey: managedNamespaceQueryPrefix });
  managedNamespaceQueryClient.removeQueries({ queryKey: managedNamespaceQueryPrefix });
}

/** Gate reads synchronously before an asynchronous account-status check. */
export function invalidateManagedNamespaceAuth() {
  authState = { generation: authState.generation + 1, ready: false };
  clearManagedNamespaceQueries();
  authListeners.forEach(listener => listener());
}

export function updateManagedNamespaceAuth(status: AzureLoginStatus) {
  const identity = status.isLoggedIn
    ? JSON.stringify(
        [status.username, status.tenantId, status.subscriptionId].map(value =>
          value?.trim().toLowerCase()
        )
      )
    : null;
  const identityChanged = identity !== authIdentity;

  if (!identityChanged && authState.ready === status.isLoggedIn) {
    return;
  }

  authIdentity = identity;
  authState = {
    generation: authState.generation + (identityChanged ? 1 : 0),
    ready: status.isLoggedIn,
  };
  if (identityChanged) {
    clearManagedNamespaceQueries();
  }
  authListeners.forEach(listener => listener());
}
