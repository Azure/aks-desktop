// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useState } from 'react';
import {
  assignRoleToIdentity,
  createFederatedCredential,
  createManagedIdentity,
  getManagedIdentity,
} from '../../../utils/azure/az-cli';

export type WorkloadIdentitySetupStatus =
  | 'idle'
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
  namespace: string;
  repo: { owner: string; repo: string; defaultBranch: string };
}

export function getIdentityName(namespace: string): string {
  return `id-${namespace}-github`;
}

export const useWorkloadIdentitySetup = (): UseWorkloadIdentitySetupReturn => {
  const [status, setStatus] = useState<WorkloadIdentitySetupStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkloadIdentitySetupResult | null>(null);

  const setupWorkloadIdentity = useCallback(async (config: WorkloadIdentitySetupConfig) => {
    const { subscriptionId, resourceGroup, namespace, repo } = config;
    const identityName = getIdentityName(namespace);

    setError(null);
    setResult(null);

    try {
      // Step 1: Check if identity already exists
      setStatus('checking');
      const existing = await getManagedIdentity({
        identityName,
        resourceGroup,
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
        // Step 2: Create the identity
        setStatus('creating-identity');
        const created = await createManagedIdentity({
          identityName,
          resourceGroup,
          subscriptionId,
        });
        if (!created.success || !created.clientId || !created.principalId || !created.tenantId) {
          throw new Error(created.error ?? 'Failed to create managed identity');
        }
        clientId = created.clientId;
        principalId = created.principalId;
        tenantId = created.tenantId;
      }

      // Step 3: Assign AKS Cluster User Role
      setStatus('assigning-role');
      const roleResult = await assignRoleToIdentity({
        principalId,
        subscriptionId,
        resourceGroup,
      });
      if (!roleResult.success) {
        throw new Error(roleResult.error ?? 'Failed to assign role');
      }

      // Step 4: Create federated credential
      setStatus('creating-credential');
      const credResult = await createFederatedCredential({
        identityName,
        resourceGroup,
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
