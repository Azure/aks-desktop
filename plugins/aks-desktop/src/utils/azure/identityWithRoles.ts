// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { assignRolesToIdentity, getManagedNamespaceResourceId } from './az-identity';
import { computeRequiredRoles } from './identityRoles';
import {
  ensureIdentityAndResourceGroup,
  type IdentitySetupResult,
  type IdentitySetupStatus,
} from './identitySetup';

export type RoleAssignmentStatus = IdentitySetupStatus | 'assigning-roles';

export interface EnsureIdentityWithRolesConfig {
  subscriptionId: string;
  resourceGroup: string;
  identityResourceGroup: string;
  identityName: string;
  clusterName: string;
  /** Full Azure resource ID of the ACR. Omit to skip ACR roles. */
  acrResourceId?: string;
  /** Whether the target namespace is a managed namespace. Must be resolved before calling. */
  isManagedNamespace: boolean;
  /** Name of the managed namespace (required if isManagedNamespace is true). */
  namespaceName?: string;
  /** Whether Azure RBAC for Kubernetes is enabled on the cluster. */
  azureRbacEnabled?: boolean;
  onStatusChange: (status: RoleAssignmentStatus) => void;
}

/**
 * Ensures a managed identity exists in the given resource group,
 * computes the required Azure RBAC roles, and assigns them.
 *
 * This is the shared core used by both the Deploy Wizard (K8s federated credential)
 * and the GitHub Pipeline (GitHub federated credential) flows.
 */
export async function ensureIdentityWithRoles(
  config: EnsureIdentityWithRolesConfig
): Promise<IdentitySetupResult> {
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
    onStatusChange,
  } = config;

  // Validate managed namespace config upfront
  if (isManagedNamespace && !namespaceName) {
    throw new Error('namespaceName is required when isManagedNamespace is true');
  }

  // Steps 1-3: Ensure RG + identity
  const identity = await ensureIdentityAndResourceGroup({
    subscriptionId,
    resourceGroup,
    identityResourceGroup,
    identityName,
    onStatusChange,
  });

  // Step 4: Compute and assign required roles
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
      return computeRequiredRoles({
        subscriptionId,
        resourceGroup,
        clusterName,
        acrResourceId,
        isManagedNamespace: true,
        managedNamespaceResourceId: nsResult.resourceId,
      });
    }
    return computeRequiredRoles({
      subscriptionId,
      resourceGroup,
      clusterName,
      acrResourceId,
      isManagedNamespace: false,
      azureRbacEnabled,
    });
  })();

  const roleResult = await assignRolesToIdentity({
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

  return identity;
}
