// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Identity-related Azure CLI functions (managed identities, role assignments).

import { getErrorMessage, isValidGuid, runAzCommand } from './az-cli-core';
import { azRequest, AzureRequestError } from './az-http';
import {
  type AzureRolePrincipalType,
  type AzureRoleRequestOptions,
  createAzureRoleAssignment,
} from './az-role-assignments';
import { getSubscriptionCredential } from './az-token';
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

/** One requested grant; ARM resource scope is distinct from an OAuth audience. */
export interface RoleAssignment {
  /** Role name, definition GUID or definition ARM ID. */
  role: string;
  /** Exact target ARM resource ID, possibly in another accessible subscription. */
  scope: string;
}

/** Ordered outcomes from a non-atomic sequence of role writes. */
export interface AssignRolesResult {
  /** True when every role succeeded; an empty role list also succeeds. */
  success: boolean;
  /** Per-role outcomes in input order; earlier successes are not rolled back. */
  results: Array<{
    /** Requested role name or definition ID. */
    role: string;
    /** Requested ARM scope. */
    scope: string;
    /** Whether creation or verified idempotent reuse succeeded. */
    success: boolean;
    /** Failure diagnostic for this role, not for successful roles. */
    error?: string;
  }>;
  /** Set on early validation failures (e.g. invalid GUID format). */
  error?: string;
}

/**
 * The kind of Entra principal a role is being assigned to. Azure requires this
 * to be stated explicitly so it does not have to resolve the object ID against
 * the directory — which a tenant may block.
 */
export type PrincipalType = AzureRolePrincipalType;

/**
 * Assigns multiple Azure RBAC roles to a principal (a managed identity by
 * default, or a user/group when `principalType` says so).
 * Treats `RoleAssignmentExists` as success (idempotent).
 * Roles are assigned sequentially to avoid Azure ARM rate-limiting (429s).
 * @param options - Known principal, ordered grants and optional REST overrides.
 * timeoutMs applies per HTTP request, not to the whole role batch.
 * @returns Resolved aggregate/per-role results. Invalid GUIDs return an empty
 * result list plus error; individual failures are logged and do not stop later roles.
 */
export async function assignAzureRoles(
  options: AzureRoleRequestOptions & {
    /** Entra principal object GUID, not an application/client ID. */
    principalId: string;
    /** Caller subscription GUID; each scope selects its own subscription credential. */
    subscriptionId: string;
    /** Grants to attempt sequentially, including distinct AKS or Arc role definitions. */
    roles: RoleAssignment[];
    /** Defaults to `ServicePrincipal` — the managed-identity case. */
    principalType?: PrincipalType;
  }
): Promise<AssignRolesResult> {
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
    try {
      await createAzureRoleAssignment({ ...options, role, scope, principalType });
      results.push({ role, scope, success: true });
    } catch (error) {
      const message = getErrorMessage(error);
      console.error(
        `[assignAzureRoles] Failed to assign role "${role}" at scope "${scope}":`,
        message
      );
      results.push({ role, scope, success: false, error: message });
    }
  }

  return {
    success: results.every(r => r.success),
    results,
  };
}

/**
 * Gets the Azure resource ID for a managed namespace.
 * @param options - Managed AKS coordinates and optional REST/credential overrides.
 * @returns success=true with the returned ID, or without an ID for known
 * ResourceNotFound absence. Denial, malformed responses and other failures resolve
 * with success=false and error; absence is not inferred from arbitrary errors.
 */
export async function getManagedNamespaceResourceId(
  options: AzureRoleRequestOptions & {
    /** Managed AKS resource name; not an Arc cluster name. */
    clusterName: string;
    /** Resource group containing the managed AKS resource. */
    resourceGroup: string;
    /** Managed namespace resource name to resolve. */
    namespaceName: string;
    /** Explicit subscription GUID for both the URL and default credential. */
    subscriptionId: string;
  }
): Promise<{
  /** Whether lookup succeeded or confirmed known absence. */
  success: boolean;
  /** Returned ARM ID; undefined for a native/absent namespace. */
  resourceId?: string;
  /** Lookup/validation failure, not a confirmed-absence diagnostic. */
  error?: string;
}> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }

  const url = `/subscriptions/${encodeURIComponent(
    subscriptionId
  )}/resourceGroups/${encodeURIComponent(
    resourceGroup
  )}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(
    clusterName
  )}/managedNamespaces/${encodeURIComponent(namespaceName)}`;
  try {
    const namespace = await azRequest<{ id?: string }>({
      ...options,
      scope: options.audience,
      credential: options.credential ?? getSubscriptionCredential(subscriptionId),
      url,
      apiVersion: '2026-01-01',
    });
    if (!namespace?.id || decodeURI(namespace.id).toLowerCase() !== decodeURI(url).toLowerCase()) {
      throw new AzureRequestError('Managed namespace response is missing its expected resource ID');
    }
    return { success: true, resourceId: namespace.id };
  } catch (error) {
    if (
      error instanceof AzureRequestError &&
      error.status === 404 &&
      error.code === 'ResourceNotFound'
    ) {
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
