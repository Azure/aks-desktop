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
}

interface NormalNamespaceRoleContext extends IdentityRoleContextBase {
  isManagedNamespace: false;
  azureRbacEnabled?: boolean;
  /**
   * When true, signals this identity is used by a CI/CD pipeline.
   * NOTE: Does NOT affect which Azure roles are assigned here (see `computeRequiredRoles`).
   * Used downstream in `identityWithRoles.ts` to gate kubelet AcrPull assignment.
   */
  isPipeline?: boolean;
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
 * Note: `isPipeline` on `NormalNamespaceRoleContext` is NOT used here; it only affects
 * kubelet AcrPull assignment in `identityWithRoles.ts`.
 *
 * Normal Namespace (NS):
 *   - AcrPush → ACR scope (if ACR provided)
 *   - Container Registry Tasks Contributor → ACR scope (if ACR provided)
 *   - AKS Cluster User Role → cluster scope
 *   - AKS RBAC Writer → cluster scope (if Azure RBAC enabled)
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
    if (ctx.azureRbacEnabled) {
      // When Azure RBAC for Kubernetes is enabled, the API server delegates authorization
      // to Azure RBAC. AKS RBAC Writer grants read/write on K8s resources (pods, deployments,
      // services, etc.) — the Azure equivalent of the K8s "edit" ClusterRole.
      // This is required for both the deploy wizard (reading deployments) and pipelines
      // (kubectl apply + kubectl annotate).
      //
      // When azureRbacEnabled is false, K8s uses native RBAC and Azure role assignments
      // have no effect on K8s API authorization. In that case, the caller is responsible
      // for creating a Kubernetes-native RoleBinding (see useWorkloadIdentitySetup.ts).
      // See: https://learn.microsoft.com/azure/aks/manage-azure-rbac
      roles.push({ role: AKS_RBAC_WRITER, scope: clusterScope });
    }
  }

  return roles;
}
