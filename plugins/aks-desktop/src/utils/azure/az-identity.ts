// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Identity-related Azure CLI functions (managed identities, role assignments).

import { debugLog, isValidGuid, runAzCommand } from './az-cli-core';
import type { ManagedIdentityResult } from './az-validation';
import { isValidAzResourceName, parseManagedIdentityOutput } from './az-validation';

// --- Identity CRUD ---

export async function getManagedIdentity(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<ManagedIdentityResult> {
  const { identityName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  const result = await runAzCommand(
    [
      'identity',
      'show',
      '--name',
      identityName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--output',
      'json',
    ],
    'Getting managed identity:',
    'get managed identity',
    parseManagedIdentityOutput,
    stderr => {
      if (stderr.includes('ResourceNotFound') || stderr.includes('was not found')) {
        return { success: false, notFound: true };
      }
      return null;
    }
  );

  if (!result.success) {
    return {
      success: false,
      notFound: result.notFound as boolean | undefined,
      error: result.error,
    };
  }
  return { success: true, ...result.data };
}

export async function createManagedIdentity(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<ManagedIdentityResult> {
  const { identityName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  const result = await runAzCommand(
    [
      'identity',
      'create',
      '--name',
      identityName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--tags',
      'purpose=workload-identity',
      'createdBy=AKS Desktop',
      '--output',
      'json',
    ],
    'Creating managed identity:',
    'create managed identity',
    parseManagedIdentityOutput
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, ...result.data };
}

// --- Scope-building helpers ---

export function buildClusterScope(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${clusterName}`;
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
 * Assigns multiple Azure RBAC roles to a managed identity.
 * Treats `RoleAssignmentExists` as success (idempotent).
 * Roles are assigned sequentially to avoid Azure ARM rate-limiting (429s).
 */
export async function assignRolesToIdentity(options: {
  principalId: string;
  subscriptionId: string;
  roles: RoleAssignment[];
}): Promise<AssignRolesResult> {
  const { principalId, subscriptionId, roles } = options;

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
        'ServicePrincipal',
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
        `[assignRolesToIdentity] Failed to assign role "${role}" at scope "${scope}":`,
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

export async function listManagedIdentities(options: {
  resourceGroup: string;
  subscriptionId: string;
}): Promise<{
  success: boolean;
  identities?: Array<{
    name: string;
    clientId: string;
    principalId: string;
    resourceGroup: string;
  }>;
  error?: string;
}> {
  const { resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid resource group name' };
  }
  const result = await runAzCommand(
    [
      'identity',
      'list',
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--output',
      'json',
    ],
    'Listing managed identities:',
    'list managed identities',
    (stdout: string) => {
      let identities;
      try {
        identities = JSON.parse(stdout);
      } catch (e) {
        throw new Error(
          `Unexpected output from az identity list command: ${e instanceof Error ? e.message : e}`
        );
      }
      return (identities as Array<Record<string, unknown>>).map(
        (identity: Record<string, unknown>) => ({
          name: identity.name as string,
          clientId: identity.clientId as string,
          principalId: identity.principalId as string,
          resourceGroup: identity.resourceGroup as string,
        })
      );
    }
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, identities: result.data };
}
