// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import { checkNamespaceExists } from '../../../utils/azure/az-namespace-access';
import { fetchNamespaceData } from '../../../utils/kubernetes/namespaceUtils';
import type { NamespaceStatus } from '../types';

/** Set to `true` locally to enable verbose debug logging. Never enable in production. */
const DEBUG = false;

/**
 * Custom hook for managing namespace existence checks
 */
export const useNamespaceCheck = () => {
  const [status, setStatus] = useState<NamespaceStatus>({
    exists: null,
    checking: false,
    error: null,
  });

  const checkNamespace = useCallback(
    async (
      clusterName: string,
      resourceGroup: string,
      namespaceName: string,
      subscriptionId: string
    ) => {
      if (
        !clusterName.trim() ||
        !resourceGroup.trim() ||
        !namespaceName.trim() ||
        !subscriptionId
      ) {
        setStatus({ exists: null, checking: false, error: null });
        return;
      }

      try {
        setStatus(prev => ({ ...prev, checking: true, error: null }));

        if (DEBUG)
          console.debug('🔍 Checking namespace existence:', {
            cluster: clusterName,
            resourceGroup,
            namespace: namespaceName,
            subscription: subscriptionId,
          });

        const result = await checkNamespaceExists(
          clusterName,
          resourceGroup,
          namespaceName,
          subscriptionId
        );

        if (DEBUG) console.debug('Namespace check result:', result.exists);

        if (result.error) {
          setStatus(prev => ({
            ...prev,
            error: result.error,
            exists: null,
          }));
        } else {
          setStatus(prev => ({
            ...prev,
            exists: result.exists,
            error: null,
          }));
        }
      } catch (error) {
        console.error('Failed to check namespace:', error);
        setStatus(prev => ({
          ...prev,
          error: 'Failed to check namespace existence',
          exists: null,
        }));
      } finally {
        setStatus(prev => ({ ...prev, checking: false }));
      }
    },
    []
  );

  /**
   * Arc (AKS Hybrid & Edge) counterpart to {@link checkNamespace}. Arc clusters
   * have no `az aks namespace` surface, so existence is checked directly through
   * the Kubernetes API via the cluster's kubeconfig context. A rejected fetch is
   * treated as "does not exist" (name available) — a genuine apply-time conflict
   * is surfaced separately when the manifest is applied.
   */
  const checkNamespaceViaK8s = useCallback(async (clusterName: string, namespaceName: string) => {
    if (!clusterName.trim() || !namespaceName.trim()) {
      setStatus({ exists: null, checking: false, error: null });
      return;
    }

    setStatus(prev => ({ ...prev, checking: true, error: null }));
    try {
      await fetchNamespaceData(namespaceName, clusterName);
      setStatus({ exists: true, checking: false, error: null });
    } catch {
      // Not found (or unreachable): treat as available for the pre-check.
      setStatus({ exists: false, checking: false, error: null });
    }
  }, []);

  const clearStatus = useCallback(() => {
    setStatus({ exists: null, checking: false, error: null });
  }, []);

  return {
    ...status,
    checkNamespace,
    checkNamespaceViaK8s,
    clearStatus,
  };
};
