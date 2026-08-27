// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared rules for reading an Azure cluster's state, so every cluster picker
 * (the Add Cluster dialog and the Create Project wizard) reaches the same
 * verdict about the same cluster.
 */

/**
 * The subset of cluster fields these rules need. Cluster lists in this plugin
 * carry them under different names (`AzureCluster.status` vs
 * `AKSCluster.provisioningState`), so callers map into this shape.
 */
export interface ClusterState {
  /** `'aks'` for managed clusters, `'aksarc'` for Arc-connected ones. */
  clusterType?: 'aks' | 'aksarc';
  /** The cluster resource's ARM `provisioningState` (e.g. `Succeeded`, `Failed`). */
  provisioningState: string;
  /**
   * Arc agent heartbeat for AKS Hybrid & Edge clusters (`'Connected'` |
   * `'Offline'` | `'Expired'`…); `undefined` for managed AKS.
   */
  connectivityStatus?: string;
}

/**
 * Returns `true` when an AKS Hybrid & Edge cluster's Arc agent reports
 * `Connected`. Cluster-connect runs through that agent, so an offline cluster
 * cannot be reached at all.
 *
 * Always `true` for managed AKS clusters, which carry no heartbeat.
 *
 * This is a *cached* heartbeat and only ever gates a picker. Whether a connected
 * Arc cluster is actually usable is settled by a live Kubernetes API probe
 * (`checkClusterAccessible`) once it is selected.
 */
export function isAksHybridEdgeOnline(cluster: ClusterState): boolean {
  return cluster.clusterType !== 'aksarc' || cluster.connectivityStatus === 'Connected';
}

/** Returns `true` when the cluster's provisioning state is `Failed`. */
export function isClusterFailed(cluster: ClusterState): boolean {
  return (cluster.provisioningState?.toLowerCase() || '') === 'failed';
}

/**
 * The state to show against a cluster in a picker.
 *
 * `provisioningState` only reflects whether the ARM deployment finished, and for
 * an Arc cluster it stays `Succeeded` from creation onward however sick the
 * cluster becomes — so an offline Arc cluster would otherwise read "Succeeded".
 * Prefer whichever signal is the more specific: a `Failed` provisioning state
 * names the actual fault, otherwise the offline heartbeat is what the user needs
 * to see.
 */
export function getClusterStateLabel(cluster: ClusterState): string {
  if (!isClusterFailed(cluster) && !isAksHybridEdgeOnline(cluster)) {
    return cluster.connectivityStatus || 'Unknown';
  }
  return cluster.provisioningState;
}
