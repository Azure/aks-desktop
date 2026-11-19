// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getClusterSettings } from '../shared/clusterSettings';
import { getRegistryRoleAssignmentMode } from './az-acr';
import {
  assignAzureRoles,
  getKubeletIdentityObjectId,
  getManagedNamespaceResourceId,
} from './az-identity';
import { computeRequiredRoles } from './identityRoles';
import {
  ensureIdentityAndResourceGroup,
  type IdentitySetupResult,
  type IdentitySetupStatus,
} from './identitySetup';

/** Progress phases shared by deploy and pipeline identity-setup UIs. */
export type RoleAssignmentStatus = IdentitySetupStatus | 'checking-registry' | 'assigning-roles';

/** Ensured identity metadata plus non-fatal node-image-pull warnings. */
export interface EnsureIdentityWithRolesResult extends IdentitySetupResult {
  /** Non-fatal warnings encountered during setup (e.g. kubelet AcrPull or Container Registry Repository Reader assignment failures). */
  warnings: string[];
  /**
   * For pipeline setup on service-principal clusters: `true` when manual registry pull
   * verification is required (`servicePrincipalPullAcknowledged` is false when pending,
   * true when acknowledged); omitted for non-pipeline or managed-identity setups.
   */
  servicePrincipalPullRequired?: boolean;
  /**
   * Whether the caller acknowledged manual service-principal registry pull verification;
   * an acknowledgement records user confirmation rather than an automated check.
   * Present when `servicePrincipalPullRequired` is true; omitted otherwise.
   */
  servicePrincipalPullAcknowledged?: boolean;
}

/** Managed AKS identity setup inputs; registered Arc clusters are not supported. */
export interface EnsureIdentityWithRolesConfig {
  /** Subscription GUID owning the cluster and requested workload identity. */
  subscriptionId: string;
  /** Resource group containing the managed AKS cluster. */
  resourceGroup: string;
  /** Group in which the user-assigned identity is ensured. */
  identityResourceGroup: string;
  /** User-assigned managed identity resource name to find or create. */
  identityName: string;
  /**
   * Optional saved client ID to revalidate an existing identity without creating a new one;
   * when provided, setup fails if the identity does not exist or has a different clientId.
   */
  existingClientId?: string;
  /**
   * Acknowledges manual verification of registry pull permissions on service-principal
   * clusters when `isPipeline` is true (does not perform an automated role check).
   */
  acknowledgeServicePrincipalPull?: boolean;
  /** Registered managed AKS name, also used to reject persisted Arc settings. */
  clusterName: string;
  /** Full Azure resource ID of the ACR. Omit to skip ACR roles. */
  acrResourceId?: string;
  /** Whether the target namespace is a managed namespace. Must be resolved before calling. */
  isManagedNamespace: boolean;
  /** Name of the managed namespace (required if isManagedNamespace is true). */
  namespaceName?: string;
  /** Whether Azure RBAC for Kubernetes is enabled on the cluster. */
  azureRbacEnabled?: boolean;
  /**
   * When true, assigns the node-pull role (`Container Registry Repository Reader` for ABAC
   * registries, or `AcrPull` for legacy registries) to the kubelet managed identity, or
   * flags manual verification on service-principal clusters.
   */
  isPipeline?: boolean;
  /** Purpose label for the resource group tags (e.g. 'GitHub Actions Identity', 'Workload Identity'). */
  purpose?: string;
  /** Callback receiving progress phases; it must not throw. */
  onStatusChange: (status: RoleAssignmentStatus) => void;
}

/**
 * Ensures a managed identity exists in the given resource group,
 * computes the required Azure RBAC roles, and assigns them.
 *
 * This is the shared core used by both the Deploy Wizard (K8s federated credential)
 * and the GitHub Pipeline (GitHub federated credential) flows.
 *
 * For pipeline identities, also assigns `Container Registry Repository Reader` (for ABAC
 * registries) or `AcrPull` (for legacy registries) to the kubelet managed identity so AKS
 * nodes can pull container images without additional credentials; service-principal clusters
 * instead return manual-verification status (`servicePrincipalPullRequired`).
 *
 * @see https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration
 * @see https://learn.microsoft.com/en-us/azure/aks/use-managed-identity#summary-of-managed-identities
 * @param config - Identity, namespace/registry context and progress callback.
 * @returns Identity metadata, non-fatal kubelet pull-role warnings, and service-principal verification flags.
 * @throws For registered Arc clusters, missing managed-namespace names,
 * resource/identity setup failures or required role-assignment failures.
 */
