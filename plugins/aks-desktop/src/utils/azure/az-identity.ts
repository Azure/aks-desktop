// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Azure role assignments, scope helpers and identity lookups.

import { getErrorMessage, isValidGuid } from './az-cli-core';
import { azRequest, AzureRequestError } from './az-http';
import {
  type AksClusterReadOptions,
  getManagedClusterDetails,
  type ManagedClusterDetails,
} from './az-managed-clusters';
import { isAbsent } from './az-managed-namespace-delete';
import { queryResourceGraph } from './az-resource-graph';
import {
  type AzureRolePrincipalType,
  type AzureRoleRequestOptions,
  createAzureRoleAssignment,
  getAzureRoleTransport,
} from './az-role-assignments';
import { getSubscriptionCredential } from './az-token';
import { isValidAzResourceGroupName, isValidAzResourceName } from './az-validation';

// --- Saved identity lookup ---

/** Resolve a saved client ID across resource groups without guessing an identity name. */
export async function resolveManagedIdentityByClientId(options: {
  subscriptionId: string;
  clientId: string;
}): Promise<{ identityName: string; identityResourceGroup: string; clientId: string }> {
  const { subscriptionId, clientId } = options;
  if (!isValidGuid(subscriptionId) || !isValidGuid(clientId)) {
    throw new Error('Invalid subscription or saved managed identity client ID');
  }
  const identities = await queryResourceGraph<{
    name: string;
    resourceGroup: string;
    clientId: string;
  }>(
    `Resources | where type =~ 'microsoft.managedidentity/userassignedidentities' ` +
      `| where tostring(properties.clientId) =~ '${clientId}' ` +
      '| project name, resourceGroup, clientId=tostring(properties.clientId)',
    [subscriptionId]
  );
  const identity = identities[0];
  if (
    identities.length !== 1 ||
    !identity ||
    typeof identity.name !== 'string' ||
    typeof identity.resourceGroup !== 'string' ||
    !isValidAzResourceName(identity.name) ||
    !isValidAzResourceGroupName(identity.resourceGroup) ||
    typeof identity.clientId !== 'string' ||
    identity.clientId.toLowerCase() !== clientId.toLowerCase()
  ) {
    throw new Error(
      'Could not uniquely resolve the saved managed identity. No replacement was created.'
    );
  }
  return {
    identityName: identity.name,
    identityResourceGroup: identity.resourceGroup,
    clientId: identity.clientId,
  };
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
 * Ensures multiple Azure RBAC roles for a principal via ARM REST (`createAzureRoleAssignment`).
 * The principal is a managed identity by default, or a user/group when `principalType` says so.
 * Treats `RoleAssignmentExists` as success (idempotent).
 * Roles are assigned sequentially to avoid Azure ARM rate-limiting (429s).
 * @param options - Known principal, ordered grants and optional REST overrides.
 * timeoutMs bounds each HTTP request and conflict-verification phase, not the whole role batch.
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
 * Default production requests resolve missing endpoint/audience values from the
 * configured CLI cloud; explicit overrides and injected transports are preserved.
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
    const transport = await getAzureRoleTransport(options);
    const namespace = await azRequest<{ id?: string }>({
      ...options,
      ...transport,
      credential: options.credential ?? getSubscriptionCredential(subscriptionId),
      url,
      apiVersion: '2026-01-01',
    });
    if (!namespace?.id || decodeURI(namespace.id).toLowerCase() !== decodeURI(url).toLowerCase()) {
      throw new AzureRequestError('Managed namespace response is missing its expected resource ID');
    }
    return { success: true, resourceId: namespace.id };
  } catch (error) {
    if (isAbsent(error)) {
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
 * Resolves the object ID from the shared managed AKS REST detail read.
 *
 * @param options - Managed AKS coordinates and optional shared REST/authentication overrides.
 * @returns A resolved result with a validated kubelet objectId, or success=false
 * and an actionable error for invalid input, read failure or missing/malformed identity.
 * The control-plane identity is never substituted for the kubelet identity.
 */
export async function getKubeletIdentityObjectId(options: AksClusterReadOptions): Promise<{
  /** Whether a valid kubelet identity object GUID was obtained. */
  success: boolean;
  /** Kubelet Entra object GUID, present only on success. */
  objectId?: string;
  /** Validation, lookup or kubelet-configuration diagnostic on failure. */
  error?: string;
  servicePrincipalRequiresManualVerification?: boolean;
}> {
  const { subscriptionId, resourceGroup, clusterName } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceGroupName(resourceGroup) || !isValidAzResourceName(clusterName)) {
    return { success: false, error: 'Invalid resource group or cluster name format' };
  }

  let cluster: ManagedClusterDetails;
  let kubeletIdentity: unknown;
  try {
    cluster = await getManagedClusterDetails(options);
    kubeletIdentity = cluster.properties.identityProfile?.kubeletidentity;
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
  if (!kubeletIdentity || typeof kubeletIdentity !== 'object') {
    const identityType = cluster.identity?.type;
    const spClientId = cluster.properties.servicePrincipalProfile?.clientId;
    if (
      cluster &&
      typeof cluster === 'object' &&
      !Array.isArray(cluster) &&
      (cluster.properties.identityProfile === null ||
        cluster.properties.identityProfile === undefined ||
        (typeof cluster.properties.identityProfile === 'object' &&
          !Array.isArray(cluster.properties.identityProfile))) &&
      (cluster.identity === null || cluster.identity === undefined || identityType === 'None') &&
      typeof spClientId === 'string' &&
      isValidGuid(spClientId)
    ) {
      return {
        success: false,
        servicePrincipalRequiresManualVerification: true,
        error:
          'Service-principal cluster: verify image pull access to the selected registry manually.',
      };
    }
    return {
      success: false,
      error:
        `Cluster ${clusterName} does not have a kubelet identity configured. ` +
        'Ensure the cluster uses managed identity (not service principal). ' +
        'See: https://learn.microsoft.com/azure/aks/use-managed-identity',
    };
  }

  // Validate that identityProfile.kubeletidentity.objectId exists
  const objectId = 'objectId' in kubeletIdentity ? kubeletIdentity.objectId : undefined;
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
