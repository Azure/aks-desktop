// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';
import { getClusterInfo } from '../utils/azure/az-cli';
import { useAzureAuth } from './useAzureAuth';

export interface AzureContext {
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
}

export const useAzureContext = (
  cluster: string | undefined
): { azureContext: AzureContext | null; error: string | null } => {
  const azureAuth = useAzureAuth();
  const [azureContext, setAzureContext] = useState<AzureContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cluster || !azureAuth.isLoggedIn) {
      setAzureContext(null);
      setError(null);
      return;
    }
    setAzureContext(null); // clear stale context during fetch
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const clusterInfo = await getClusterInfo(cluster);
        if (!cancelled) {
          setAzureContext({
            subscriptionId: clusterInfo.subscriptionId ?? '',
            resourceGroup: clusterInfo.resourceGroup ?? '',
            tenantId: azureAuth.tenantId ?? '',
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to resolve Azure context:', err);
          setError(err instanceof Error ? err.message : 'Failed to load Azure context');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cluster, azureAuth.isLoggedIn, azureAuth.tenantId]);

  return { azureContext, error };
};
