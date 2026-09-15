// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useState } from 'react';
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
 * @param tenantId - Optional tenant ID for multi-tenant environments.
 */
export function useRegisterCluster(
  cluster: string,
  resourceGroup: string,
  subscription: string,
  tenantId?: string
): UseRegisterClusterResult {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState<string | undefined>(undefined);

  const handleRegister = async () => {
    if (!cluster || !resourceGroup || !subscription) {
      return;
    }

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
        tenantId
      );
      if (DEBUG) console.debug('[AKS] Register cluster result:', result.success);

      if (!result.success) {
        setError(result.message);
        return;
      }

      if (DEBUG) console.debug('[AKS] Cluster registered successfully.', result.message);
      setSuccess(t("Cluster '{{cluster}}' successfully merged in kubeconfig", { cluster }));
    } catch (err) {
      console.error('Error registering AKS cluster:', err);
      setError(
        t('Failed to register cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    success,
    handleRegister,
    clearError: () => setError(undefined),
    clearSuccess: () => setSuccess(undefined),
  };
}
