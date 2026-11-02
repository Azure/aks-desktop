// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import { getClusters, getConnectedClusters } from '../../../utils/azure/az-clusters';
import { getClusterCount } from '../../../utils/azure/az-resource-graph';
import { getSubscriptions } from '../../../utils/azure/az-subscriptions';
import type { AzureCluster, AzureResourceState } from '../types';

/**
 * Custom hook for managing Azure resources (subscriptions and clusters)
 */
export const useAzureResources = () => {
  const [state, setState] = useState<AzureResourceState>({
    subscriptions: [],
    clusters: [],
    totalClusterCount: null,
    loading: false,
    loadingClusters: false,
    error: null,
    clusterError: null,
    arcDiscoveryUnavailable: null,
  });

  const fetchSubscriptions = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const subs = await getSubscriptions();
      setState(prev => ({ ...prev, subscriptions: subs, loading: false }));
      return subs;
    } catch (err) {
      console.error('Failed to fetch subscriptions:', err);
      let errorMessage = err.message || 'Failed to fetch subscriptions';

      // Provide more specific error messages
      if (errorMessage.includes('Azure CLI (az) command not found')) {
        errorMessage = 'Azure CLI is not installed. Please install Azure CLI and try again.';
      } else if (errorMessage.includes('Please log in to Azure CLI')) {
        errorMessage = 'Please log in to Azure CLI first. Use "az login" in your terminal.';
      }

      setState(prev => ({ ...prev, error: errorMessage, loading: false }));
      throw err;
    }
  }, []);

  const fetchClusters = useCallback(async (subscriptionId: string) => {
    try {
      setState(prev => ({
        ...prev,
        loadingClusters: true,
        clusterError: null,
        arcDiscoveryUnavailable: null,
        clusters: [],
        totalClusterCount: null,
      }));
      // Managed AKS clusters are filtered to Entra-ID (managed namespaces require it).
      // AKS Hybrid & Edge clusters are listed separately; getConnectedClusters never throws.
      const [aksClusters, arcDiscovery, totalCount] = await Promise.all([
        getClusters(subscriptionId, '[?aadProfile!=null]'),
        getConnectedClusters(subscriptionId),
        getClusterCount(subscriptionId),
      ]);
      // Tag managed clusters explicitly. Arc clusters carry their heartbeat
      // (connectivityStatus) into state because their `status` — the connected
      // cluster's provisioningState — stays `Succeeded` even once the cluster has
      // gone offline, so it is the only signal the dropdown can show or gate on.
      // Reachability of a *connected* Arc cluster is still settled by a live API
      // probe once it is selected, not by this cached heartbeat.
      const managed: AzureCluster[] = aksClusters.map((c: AzureCluster) => ({
        ...c,
        clusterType: 'aks',
      }));
      const arcClusters = arcDiscovery.clusters;
      const arc: AzureCluster[] = arcClusters.map(c => ({
        name: c.name,
        location: c.location,
        version: c.version,
        nodeCount: c.nodeCount ?? 0,
        status: c.status,
        resourceGroup: c.resourceGroup,
        powerState: c.powerState,
        clusterType: 'aksarc' as const,
        connectivityStatus: c.connectivityStatus,
        azureRbacEnabled: c.azureRbacEnabled,
      }));
      const clusterList: AzureCluster[] = [...managed, ...arc];
      // getClusterCount only counts managed AKS. The "hidden" helper text computes
      // totalClusterCount - clusters.length; since clusters.length now also includes
      // Arc clusters, add them back into the total so the hidden count stays equal to
      // (managed AKS in subscription) - (managed AKS shown after the Entra-ID filter).
      const normalizedTotalCount = totalCount < 0 ? null : totalCount + arcClusters.length;
      setState(prev => ({
        ...prev,
        clusters: clusterList,
        totalClusterCount: normalizedTotalCount,
        arcDiscoveryUnavailable: arcDiscovery.error ?? null,
        loadingClusters: false,
      }));
      return clusterList;
    } catch (err) {
      console.error('Failed to fetch clusters:', err);
      let errorMessage = err.message || 'Failed to fetch clusters';

      // Provide more specific error messages
      if (errorMessage.includes('Azure CLI (az) command not found')) {
        errorMessage = 'Azure CLI is not installed. Please install Azure CLI and try again.';
      } else if (errorMessage.includes('Please log in to Azure CLI')) {
        errorMessage = 'Please log in to Azure CLI first. Use "az login" in your terminal.';
      }

      setState(prev => ({ ...prev, clusterError: errorMessage, loadingClusters: false }));
      throw err;
    }
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const clearClusterError = useCallback(() => {
    setState(prev => ({ ...prev, clusterError: null }));
  }, []);

  const clearClusters = useCallback(() => {
    setState(prev => ({
      ...prev,
      clusters: [],
      clusterError: null,
      arcDiscoveryUnavailable: null,
    }));
  }, []);

  return {
    ...state,
    fetchSubscriptions,
    fetchClusters,
    clearError,
    clearClusterError,
    clearClusters,
  };
};