export async function ensureIdentityWithRoles(
  config: EnsureIdentityWithRolesConfig
): Promise<EnsureIdentityWithRolesResult> {
  const {
    subscriptionId,
    resourceGroup,
    identityResourceGroup,
    identityName,
    clusterName,
    acrResourceId,
    isManagedNamespace,
    namespaceName,
    azureRbacEnabled,
    isPipeline,
    purpose,
    onStatusChange,
    existingClientId,
    acknowledgeServicePrincipalPull,
  } = config;

  if (getClusterSettings(clusterName).clusterType === 'aksarc') {
    throw new Error('Managed AKS workload identity setup does not support Arc clusters');
  }

  // Validate managed namespace config upfront
  if (isManagedNamespace && !namespaceName) {
    throw new Error('namespaceName is required when isManagedNamespace is true');
  }

  // Read registry permission mode before creating RG or managed identity so invalid/unreadable ACRs fail cleanly.
  if (acrResourceId) {
    onStatusChange('checking-registry');
  }
  const acrAbacEnabled = acrResourceId
    ? (await getRegistryRoleAssignmentMode(acrResourceId)) === 'AbacRepositoryPermissions'
    : false;

  const identity = await ensureIdentityAndResourceGroup({
    subscriptionId,
    resourceGroup,
    identityResourceGroup,
    identityName,
    purpose,
    onStatusChange,
    existingClientId,
  });

  // Compute and assign required roles
  onStatusChange('assigning-roles');

  const roles = await (async () => {
    if (isManagedNamespace) {
      const nsResult = await getManagedNamespaceResourceId({
        clusterName,
        resourceGroup,
        namespaceName: namespaceName!,
        subscriptionId,
      });
      if (!nsResult.success || !nsResult.resourceId) {
        throw new Error(nsResult.error ?? 'Failed to get managed namespace resource ID');
      }
      // isPipeline is only relevant for kubelet pull role assignment (below),
      // not for computing Azure RBAC roles.
      return computeRequiredRoles({
        subscriptionId,
        resourceGroup,
        clusterName,
        acrResourceId,
        acrAbacEnabled,
        isManagedNamespace: true,
        managedNamespaceResourceId: nsResult.resourceId,
      });
    }
    return computeRequiredRoles({
      subscriptionId,
      resourceGroup,
      clusterName,
      acrResourceId,
      acrAbacEnabled,
      isManagedNamespace: false,
      azureRbacEnabled,
    });
  })();

  const roleResult = await assignAzureRoles({
    principalId: identity.principalId,
    subscriptionId,
    roles,
  });

  if (!roleResult.success) {
    if (roleResult.error) {
      throw new Error(`Failed to assign roles: ${roleResult.error}`);
    }
    const failedRoles = roleResult.results
      .filter(r => !r.success)
      .map(r => `${r.role}: ${r.error}`)
      .join('; ');
    throw new Error(`Failed to assign roles: ${failedRoles}`);
  }

  // Assign the registry pull role (`Container Registry Repository Reader` for ABAC registries,
  // or `AcrPull` for legacy registries) to the kubelet managed identity so nodes can pull
  // images from ACR without additional credentials. Service-principal clusters have no
  // kubelet managed identity and instead return manual-verification status.
  //
  // References:
  // - https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration
  // - https://learn.microsoft.com/en-us/azure/aks/use-managed-identity#summary-of-managed-identities
  const warnings: string[] = [];
  let servicePrincipalPullRequired = false;
  if (acrResourceId && isPipeline) {
    // Use the subscription from the ACR resource ID to support cross-subscription ACR scenarios
    const acrSubscriptionId = acrResourceId.split('/')[2] ?? subscriptionId;
    const kubeletResult = await getKubeletIdentityObjectId({
      subscriptionId,
      resourceGroup,
      clusterName,
    });
    if (kubeletResult.success && kubeletResult.objectId) {
      const kubeletRole = acrAbacEnabled ? 'Container Registry Repository Reader' : 'AcrPull';
      const kubeletRoleResult = await assignAzureRoles({
        principalId: kubeletResult.objectId,
        subscriptionId: acrSubscriptionId,
        roles: [{ role: kubeletRole, scope: acrResourceId }],
      });
      if (!kubeletRoleResult.success) {
        const detail =
          (kubeletRoleResult.error ??
            kubeletRoleResult.results
              .filter(r => !r.success)
              .map(r => `${r.role}: ${r.error}`)
              .join('; ')) ||
          'unknown error';
        warnings.push(
          `Failed to assign ${kubeletRole} to kubelet identity: ${detail}. Nodes may not be able to pull images from ACR.`
        );
      }
    } else if (kubeletResult.servicePrincipalRequiresManualVerification) {
      servicePrincipalPullRequired = true;
    } else {
      warnings.push(
        `Could not resolve kubelet identity: ${
          kubeletResult.error ?? 'unknown error'
        }. Nodes may not be able to pull images from ACR.`
      );
    }
  }

  return {
    ...identity,
    warnings,
    ...(servicePrincipalPullRequired && {
      servicePrincipalPullRequired: !acknowledgeServicePrincipalPull,
      servicePrincipalPullAcknowledged: !!acknowledgeServicePrincipalPull,
    }),
  };
}
