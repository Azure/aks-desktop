// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import {
  createK8sFederatedCredential,
  getAksOidcIssuerUrl,
} from '../../../utils/azure/az-federation';
import { ensureIdentityWithRoles } from '../../../utils/azure/identityWithRoles';
import { sanitizeDnsName } from '../../../utils/kubernetes/k8sNames';
import { getServiceAccountName } from '../../../utils/kubernetes/serviceAccountNames';

type DeployWorkloadIdentityStatus =
  | 'idle'
  | 'creating-rg'
  | 'checking'
  | 'creating-identity'
  | 'assigning-roles'
  | 'fetching-issuer'
  | 'creating-credential'
  | 'done'
  | 'error';

interface DeployWorkloadIdentityResult {
  clientId: string;
  serviceAccountName: string;
}

interface UseDeployWorkloadIdentityReturn {
  status: DeployWorkloadIdentityStatus;
  error: string | null;
  result: DeployWorkloadIdentityResult | null;
  setupWorkloadIdentity: (config: DeployWorkloadIdentityConfig) => Promise<void>;
  reset: () => void;
}

export interface DeployWorkloadIdentityConfig {
  subscriptionId: string;
  resourceGroup: string;
  identityResourceGroup: string;
  clusterName: string;
  namespace: string;
  appName: string;
  /** Full Azure resource ID of the ACR. Omit to skip ACR roles. */
  acrResourceId?: string;
  /** Whether the target namespace is a managed namespace. Must be resolved before calling. */
  isManagedNamespace: boolean;
  /** Whether Azure RBAC for Kubernetes is enabled on the cluster. */
  azureRbacEnabled?: boolean;
}

/** Derives a valid Azure managed identity name from the app name (max 128 chars). */
export function getDeployIdentityName(appName: string): string {
  return sanitizeDnsName(`id-${appName}-workload`, 128, 'id-app-workload');
}

export const useDeployWorkloadIdentity = (): UseDeployWorkloadIdentityReturn => {
  const [status, setStatus] = useState<DeployWorkloadIdentityStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployWorkloadIdentityResult | null>(null);

  const setupWorkloadIdentity = useCallback(async (config: DeployWorkloadIdentityConfig) => {
    const {
      subscriptionId,
      resourceGroup,
      identityResourceGroup,
      clusterName,
      namespace,
      appName,
      acrResourceId,
      isManagedNamespace,
      azureRbacEnabled,
    } = config;
    const identityName = getDeployIdentityName(appName);
    const serviceAccountName = getServiceAccountName(appName);

    setError(null);
    setResult(null);

    try {
      // Steps 1-4: Ensure RG + identity + roles via shared utility
      const identity = await ensureIdentityWithRoles({
        subscriptionId,
        resourceGroup,
        identityResourceGroup,
        identityName,
        clusterName,
        acrResourceId,
        isManagedNamespace,
        namespaceName: namespace,
        azureRbacEnabled,
        purpose: 'Workload Identity',
        onStatusChange: setStatus,
      });

      // Step 5: Get OIDC issuer URL
      setStatus('fetching-issuer');
      const issuerResult = await getAksOidcIssuerUrl({
        clusterName,
        resourceGroup,
        subscriptionId,
      });
      if (!issuerResult.success || !issuerResult.issuerUrl) {
        throw new Error(
          issuerResult.error ??
            'Failed to get OIDC issuer URL. Ensure both OIDC issuer and workload identity are enabled on the cluster with: az aks update --enable-oidc-issuer --enable-workload-identity'
        );
      }

      // Step 6: Create federated credential for the K8s service account
      setStatus('creating-credential');
      const credResult = await createK8sFederatedCredential({
        identityName,
        resourceGroup: identityResourceGroup,
        subscriptionId,
        issuerUrl: issuerResult.issuerUrl,
        namespace,
        serviceAccountName,
      });
      if (!credResult.success) {
        throw new Error(credResult.error ?? 'Failed to create federated credential');
      }

      setResult({ clientId: identity.clientId, serviceAccountName });
      setStatus('done');
    } catch (err) {
      console.error('[DeployWorkloadIdentity] Setup failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error during workload identity setup');
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
  }, []);

  return { status, error, result, setupWorkloadIdentity, reset };
};
