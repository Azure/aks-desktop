// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useRef, useState } from 'react';
import { useRegisteredClusters } from '../../../hooks/useRegisteredClusters';
import { registerAKSCluster } from '../../../utils/azure/aks';

/** Set to `true` locally to enable verbose debug logging. Never enable in production. */
const DEBUG = false;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

/**
 * Return type for {@link useRegisterCluster}.
 */
export interface UseRegisterClusterResult {
  /** `true` while the `az aks get-credentials` call is in flight. */
  loading: boolean;
  /** `true` once Headlamp's live cluster configuration is authoritative. */
  clusterConfigReady: boolean;
  /** Error message from the last failed registration attempt, or `undefined`. */
  error: string | undefined;
  /** Success message once registration completes, or `undefined`. */
  success: string | undefined;
  /** Initiates the cluster registration flow. */
  handleRegister: () => Promise<void>;
  /** Clears the error message (e.g. when the user dismisses the alert). */
  clearError: () => void;
  /** Clears the success message (e.g. when the user dismisses the alert). */
  clearSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the async flow for registering a missing AKS cluster into the
 * headlamp kubeconfig via `az aks get-credentials`.
 *
 * Encapsulates the loading / error / success state that previously lived
 * inline in the `RegisterCluster` component so the component can be a pure
 * presentational function.
 *
 * @param cluster - The AKS cluster name to register.
 * @param resourceGroup - The resource group the cluster belongs to.
 * @param subscription - The Azure subscription ID.
 * @returns Registration state and actions for the selected cluster.
 */
export function useRegisterCluster(
  cluster: string,
  resourceGroup: string,
  subscription: string
): UseRegisterClusterResult {
  const { t } = useTranslation();
  const { registeredClusters, isReady: clusterConfigReady } = useRegisteredClusters();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState<string | undefined>(undefined);
  /** Synchronous guard for repeated calls before loading state renders. */
  const registrationInFlightRef = useRef(false);
  /** Identifies the active attempt so obsolete completions cannot update state. */
  const registrationAttemptRef = useRef(0);

  useEffect(() => {
    registrationAttemptRef.current++;
    setError(undefined);
    setSuccess(undefined);
  }, [cluster, resourceGroup, subscription]);

  const handleRegister = async () => {
    if (
      registrationInFlightRef.current ||
      !clusterConfigReady ||
      !cluster ||
      !resourceGroup ||
      !subscription
    ) {
      return;
    }
    registrationInFlightRef.current = true;
    const registrationAttempt = ++registrationAttemptRef.current;

    setLoading(true);
    setError(undefined);
    setSuccess(undefined);

    try {
      if (DEBUG) console.debug('[AKS] Registering cluster...');
      const result = await registerAKSCluster(
        subscription,
        resourceGroup,
        cluster,
        undefined,
        registeredClusters.has(cluster)
      );
      if (registrationAttempt !== registrationAttemptRef.current) {
        return;
      }
      if (DEBUG) console.debug('[AKS] Register cluster result:', result.success);

      if (!result.success) {
        setError(result.message);
        return;
      }

      if (DEBUG) console.debug('[AKS] Cluster registered successfully.', result.message);
      setSuccess(t("Cluster '{{cluster}}' successfully merged in kubeconfig", { cluster }));
    } catch (err) {
      if (registrationAttempt !== registrationAttemptRef.current) {
        return;
      }
      console.error('Error registering AKS cluster:', err);
      setError(
        t('Failed to register cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
    } finally {
      registrationInFlightRef.current = false;
      setLoading(false);
    }
  };

  return {
    loading,
    clusterConfigReady,
    error,
    success,
    handleRegister,
    clearError: () => setError(undefined),
    clearSuccess: () => setSuccess(undefined),
  };
}
