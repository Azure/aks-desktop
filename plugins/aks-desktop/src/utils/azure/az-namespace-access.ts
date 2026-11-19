// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getLoginStatus } from './az-auth';
import { debugLog, getErrorMessage, isValidGuid, needsRelogin } from './az-cli-core';
import { getAzureGraphEndpoints } from './az-cloud';
import { azRequest, AzureRequestError, createAzureRequestSignal } from './az-http';
import {
  buildArcNamespaceScope,
  buildConnectedClusterScope,
  getManagedNamespaceResourceId,
  type PrincipalType,
} from './az-identity';
import { checkNamespaceStatus } from './az-namespaces';
import {
  type AzureRoleRequestOptions,
  createAzureRoleAssignment,
  listAzureRoleAssignmentsAtScope,
} from './az-role-assignments';
import { getSubscriptionCredential } from './az-token';

type NamespaceOptions = AzureRoleRequestOptions & {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId?: string;
};

export async function checkNamespaceExists(
  clusterName: string,
  resourceGroup: string,
  namespaceName: string,
  subscriptionId?: string
): Promise<{ exists: boolean; stdout: string; stderr: string; error?: string }> {
  const result = await checkNamespaceStatus(
    clusterName,
    resourceGroup,
    namespaceName,
    subscriptionId
  );
  if (!result.success) {
    return { exists: false, stdout: result.stdout, stderr: result.stderr, error: result.error };
  }
  return { exists: result.status !== 'notfound', stdout: result.stdout, stderr: result.stderr };
}

/** Grants a role on a managed AKS namespace. */
export async function createNamespaceRoleAssignment(
  options: NamespaceOptions & {
    assigneeObjectId: string;
    /** Role name, definition GUID or definition ARM ID. */
    role: string;
    principalType?: PrincipalType;
  }
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  try {
    if (!options.subscriptionId) throw new Error('Subscription ID is required');
    const namespace = await getManagedNamespaceResourceId({
      ...options,
      subscriptionId: options.subscriptionId,
    });
    if (!namespace.success || !namespace.resourceId) {
      throw new Error(namespace.error || 'Failed to resolve managed namespace');
    }
    const assignment = await createAzureRoleAssignment({
      ...options,
      subscriptionId: options.subscriptionId,
      scope: namespace.resourceId,
      principalId: options.assigneeObjectId,
      principalType: options.principalType ?? 'User',
    });
    return { success: true, stdout: assignment ? JSON.stringify(assignment) : '', stderr: '' };
  } catch (error) {
    return { success: false, stdout: '', stderr: '', error: getErrorMessage(error) };
  }
}

/** Returns the ARM scope for a managed AKS or Arc namespace. */
async function resolveNamespaceScope(options: NamespaceOptions, isArcCluster = false) {
  let { subscriptionId, tenantId } = options;
  if (isArcCluster && !subscriptionId) throw new Error('Missing subscription for Arc cluster');
  // Use the signed-in subscription for older managed projects without a subscription label.
  if (!subscriptionId && !options.credential) {
    const account = await getLoginStatus();
    if (!account.isLoggedIn) throw new Error(account.error || 'Please run az login');
    subscriptionId = account.subscriptionId;
    tenantId ??= account.tenantId;
  }
  if (!subscriptionId || !isValidGuid(subscriptionId)) {
    throw new Error('A valid subscription ID is required');
  }
  const auth = { ...options, subscriptionId, tenantId };
  if (isArcCluster) {
    const scope = buildArcNamespaceScope(
      buildConnectedClusterScope(
        subscriptionId,
        encodeURIComponent(options.resourceGroup),
        encodeURIComponent(options.clusterName)
      ),
      encodeURIComponent(options.namespaceName)
    );
    return { ...auth, scope };
  }
  const namespace = await getManagedNamespaceResourceId(auth);
  if (!namespace.success || !namespace.resourceId) {
    throw new Error(namespace.error || 'Managed namespace not found');
  }
  return { ...auth, scope: namespace.resourceId };
}

function failureMessage(label: string, error: unknown): string {
  debugLog(label, error);
  const message = getErrorMessage(error);
  if (needsRelogin(message) || (error instanceof AzureRequestError && error.status === 401)) {
    return 'Azure login required';
  }
  return `${label}: ${message}`;
}

