// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useState } from 'react';
import { getClusterInfo } from '../utils/azure/az-cli';
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
): { azureContext: AzureContext | null; error: string | null } => {
  const { t } = useTranslation();
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cluster, azureAuth.isLoggedIn, azureAuth.tenantId]);

  return { azureContext, error };
};
