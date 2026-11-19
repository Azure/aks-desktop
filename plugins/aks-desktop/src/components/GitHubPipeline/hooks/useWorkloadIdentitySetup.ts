// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createFederatedCredential } from '../../../utils/azure/az-federation';
import { resolveManagedIdentityByClientId } from '../../../utils/azure/az-identity';
import {
  ensureIdentityWithRoles,
  type EnsureIdentityWithRolesResult,
} from '../../../utils/azure/identityWithRoles';
import { sanitizeDnsName } from '../../../utils/kubernetes/k8sNames';

export type WorkloadIdentitySetupStatus =
  | 'idle'
  | 'checking-registry'
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
  existingIdentity?: Awaited<ReturnType<typeof resolveManagedIdentityByClientId>> | null;
  identityResolutionStatus?: 'loading' | 'resolved' | 'error';
  identityResolutionError?: string | null;
  servicePrincipalPullRequired?: boolean;
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
  /** Explicit acknowledgement for SP clusters only; never bypasses managed-identity checks. */
  acknowledgeServicePrincipalPull?: boolean;
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
 * returned for callers that permit warnings.
 *
 * A changed scopeKey invalidates previous results and pending completions without
 * starting Azure operations. requirePermissions makes permission warnings retryable
 * errors for pipeline paths; other consumers retain the existing warning behavior.
 * A saved client ID is resolved across resource groups and revalidated without
 * creating an identity or resource group. Service-principal pull access requires
 * explicit manual acknowledgement; Azure lookup failures never enable that path.
 */