/** Checks whether the Entra object has a direct role assignment on the managed namespace. */
export async function verifyNamespaceAccess(
  options: NamespaceOptions & { assigneeObjectId: string }
): Promise<{
  success: boolean;
  hasAccess: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  let phase = 'Failed to resolve namespace';
  try {
    const resolved = await resolveNamespaceScope(options);
    phase = 'Failed to verify namespace access';
    const roles = await listAzureRoleAssignmentsAtScope({
      ...resolved,
      principalId: options.assigneeObjectId,
    });
    const assignments = roles.map(({ assignment, roleDefinitionName }) => ({
      roleDefinitionName,
      scope: assignment.properties?.scope,
    }));
    return {
      success: true,
      hasAccess: assignments.length > 0,
      stdout: JSON.stringify(assignments),
      stderr: '',
    };
  } catch (error) {
    return {
      success: false,
      hasAccess: false,
      stdout: '',
      stderr: '',
      error: failureMessage(phase, error),
    };
  }
}

export interface NamespaceRoleAssignment {
  id?: string;
  principalName: string | null;
  principalType: string | null;
  roleDefinitionName: string;
  scope: string;
}

type GraphTransport = { endpoint: string; scope: string };
type GraphPrincipal = { id?: string; userPrincipalName?: string; displayName?: string };

/** Looks up principal names in Microsoft Graph when available. */
async function getPrincipalNames(
  options: NamespaceOptions & { subscriptionId: string; graph?: GraphTransport },
  ids: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!ids.length || (!options.graph && (options.credential || options.endpoint))) return names;
  const linked = createAzureRequestSignal(options.signal, options.timeoutMs ?? 10_000);
  try {
    const graph = options.graph ?? (await getAzureGraphEndpoints(undefined, linked.signal));
    for (let start = 0; start < ids.length; start += 1000) {
      const data = await azRequest<{ value?: GraphPrincipal[] }>({
        ...options,
        ...graph,
        url: '/v1.0/directoryObjects/getByIds',
        method: 'POST',
        body: { ids: ids.slice(start, start + 1000) },
        credential: options.credential ?? getSubscriptionCredential(options.subscriptionId),
        signal: linked.signal,
      });
      if (!Array.isArray(data?.value)) throw new AzureRequestError('Malformed Graph object list');
      for (const principal of data.value) {
        const name = principal?.userPrincipalName || principal?.displayName;
        if (typeof principal?.id === 'string' && typeof name === 'string' && name) {
          names.set(principal.id.toLowerCase(), name);
        }
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    debugLog('Failed to resolve Entra principal names:', error);
  } finally {
    linked.dispose();
  }
  return names;
}

/** Lists direct role assignments on a managed AKS or Arc namespace. */
export async function listNamespaceRoleAssignments(
  options: NamespaceOptions & {
    isArcCluster?: boolean;
    /** Overrides the Graph endpoint and token scope. */
    graph?: GraphTransport;
  }
): Promise<{ success: boolean; assignments: NamespaceRoleAssignment[]; error?: string }> {
  let phase = 'Failed to resolve namespace';
  try {
    const resolved = await resolveNamespaceScope(options, options.isArcCluster);
    phase = 'Failed to load role assignments';
    const roles = await listAzureRoleAssignmentsAtScope(resolved);
    const principalIds = new Set<string>();
    for (const { assignment } of roles) {
      const id = assignment.properties?.principalId;
      if (typeof id === 'string' && isValidGuid(id)) principalIds.add(id.toLowerCase());
    }
    const names = await getPrincipalNames({ ...resolved, graph: options.graph }, [...principalIds]);
    return {
      success: true,
      assignments: roles.map(({ assignment, roleDefinitionName }) => {
        const { principalId, principalType, scope } = assignment.properties ?? {};
        return {
          ...(assignment.id ? { id: assignment.id } : {}),
          principalName:
            typeof principalId === 'string' ? names.get(principalId.toLowerCase()) ?? null : null,
          principalType: typeof principalType === 'string' ? principalType : null,
          roleDefinitionName,
          scope: scope ?? resolved.scope,
        };
      }),
    };
  } catch (error) {
    return { success: false, assignments: [], error: failureMessage(phase, error) };
  }
}
