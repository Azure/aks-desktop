// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import { getClusters, getSubscriptions } from '../../../utils/azure/az-cli';
import { AzureResourceState } from '../types';

/**
 * Custom hook for managing Azure resources (subscriptions and clusters)
 */
export const useAzureResources = () => {
  const [state, setState] = useState<AzureResourceState>({
    subscriptions: [],
    clusters: [],
    loading: false,
    loadingClusters: false,
    error: null,
    clusterError: null,
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
      setState(prev => ({ ...prev, loadingClusters: true, clusterError: null, clusters: [] }));
      const clusterList = await getClusters(subscriptionId, '[?aadProfile!=null]');
      setState(prev => ({ ...prev, clusters: clusterList, loadingClusters: false }));
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
    setState(prev => ({ ...prev, clusters: [], clusterError: null }));
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
