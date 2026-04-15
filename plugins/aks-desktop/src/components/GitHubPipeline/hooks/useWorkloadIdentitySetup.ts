// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { useCallback, useState } from 'react';
import { createFederatedCredential } from '../../../utils/azure/az-federation';
import {
  ensureIdentityWithRoles,
  type EnsureIdentityWithRolesResult,
} from '../../../utils/azure/identityWithRoles';
import { sanitizeDnsName } from '../../../utils/kubernetes/k8sNames';

export type WorkloadIdentitySetupStatus =
  | 'idle'
  | 'creating-rg'
  | 'checking'
  | 'creating-identity'
  | 'assigning-roles'
  | 'creating-credential'
  | 'creating-rolebinding'
  | 'done'
  | 'error';

export interface WorkloadIdentitySetupResult extends EnsureIdentityWithRolesResult {
  identityName: string;
}

export interface UseWorkloadIdentitySetupReturn {
  status: WorkloadIdentitySetupStatus;
  error: string | null;
  result: WorkloadIdentitySetupResult | null;
  warnings: string[];
  setupWorkloadIdentity: (config: WorkloadIdentitySetupConfig) => Promise<void>;
}

type NamespaceContext =
  | {
      /** Whether the target namespace is a managed namespace. */
      isManagedNamespace: true;
      /** Name of the managed namespace (required when isManagedNamespace is true). */
      namespaceName: string;
    }
  | {
      /** Whether the target namespace is a managed namespace. */
      isManagedNamespace: false;
      /** Name of the namespace (optional when isManagedNamespace is false). */
      namespaceName?: string;
    };

export type WorkloadIdentitySetupConfig = {
  subscriptionId: string;
  resourceGroup: string;
  identityResourceGroup: string;
  projectName: string;
  clusterName: string;
  repo: { owner: string; repo: string; defaultBranch: string };
  /** Full Azure resource ID of the ACR. Omit to skip ACR roles. */
  acrResourceId?: string;
  /** Whether Azure RBAC for Kubernetes is enabled on the cluster. */
  azureRbacEnabled?: boolean;
} & NamespaceContext;

export function getIdentityName(projectName: string): string {
  return sanitizeDnsName(`id-${projectName}-github`, 128, 'id-app-github');
}

/**
 * Drives the workload-identity setup flow for a GitHub Actions → AKS pipeline.
 *
 * Sequence: resource-group → managed identity → Azure RBAC role assignments
 * (including optional AcrPull on kubelet identity and AKS RBAC Writer) →
 * federated credential → (optionally) Kubernetes RoleBinding for non-Azure-RBAC
 * clusters. Non-fatal errors during role assignment or RoleBinding creation are
 * surfaced as `warnings` rather than aborting the flow; the identity is still
 * usable for fast-path deploys.
 *
 * Returns a tuple of `{ status, error, result, warnings, setupWorkloadIdentity }`
 * suitable for driving the `<WorkloadIdentitySetup>` step component.
 */
export const useWorkloadIdentitySetup = (): UseWorkloadIdentitySetupReturn => {
  const [status, setStatus] = useState<WorkloadIdentitySetupStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkloadIdentitySetupResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

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
    setWarnings([]);

    try {
      // Steps 1-4: Ensure RG + identity + roles via shared utility
      const identityResult = await ensureIdentityWithRoles({
        subscriptionId,
        resourceGroup,
        identityResourceGroup,
        identityName,
        clusterName,
        acrResourceId,
        isManagedNamespace,
        namespaceName,
        azureRbacEnabled,
        isPipeline: true,
        purpose: 'GitHub Actions Identity',
        onStatusChange: setStatus,
      });

      if (identityResult.warnings.length > 0) {
        console.warn(
          '[WorkloadIdentitySetup] Non-fatal warnings during identity setup:',
          identityResult.warnings
        );
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

      // Step 6: On non-Azure-RBAC clusters, create a Kubernetes RoleBinding so the
      // pipeline identity can kubectl apply + annotate in the target namespace.
      // Azure RBAC roles (like AKS RBAC Writer) have no effect when the cluster
      // uses Kubernetes-native RBAC.
      const warnings = [...identityResult.warnings];
      if (azureRbacEnabled === false && namespaceName) {
        setStatus('creating-rolebinding');
        try {
          await ensurePipelineRoleBinding({
            clusterName,
            namespace: namespaceName,
            principalId: identityResult.principalId,
            identityName,
          });
        } catch (rbErr) {
          console.warn('[WorkloadIdentitySetup] RoleBinding creation failed:', rbErr);
          warnings.push(
            `Failed to create Kubernetes RoleBinding for pipeline identity: ${
              rbErr instanceof Error ? rbErr.message : 'unknown error'
            }. ` + 'The pipeline may not have permission to deploy to this namespace.'
          );
        }
      }

      const setupResult: WorkloadIdentitySetupResult = {
        ...identityResult,
        identityName,
        warnings,
      };
      setResult(setupResult);
      setWarnings(warnings);
      setStatus('done');
    } catch (err) {
      console.error('[WorkloadIdentitySetup] Setup failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error during identity setup');
      setStatus('error');
    }
  }, []);

  return { status, error, result, warnings, setupWorkloadIdentity };
};

/**
 * Creates (or updates) a Kubernetes RoleBinding in the target namespace that grants
 * the pipeline's managed identity the "edit" ClusterRole. This is required on clusters
 * where Azure RBAC for Kubernetes is disabled — the pipeline authenticates via Azure AD
 * (kubelogin) but authorization is handled by Kubernetes-native RBAC.
 *
 * The subject uses the identity's principalId (Azure AD object ID), which is the username
 * that kubelogin presents to the K8s API server.
 */
async function ensurePipelineRoleBinding(params: {
  clusterName: string;
  namespace: string;
  principalId: string;
  identityName: string;
}): Promise<void> {
  const { clusterName, namespace, principalId, identityName } = params;
  const bindingName = `${identityName}-pipeline-edit`;

  const roleBinding = {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: {
      name: bindingName,
      namespace,
      labels: {
        'app.kubernetes.io/managed-by': 'aks-desktop',
        'aks-desktop/purpose': 'pipeline-identity',
      },
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: 'edit',
    },
    subjects: [
      {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'User',
        name: principalId,
      },
    ],
  };

  const path = `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings`;

  try {
    await clusterRequest(path, {
      method: 'POST',
      body: JSON.stringify(roleBinding),
      headers: { 'Content-Type': 'application/json' },
      cluster: clusterName,
    });
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    if (status === 409) {
      // RoleBinding already exists — use server-side apply to update without requiring
      // a prior GET for the current resourceVersion (avoids 422 on plain PUT).
      await clusterRequest(`${path}/${bindingName}?fieldManager=aks-desktop&force=true`, {
        method: 'PATCH',
        body: JSON.stringify(roleBinding),
        headers: { 'Content-Type': 'application/apply-patch+yaml' },
        cluster: clusterName,
      });
    } else {
      throw err;
    }
  }
}
