// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import {
  assignRoleToIdentity,
  createFederatedCredential,
  createManagedIdentity,
  createResourceGroup,
  getManagedIdentity,
  getResourceGroupLocation,
  resourceGroupExists,
} from '../../../utils/azure/az-cli';

export type WorkloadIdentitySetupStatus =
  | 'idle'
  | 'creating-rg'
  | 'checking'
  | 'creating-identity'
  | 'assigning-role'
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
  repo: { owner: string; repo: string; defaultBranch: string };
}

export function getIdentityName(projectName: string): string {
  return `id-${projectName}-github`;
}

export const useWorkloadIdentitySetup = (): UseWorkloadIdentitySetupReturn => {
  const [status, setStatus] = useState<WorkloadIdentitySetupStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkloadIdentitySetupResult | null>(null);

  const setupWorkloadIdentity = useCallback(async (config: WorkloadIdentitySetupConfig) => {
    const { subscriptionId, resourceGroup, identityResourceGroup, projectName, repo } = config;
    const identityName = getIdentityName(projectName);

    setError(null);
    setResult(null);

    try {
      // Step 1: Ensure identity resource group exists
      setStatus('creating-rg');
      const rgCheck = await resourceGroupExists({
        resourceGroupName: identityResourceGroup,
        subscriptionId,
      });

      if (rgCheck.error) {
        throw new Error(rgCheck.error);
      }

      if (!rgCheck.exists) {
        const location = await getResourceGroupLocation({
          resourceGroupName: resourceGroup,
          subscriptionId,
        });
        const rgResult = await createResourceGroup({
          resourceGroupName: identityResourceGroup,
          location,
          subscriptionId,
        });
        if (!rgResult.success) {
          throw new Error(rgResult.error ?? 'Failed to create identity resource group');
        }
      }

      // Step 2: Check if identity already exists
      setStatus('checking');
      const existing = await getManagedIdentity({
        identityName,
        resourceGroup: identityResourceGroup,
        subscriptionId,
      });

      let clientId: string;
      let principalId: string;
      let tenantId: string;
      let isExisting = false;

      if (existing.success && existing.clientId && existing.principalId && existing.tenantId) {
        clientId = existing.clientId;
        principalId = existing.principalId;
        tenantId = existing.tenantId;
        isExisting = true;
      } else if (!existing.success && !existing.notFound) {
        // Real error (network, permissions, etc.) — don't silently create a new identity
        throw new Error(existing.error ?? 'Failed to check for existing managed identity');
      } else {
        // Step 3: Create the identity
        setStatus('creating-identity');
        const created = await createManagedIdentity({
          identityName,
          resourceGroup: identityResourceGroup,
          subscriptionId,
        });
        if (!created.success || !created.clientId || !created.principalId || !created.tenantId) {
          throw new Error(created.error ?? 'Failed to create managed identity');
        }
        clientId = created.clientId;
        principalId = created.principalId;
        tenantId = created.tenantId;
      }

      // Step 4: Assign AKS Cluster User Role
      setStatus('assigning-role');
      const roleResult = await assignRoleToIdentity({
        principalId,
        subscriptionId,
        resourceGroup,
      });
      if (!roleResult.success) {
        throw new Error(roleResult.error ?? 'Failed to assign role');
      }

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
        clientId,
        tenantId,
        principalId,
        identityName,
        isExisting,
      };
      setResult(setupResult);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error during identity setup');
      setStatus('error');
    }
  }, []);

  return { status, error, result, setupWorkloadIdentity };
};
