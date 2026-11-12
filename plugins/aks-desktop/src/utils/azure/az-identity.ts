// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Identity-related Azure CLI functions (role assignments).

import { debugLog, isValidGuid, runAzCommand } from './az-cli-core';
import { isValidAzResourceName } from './az-validation';

// --- Scope-building helpers ---

export function buildClusterScope(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
}

/**
 * ARM scope of an Arc-connected (AKS Hybrid & Edge) cluster.
 *
 * Deliberately a different provider from {@link buildClusterScope}: Arc roles act
 * on `Microsoft.Kubernetes/connectedClusters/*`, and the AKS roles that act on
 * `Microsoft.ContainerService/managedClusters/*` are assignable to an Arc cluster
 * yet completely inert there — their actions never match.
 */
export function buildConnectedClusterScope(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Kubernetes/connectedClusters/${clusterName}`;
}

/**
 * ARM scope of a single namespace on an Arc-connected cluster — where the
 * `Azure Arc Kubernetes Viewer/Writer/Admin` roles are assigned when the cluster
 * authorizes through Azure RBAC.
 *
 * @param connectedClusterScope - Result of {@link buildConnectedClusterScope}.
 */
export function buildArcNamespaceScope(
  connectedClusterScope: string,
  namespaceName: string
): string {
  return `${connectedClusterScope}/namespaces/${namespaceName}`;
}

// --- Role assignment types ---

export interface RoleAssignment {
  role: string;
  scope: string;
}

export interface AssignRolesResult {
  success: boolean;
  results: Array<{ role: string; scope: string; success: boolean; error?: string }>;
  /** Set on early validation failures (e.g. invalid GUID format). */
  error?: string;
}

/**
 * The kind of Entra principal a role is being assigned to. Azure requires this
 * to be stated explicitly so it does not have to resolve the object ID against
 * the directory — which a tenant may block.
 */
export type PrincipalType = 'ServicePrincipal' | 'User' | 'Group';

/**
 * Assigns multiple Azure RBAC roles to a principal (a managed identity by
 * default, or a user/group when `principalType` says so).
 * Treats `RoleAssignmentExists` as success (idempotent).
 * Roles are assigned sequentially to avoid Azure ARM rate-limiting (429s).
 */
export async function assignAzureRoles(options: {
  principalId: string;
  subscriptionId: string;
  roles: RoleAssignment[];
  /** Defaults to `ServicePrincipal` — the managed-identity case. */
  principalType?: PrincipalType;
}): Promise<AssignRolesResult> {
  const { principalId, subscriptionId, roles, principalType = 'ServicePrincipal' } = options;

  if (!isValidGuid(subscriptionId) || !isValidGuid(principalId)) {
    return {
      success: false,
      results: [],
      error: 'Invalid subscription ID or principal ID format',
    };
  }

  const results: AssignRolesResult['results'] = [];

  for (const { role, scope } of roles) {
    const result = await runAzCommand(
      [
        'role',
        'assignment',
        'create',
        '--assignee-object-id',
        principalId,
        '--assignee-principal-type',
        principalType,
        '--role',
        role,
        '--scope',
        scope,
        '--subscription',
        subscriptionId,
        '--output',
        'json',
      ],
      `Assigning role "${role}" at scope "${scope}":`,
      `assign role ${role}`,
      undefined,
      stderr => {
        if (stderr.includes('RoleAssignmentExists')) {
          debugLog(`Role assignment "${role}" already exists, continuing.`);
          return { success: true };
        }
        return null;
      }
    );

    if (!result.success) {
      console.error(
        `[assignAzureRoles] Failed to assign role "${role}" at scope "${scope}":`,
        result.error
      );
    }
    results.push({ role, scope, success: result.success, error: result.error });
  }

  return {
    success: results.every(r => r.success),
    results,
  };
}

/**
 * Gets the Azure resource ID for a managed namespace.
 */
export async function getManagedNamespaceResourceId(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId: string;
}): Promise<{ success: boolean; resourceId?: string; error?: string }> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }

  const result = await runAzCommand(
    [
      'aks',
      'namespace',
      'show',
      '--cluster-name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--name',
      namespaceName,
      '--query',
      'id',
      '--output',
      'tsv',
      '--subscription',
      subscriptionId,
    ],
    'Getting namespace resource ID:',
    'get managed namespace resource ID',
    stdout => {
      const resourceId = stdout.trim();
      if (!resourceId) {
        throw new Error('Empty resource ID returned for managed namespace');
      }
      return resourceId;
    }
  );

  if (!result.success) {
    // "Not found" is expected for regular (non-managed) namespaces — return
    // success with no resourceId so callers can distinguish from real errors.
    const err = result.error ?? '';
    if (err.includes('ResourceNotFound') || err.includes('not found') || err.includes('(404)')) {
      return { success: true, resourceId: undefined };
    }
    return { success: false, error: result.error };
  }
  return { success: true, resourceId: result.data };
}

/**
 * Gets the kubelet identity's objectId for an AKS cluster.
 *
 * The **kubelet identity** is the managed identity used by the AKS node pool's
 * kubelet process to pull container images and interact with Azure services at
 * runtime. It is distinct from the control-plane identity.
 * Docs: https://learn.microsoft.com/azure/aks/use-managed-identity#summary-of-managed-identities
 *
 * **AcrPull** is a built-in Azure RBAC role that grants read (pull) access to a
 * container registry. Assigning it to the kubelet identity on an ACR scope
 * allows AKS nodes to pull images from that registry without additional credentials.
 * Docs: https://learn.microsoft.com/azure/container-registry/container-registry-roles
 *
 * This function resolves the objectId via:
 *   `az aks show --query identityProfile.kubeletidentity.objectId`
 */
export async function getKubeletIdentityObjectId(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
}): Promise<{ success: boolean; objectId?: string; error?: string }> {
  const { subscriptionId, resourceGroup, clusterName } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(resourceGroup) || !isValidAzResourceName(clusterName)) {
    return { success: false, error: 'Invalid resource group or cluster name format' };
  }

  const result = await runAzCommand(
    [
      'aks',
      'show',
      '--name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--query',
      'identityProfile.kubeletidentity',
      '--output',
      'json',
    ],
    `getKubeletIdentity(${clusterName})`,
    `Failed to get kubelet identity for cluster ${clusterName}`,
    (stdout: string) => {
      const parsed = JSON.parse(stdout);
      return parsed;
    }
  );

  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to get cluster details' };
  }

  const kubeletIdentity = result.data;
  if (!kubeletIdentity || typeof kubeletIdentity !== 'object') {
    return {
      success: false,
      error:
        `Cluster ${clusterName} does not have a kubelet identity configured. ` +
        'Ensure the cluster uses managed identity (not service principal). ' +
        'See: https://learn.microsoft.com/azure/aks/use-managed-identity',
    };
  }

  // Validate that identityProfile.kubeletidentity.objectId exists
  const objectId = (kubeletIdentity as Record<string, unknown>).objectId;
  if (!objectId || typeof objectId !== 'string') {
    return {
      success: false,
      error: `Cluster ${clusterName} does not have a valid kubelet identity objectId configured`,
    };
  }
  if (!isValidGuid(objectId)) {
    return {
      success: false,
      error: `Cluster ${clusterName} returned an unexpected kubelet identity format: ${objectId}`,
    };
  }

  return { success: true, objectId };
}
