// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useState } from 'react';
import { getClusterCapabilities } from '../utils/azure/az-clusters';
import { getManagedNamespaceResourceId } from '../utils/azure/az-identity';
import { getClusterSettings } from '../utils/shared/clusterSettings';

/**
 * @param prev - Earlier capability diagnostic, if any.
 * @param next - Newly observed diagnostic.
 * @returns Messages joined with a semicolon, or next alone when no earlier error exists.
 */
function appendError(prev: string | null, next: string): string {
  return prev ? `${prev}; ${next}` : next;
}

/**
 * Coordinates for capability discovery; missing Azure coordinates suppress new reads.
 */
interface UseNamespaceCapabilitiesParams {
  /** Explicit Azure subscription, or undefined until selection is known. */
  subscriptionId: string | undefined;
  /** AKS resource group, or undefined until selection is known. */
  resourceGroup: string | undefined;
  /** Registered cluster name used for both Azure reads and the persisted Arc discriminator. */
  clusterName: string | undefined;
  /** Kubernetes namespace whose managed-resource status is being discovered. */
  namespace: string;
}

/**
 * Fetches managed-namespace and Azure RBAC capabilities without applying managed AKS reads to Arc.
 * @param params - Namespace identity and available Azure cluster coordinates.
 * @returns Current isManagedNamespace, azureRbacEnabled, azureRbacResolved, error, and retry state.
 * Managed status is undefined while loading/on a returned lookup failure, false
 * for confirmed absence, thrown lookup errors or Arc, and true for a resolved ID.
 * `azureRbacEnabled` is undefined while loading, on lookup errors, or for Arc; a successful
 * capability lookup with no RBAC field resolves to `false`. `azureRbacResolved` is true once
 * `getClusterCapabilities` succeeds or for Arc, and false while pending or after a lookup error,
 * allowing callers to distinguish a resolved disabled capability from a pending or failed read.
 * `error` collects lookup diagnostics, and `retry` re-triggers both capability lookups.
 * Effect cleanup ignores stale results but does not cancel the underlying reads.
 */
export function useNamespaceCapabilities({
  subscriptionId,
  resourceGroup,
  clusterName,
  namespace,
}: UseNamespaceCapabilitiesParams) {
  const [isManagedNamespace, setIsManagedNamespace] = useState<boolean | undefined>(undefined);
  const [azureRbacEnabled, setAzureRbacEnabled] = useState<boolean | undefined>(undefined);
  const [azureRbacResolved, setAzureRbacResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const retry = useCallback(() => setRefreshToken(count => count + 1), []);
  const isArcCluster = !!clusterName && getClusterSettings(clusterName).clusterType === 'aksarc';

  useEffect(() => {
    if (isArcCluster) {
      setIsManagedNamespace(false);
      setAzureRbacEnabled(undefined);
      setAzureRbacResolved(true);
      setError(null);
      return;
    }
    if (!subscriptionId || !resourceGroup || !clusterName) return;
    let cancelled = false;

    setIsManagedNamespace(undefined);
    setAzureRbacEnabled(undefined);
    setAzureRbacResolved(false);
    setError(null);

    getManagedNamespaceResourceId({
      clusterName,
      resourceGroup,
      namespaceName: namespace,
      subscriptionId,
    })
      .then(result => {
        if (!cancelled) {
          if (result.success) {
            // resourceId present → managed namespace; absent → regular namespace
            setIsManagedNamespace(!!result.resourceId);
          } else {
            setIsManagedNamespace(undefined);
            setError(prev =>
              appendError(prev, result.error ?? 'Failed to check managed namespace status')
            );
          }
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[useNamespaceCapabilities] Failed to check managed namespace:', err);
          setIsManagedNamespace(false);
          setError(prev =>
            appendError(
              prev,
              err instanceof Error ? err.message : 'Failed to check namespace capabilities'
            )
          );
        }
      });

    getClusterCapabilities({
      subscriptionId,
      resourceGroup,
      clusterName,
    })
      .then(caps => {
        if (!cancelled) {
          setAzureRbacEnabled(caps?.azureRbacEnabled ?? false);
          setAzureRbacResolved(true);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[useNamespaceCapabilities] Failed to get cluster capabilities:', err);
          setAzureRbacEnabled(undefined);
          setAzureRbacResolved(false);
          setError(prev =>
            appendError(
              prev,
              err instanceof Error ? err.message : 'Failed to get cluster capabilities'
            )
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [subscriptionId, resourceGroup, clusterName, namespace, isArcCluster, refreshToken]);

  return { isManagedNamespace, azureRbacEnabled, azureRbacResolved, error, retry };
}
