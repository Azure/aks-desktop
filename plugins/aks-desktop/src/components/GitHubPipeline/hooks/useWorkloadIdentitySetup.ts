// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import { createFederatedCredential } from '../../../utils/azure/az-federation';
import { ensureIdentityWithRoles } from '../../../utils/azure/identityWithRoles';
import { sanitizeDnsName } from '../../../utils/kubernetes/k8sNames';

export type WorkloadIdentitySetupStatus =
  | 'idle'
  | 'creating-rg'
  | 'checking'
  | 'creating-identity'
  | 'assigning-roles'
  | 'creating-credential'
  | 'done'
  | 'error';

export interface WorkloadIdentitySetupResult {
  clientId: string;
  tenantId: string;
  principalId: string;
  identityName: string;
  isExisting: boolean;
}

export interface UseWorkloadIdentitySetupReturn {
  status: WorkloadIdentitySetupStatus;
  error: string | null;
  result: WorkloadIdentitySetupResult | null;
  setupWorkloadIdentity: (config: WorkloadIdentitySetupConfig) => Promise<void>;
}

export interface WorkloadIdentitySetupConfig {
  subscriptionId: string;
  resourceGroup: string;
  identityResourceGroup: string;
  projectName: string;
  clusterName: string;
  repo: { owner: string; repo: string; defaultBranch: string };
  /** Full Azure resource ID of the ACR. Omit to skip ACR roles. */
  acrResourceId?: string;
  /** Whether the target namespace is a managed namespace. Must be resolved before calling. */
  isManagedNamespace: boolean;
  /** Name of the managed namespace (required if isManagedNamespace is true). */
  namespaceName?: string;
  /** Whether Azure RBAC for Kubernetes is enabled on the cluster. */
  azureRbacEnabled?: boolean;
}

export function getIdentityName(projectName: string): string {
  return sanitizeDnsName(`id-${projectName}-github`, 128, 'id-app-github');
}

export const useWorkloadIdentitySetup = (): UseWorkloadIdentitySetupReturn => {
  const [status, setStatus] = useState<WorkloadIdentitySetupStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkloadIdentitySetupResult | null>(null);

  const setupWorkloadIdentity = useCallback(async (config: WorkloadIdentitySetupConfig) => {
    const {
      subscriptionId,
      resourceGroup,
      identityResourceGroup,
      projectName,
      clusterName,
      repo,
      acrResourceId,
      isManagedNamespace,
      namespaceName,
      azureRbacEnabled,
    } = config;
    const identityName = getIdentityName(projectName);

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
        namespaceName,
        azureRbacEnabled,
        onStatusChange: setStatus,
      });

      // Step 5: Create federated credential
      setStatus('creating-credential');
      const credResult = await createFederatedCredential({
        identityName,
        resourceGroup: identityResourceGroup,
        subscriptionId,
        repoOwner: repo.owner,
        repoName: repo.repo,
        branch: repo.defaultBranch,
      });
      if (!credResult.success) {
        throw new Error(credResult.error ?? 'Failed to create federated credential');
      }

      const setupResult: WorkloadIdentitySetupResult = {
        clientId: identity.clientId,
        tenantId: identity.tenantId,
        principalId: identity.principalId,
        identityName,
        isExisting: identity.isExisting,
      };
      setResult(setupResult);
      setStatus('done');
    } catch (err) {
      console.error('[WorkloadIdentitySetup] Setup failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error during identity setup');
      setStatus('error');
    }
  }, []);

  return { status, error, result, setupWorkloadIdentity };
};
