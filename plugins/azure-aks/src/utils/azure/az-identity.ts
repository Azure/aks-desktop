// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Identity-related Azure functions (managed identities, role assignments).

import { AuthorizationManagementClient } from '@azure/arm-authorization';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { ManagedServiceIdentityClient } from '@azure/arm-msi';
import { azureCredential } from '../../azureAuth';
import { debugLog, getErrorMessage, isValidGuid } from './az-helpers';
import type { ManagedIdentityResult } from './az-validation';
import { isValidAzResourceName } from './az-validation';

/** Maps an SDK user-assigned identity object to the ManagedIdentityResult fields. */
function mapIdentityFields(identity: {
  clientId?: string;
  principalId?: string;
  tenantId?: string;
}): Pick<ManagedIdentityResult, 'clientId' | 'principalId' | 'tenantId'> {
  return {
    clientId: identity.clientId,
    principalId: identity.principalId,
    tenantId: identity.tenantId,
  };
}

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

  try {
    debugLog('Getting managed identity:', identityName);
    const client = new ManagedServiceIdentityClient(azureCredential, subscriptionId);
    const identity = await client.userAssignedIdentities.get(resourceGroup, identityName);
    return { success: true, ...mapIdentityFields(identity) };
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 404) {
      return { success: false, notFound: true };
    }
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function createManagedIdentity(options: {
  identityName: string;
  resourceGroup: string;
  location: string;
  subscriptionId: string;
}): Promise<ManagedIdentityResult> {
  const { identityName, resourceGroup, location, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  try {
    debugLog('Creating managed identity:', identityName);
    const client = new ManagedServiceIdentityClient(azureCredential, subscriptionId);
    const identity = await client.userAssignedIdentities.createOrUpdate(
      resourceGroup,
      identityName,
      {
        location,
        tags: { purpose: 'workload-identity', createdBy: 'AKS Desktop' },
      }
    );
    return { success: true, ...mapIdentityFields(identity) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
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
 * Resolves a role definition ID by role name (or returns the value as-is if it
 * is already a full role definition resource ID).
 */
async function resolveRoleDefinitionId(
  authClient: AuthorizationManagementClient,
  scope: string,
  role: string
): Promise<string | undefined> {
  if (role.startsWith('/')) {
    return role;
  }
  for await (const roleDef of authClient.roleDefinitions.list(scope, {
    filter: `roleName eq '${role}'`,
  })) {
    if (roleDef.id) {
      return roleDef.id;
    }
  }
  return undefined;
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

  const authClient = new AuthorizationManagementClient(azureCredential, subscriptionId);
  const results: AssignRolesResult['results'] = [];

  for (const { role, scope } of roles) {
    let success = false;
    let error: string | undefined;

    try {
      debugLog(`Assigning role "${role}" at scope "${scope}":`);
      const roleDefinitionId = await resolveRoleDefinitionId(authClient, scope, role);
      if (!roleDefinitionId) {
        throw new Error(`Role definition not found: ${role}`);
      }
      await authClient.roleAssignments.create(scope, crypto.randomUUID(), {
        roleDefinitionId,
        principalId,
        principalType: 'ServicePrincipal',
      });
      success = true;
    } catch (e) {
      const message = getErrorMessage(e);
      if (
        (e as { code?: string })?.code === 'RoleAssignmentExists' ||
        message.includes('RoleAssignmentExists')
      ) {
        debugLog(`Role assignment "${role}" already exists, continuing.`);
        success = true;
      } else {
        error = message;
        console.error(
          `[assignRolesToIdentity] Failed to assign role "${role}" at scope "${scope}":`,
          error
        );
      }
    }

    results.push({ role, scope, success, error });
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

  try {
    debugLog('Getting namespace resource ID:', namespaceName);
    const client = new ContainerServiceClient(azureCredential, subscriptionId);
    const namespace = await client.managedNamespaces.get(resourceGroup, clusterName, namespaceName);
    return { success: true, resourceId: namespace.id };
  } catch (error) {
    // "Not found" is expected for regular (non-managed) namespaces -- return
    // success with no resourceId so callers can distinguish from real errors.
    if ((error as { statusCode?: number })?.statusCode === 404) {
      return { success: true, resourceId: undefined };
    }
    return { success: false, error: getErrorMessage(error) };
  }
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

  let kubeletIdentity: unknown;
  try {
    debugLog(`getKubeletIdentity(${clusterName})`);
    const client = new ContainerServiceClient(azureCredential, subscriptionId);
    const cluster = await client.managedClusters.get(resourceGroup, clusterName);
    kubeletIdentity = cluster.identityProfile?.kubeletidentity;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error) ?? 'Failed to get cluster details',
    };
  }

  if (!kubeletIdentity || typeof kubeletIdentity !== 'object') {
    return {
      success: false,
      error:
        `Cluster ${clusterName} does not have a kubelet identity configured. ` +
        'Ensure the cluster uses managed identity (not service principal). ' +
        'See: https://learn.microsoft.com/azure/aks/use-managed-identity',
    };
  }

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

  try {
    debugLog('Listing managed identities:', resourceGroup);
    const client = new ManagedServiceIdentityClient(azureCredential, subscriptionId);
    const identities: Array<{
      name: string;
      clientId: string;
      principalId: string;
      resourceGroup: string;
    }> = [];
    for await (const identity of client.userAssignedIdentities.listByResourceGroup(resourceGroup)) {
      identities.push({
        name: identity.name as string,
        clientId: identity.clientId as string,
        principalId: identity.principalId as string,
        resourceGroup,
      });
    }
    return { success: true, identities };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