export const useWorkloadIdentitySetup = (
  scopeKey?: string,
  requirePermissions = false,
  savedIdentity?: { clientId: string; subscriptionId: string }
): UseWorkloadIdentitySetupReturn => {
  const [status, setStatus] = useState<WorkloadIdentitySetupStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkloadIdentitySetupResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [existingIdentity, setExistingIdentity] = useState<Awaited<
    ReturnType<typeof resolveManagedIdentityByClientId>
  > | null>(null);
  const [identityResolutionStatus, setIdentityResolutionStatus] = useState<
    'loading' | 'resolved' | 'error'
  >();
  const [identityResolutionError, setIdentityResolutionError] = useState<string | null>(null);
  const [servicePrincipalPullRequired, setServicePrincipalPullRequired] = useState(false);
  const savedClientId = savedIdentity?.clientId;
  const savedSubscriptionId = savedIdentity?.subscriptionId;
  const scope = useMemo(() => ({ active: true }), [scopeKey, savedClientId, savedSubscriptionId]);
  const resultScopeRef = useRef(scope);
  useLayoutEffect(() => {
    scope.active = true;
    resultScopeRef.current = scope;
    setStatus('idle');
    setError(null);
    setResult(null);
    setWarnings([]);
    setServicePrincipalPullRequired(false);
    setExistingIdentity(null);
    setIdentityResolutionError(null);
    setIdentityResolutionStatus(savedClientId ? 'loading' : undefined);
    return () => {
      scope.active = false;
    };
  }, [scope]);

  useEffect(() => {
    if (!savedClientId || !savedSubscriptionId) return;
    resolveManagedIdentityByClientId({
      clientId: savedClientId,
      subscriptionId: savedSubscriptionId,
    }).then(
      identity => {
        if (!scope.active) return;
        setExistingIdentity(identity);
        setIdentityResolutionStatus('resolved');
      },
      err => {
        if (!scope.active) return;
        setIdentityResolutionError(
          err instanceof Error ? err.message : 'Failed to resolve saved managed identity'
        );
        setIdentityResolutionStatus('error');
      }
    );
  }, [scope, savedClientId, savedSubscriptionId]);

  const setupWorkloadIdentity = useCallback(
    async (config: WorkloadIdentitySetupConfig) => {
      if (!scope.active) return;
      resultScopeRef.current = scope;
      const {
        subscriptionId,
        resourceGroup,
        projectName,
        clusterName,
        repo,
        acrResourceId,
        isManagedNamespace,
        namespaceName,
        azureRbacEnabled,
        acknowledgeServicePrincipalPull,
      } = config;

      setError(null);
      setResult(null);
      setWarnings([]);
      setServicePrincipalPullRequired(false);

      try {
        let identityName = getIdentityName(projectName);
        let identityResourceGroup = config.identityResourceGroup;
        if (savedClientId) {
          setStatus('checking');
          const identity = await resolveManagedIdentityByClientId({
            clientId: savedClientId,
            subscriptionId,
          });
          if (!scope.active) return;
          identityName = identity.identityName;
          identityResourceGroup = identity.identityResourceGroup;
          setExistingIdentity(identity);
          setIdentityResolutionStatus('resolved');
          setIdentityResolutionError(null);
        }
        // Steps 1-4: Ensure RG + identity + roles via shared utility
        const identityResult = await ensureIdentityWithRoles({
          subscriptionId,
          resourceGroup,
          identityResourceGroup,
          identityName,
          existingClientId: savedClientId,
          acknowledgeServicePrincipalPull,
          clusterName,
          acrResourceId,
          isManagedNamespace,
          namespaceName,
          azureRbacEnabled,
          isPipeline: true,
          purpose: 'GitHub Actions Identity',
          onStatusChange: status => {
            if (scope.active) setStatus(status);
          },
        });
        if (!scope.active) return;

        setServicePrincipalPullRequired(!!identityResult.servicePrincipalPullRequired);
        if (identityResult.servicePrincipalPullRequired) {
          throw new Error(
            'This cluster uses a service principal. Verify pull access to the selected registry, then acknowledge the manual verification and retry.'
          );
        }
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
        if (!scope.active) return;
        if (!credResult.success) {
          throw new Error(credResult.error ?? 'Failed to create federated credential');
        }

        // Step 6: On non-Azure-RBAC managed namespaces, create a Kubernetes RoleBinding
        // so the pipeline identity can kubectl apply + annotate in the target namespace.
        // Azure RBAC roles (like AKS RBAC Writer) have no effect when the cluster uses
        // Kubernetes-native RBAC. Gated on isManagedNamespace to keep this in lockstep
        // with the WorkloadIdentitySetup component's `needsRoleBinding` step ordering.
        const warnings = [...identityResult.warnings];
        if (azureRbacEnabled === false && isManagedNamespace && namespaceName) {
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
        if (!scope.active) return;
        if (requirePermissions && warnings.length > 0) {
          throw new Error(warnings.join('\n'));
        }
        setResult(setupResult);
        setWarnings(warnings);
        setStatus('done');
      } catch (err) {
        if (!scope.active) return;
        console.error('[WorkloadIdentitySetup] Setup failed:', err);
        setError(err instanceof Error ? err.message : 'Unknown error during identity setup');
        setStatus('error');
      }
    },
    [scope, requirePermissions, savedClientId]
  );

  const isCurrentScope = resultScopeRef.current === scope;
  return {
    status: isCurrentScope ? status : 'idle',
    error: isCurrentScope ? error : null,
    result: isCurrentScope ? result : null,
    warnings: isCurrentScope ? warnings : [],
    existingIdentity: isCurrentScope ? existingIdentity : null,
    identityResolutionStatus: isCurrentScope
      ? identityResolutionStatus
      : savedClientId
      ? 'loading'
      : undefined,
    identityResolutionError: isCurrentScope ? identityResolutionError : null,
    servicePrincipalPullRequired: isCurrentScope && servicePrincipalPullRequired,
    setupWorkloadIdentity,
  };
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
        // Body is JSON-encoded, so use the JSON server-side-apply content type.
        // Mismatched content type (yaml header + JSON body) silently 415s on some clusters.
        headers: { 'Content-Type': 'application/apply-patch+json' },
        cluster: clusterName,
      });
    } else {
      throw err;
    }
  }
}
