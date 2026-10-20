// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import { getClusterInfo } from '../utils/azure/az-clusters';
import { useAzureAuth } from './useAzureAuth';

export interface AzureContext {
  /** The Azure subscription ID containing the AKS cluster. */
  subscriptionId: string;
  /** The resource group name containing the AKS cluster. */
  resourceGroup: string;
  /** The Azure AD tenant ID associated with the subscription. */
  tenantId: string;
}

export const useAzureContext = (
  cluster: string | undefined
): { azureContext: AzureContext | null; error: string | null; isLoading: boolean } => {
  const { t } = useTranslation();
  const azureAuth = useAzureAuth();
  const [azureContext, setAzureContext] = useState<AzureContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Match what the effect sets, so the first render doesn't show a stale state.
  const [isLoading, setIsLoading] = useState(
    () => Boolean(cluster) && (azureAuth.isChecking || azureAuth.isLoggedIn)
  );

  useEffect(() => {
    if (!cluster) {
      setAzureContext(null);
      setIsLoading(false);
      setError(t('No cluster is associated with this project.'));
      return;
    }
    // isLoggedIn is only meaningful once isChecking clears.
    if (azureAuth.isChecking) {
      setIsLoading(true);
      setError(null);
      return;
    }
    if (!azureAuth.isLoggedIn) {
      setAzureContext(null);
      setIsLoading(false);
      setError(t('Please sign in to Azure to continue.'));
      return;
    }
    setAzureContext(null); // clear stale context during fetch
    setError(null);
    setIsLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const clusterInfo = await getClusterInfo(cluster);
        if (!cancelled) {
          const subscriptionId = clusterInfo.subscriptionId;
          const resourceGroup = clusterInfo.resourceGroup;
          const tenantId = azureAuth.tenantId;

          if (!subscriptionId || !resourceGroup || !tenantId) {
            console.error('Missing required Azure context fields:', {
              subscriptionId,
              resourceGroup,
              tenantId,
            });
            setAzureContext(null);
            setError(
              t(
                'Missing required Azure context. Please ensure you are logged in and the cluster is associated with a valid subscription, resource group, and tenant.'
              )
            );
            return;
          }

          setAzureContext({
            subscriptionId,
            resourceGroup,
            tenantId,
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to resolve Azure context:', err);
          setError(err instanceof Error ? err.message : t('Failed to load Azure context'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cluster, azureAuth.isChecking, azureAuth.isLoggedIn, azureAuth.tenantId]);

  return { azureContext, error, isLoading };
};
