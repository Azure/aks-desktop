// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { buildClusterScope, type RoleAssignment } from './az-identity';

// Azure built-in role names
const ACR_PUSH = 'AcrPush';
const ACR_TASKS_CONTRIBUTOR = 'Container Registry Tasks Contributor';
const AKS_CLUSTER_USER = 'Azure Kubernetes Service Cluster User Role';
const AKS_RBAC_WRITER = 'Azure Kubernetes Service RBAC Writer';
const AKS_NAMESPACE_USER = 'Azure Kubernetes Service Namespace User';

interface IdentityRoleContextBase {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  acrResourceId?: string;
  /** When true, always includes AKS RBAC Writer (needed for annotation permissions). */
  isPipeline?: boolean;
}

interface NormalNamespaceRoleContext extends IdentityRoleContextBase {
  isManagedNamespace: false;
  azureRbacEnabled?: boolean;
}

interface ManagedNamespaceRoleContext extends IdentityRoleContextBase {
  isManagedNamespace: true;
  managedNamespaceResourceId: string;
}

export type IdentityRoleContext = NormalNamespaceRoleContext | ManagedNamespaceRoleContext;

/**
 * Computes the set of Azure RBAC role assignments required for a workload identity,
 * based on whether the target is a normal or managed namespace and whether an ACR is involved.
 *
 * Normal Namespace (NS):
 *   - AcrPush → ACR scope (if ACR provided)
 *   - Container Registry Tasks Contributor → ACR scope (if ACR provided)
 *   - AKS Cluster User Role → cluster scope
 *   - AKS RBAC Writer → cluster scope (only if Azure RBAC enabled)
 *
 * Managed Namespace (MNS):
 *   - AcrPush → ACR scope (if ACR provided)
 *   - Container Registry Tasks Contributor → ACR scope (if ACR provided)
 *   - AKS RBAC Writer → managed namespace scope
 *   - AKS Namespace User → managed namespace scope
 */
export function computeRequiredRoles(ctx: IdentityRoleContext): RoleAssignment[] {
  const roles: RoleAssignment[] = [];

  // ACR roles (common to both NS and MNS when an ACR is provided)
  if (ctx.acrResourceId) {
    roles.push({ role: ACR_PUSH, scope: ctx.acrResourceId });
    roles.push({ role: ACR_TASKS_CONTRIBUTOR, scope: ctx.acrResourceId });
  }

  const clusterScope = buildClusterScope(ctx.subscriptionId, ctx.resourceGroup, ctx.clusterName);

  if (ctx.isManagedNamespace === true) {
    roles.push({ role: AKS_RBAC_WRITER, scope: ctx.managedNamespaceResourceId });
    roles.push({ role: AKS_NAMESPACE_USER, scope: ctx.managedNamespaceResourceId });
  } else {
    roles.push({ role: AKS_CLUSTER_USER, scope: clusterScope });
    if (ctx.azureRbacEnabled || ctx.isPipeline) {
      roles.push({ role: AKS_RBAC_WRITER, scope: clusterScope });
    }
  }

  return roles;
}
