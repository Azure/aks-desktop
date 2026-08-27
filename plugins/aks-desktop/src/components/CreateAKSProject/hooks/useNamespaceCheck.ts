// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useRef, useState } from 'react';
import { checkNamespaceExists } from '../../../utils/azure/az-namespace-access';
import { fetchNamespaceData } from '../../../utils/kubernetes/namespaceUtils';
import type { NamespaceStatus } from '../types';

/** Set to `true` locally to enable verbose debug logging. Never enable in production. */
const DEBUG = false;

/**
 * Custom hook for managing namespace existence checks
 */
export const useNamespaceCheck = () => {
  // Identifies the newest check. Overlapping requests can settle out of order —
  // change the project name or cluster mid-flight and an older answer, arriving
  // last, would decide whether Next is blocked for the current selection.
  const requestIdRef = useRef(0);

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

      const thisRequest = ++requestIdRef.current;
      /** False once a newer check (or a clear) has superseded this one. */
      const isCurrent = () => requestIdRef.current === thisRequest;

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

        if (!isCurrent()) {
          return;
        }

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
        if (!isCurrent()) {
          return;
        }
        setStatus(prev => ({
          ...prev,
          error: 'Failed to check namespace existence',
          exists: null,
        }));
      } finally {
        // Only the newest check owns the spinner; an older one finishing must not
        // clear it while the current request is still running.
        if (isCurrent()) {
          setStatus(prev => ({ ...prev, checking: false }));
        }
      }
    },
    []
  );

  /**
   * Arc (AKS Hybrid & Edge) counterpart to {@link checkNamespace}. Arc clusters
   * have no `az aks namespace` surface, so existence is checked directly through
   * the Kubernetes API via the cluster's kubeconfig context. Only a confirmed 404
   * means the name is free: any other failure (no permission, a timeout, a server
   * error) leaves availability unknown and is recorded as an error, which blocks
   * the step rather than letting creation proceed on a guess.
   */
  const checkNamespaceViaK8s = useCallback(async (clusterName: string, namespaceName: string) => {
    if (!clusterName.trim() || !namespaceName.trim()) {
      setStatus({ exists: null, checking: false, error: null });
      return;
    }

    const thisRequest = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === thisRequest;

    setStatus(prev => ({ ...prev, checking: true, error: null }));
    try {
      await fetchNamespaceData(namespaceName, clusterName);
      if (!isCurrent()) {
        return;
      }
      setStatus({ exists: true, checking: false, error: null });
    } catch (err) {
      if (!isCurrent()) {
        return;
      }
      // Only a confirmed 404 means the name is free. Anything else — no
      // permission, a timeout, a server error — leaves availability unknown, and
      // reporting it as available would let creation proceed into a create-or-
      // update against a namespace that may already exist.
      const status = (err as { status?: number } | undefined)?.status;
      if (status === 404) {
        setStatus({ exists: false, checking: false, error: null });
        return;
      }
      setStatus({
        exists: null,
        checking: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const clearStatus = useCallback(() => {
    // Also abandons any check in flight, so its answer cannot land afterwards.
    requestIdRef.current += 1;
    setStatus({ exists: null, checking: false, error: null });
  }, []);

  return {
    ...status,
    checkNamespace,
    checkNamespaceViaK8s,
    clearStatus,
  };
};
