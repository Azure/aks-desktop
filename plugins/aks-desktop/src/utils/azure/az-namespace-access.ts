// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { debugLog, getErrorMessage, isAzError, needsRelogin, runCommandAsync } from './az-cli-core';
import {
  buildArcNamespaceScope,
  buildConnectedClusterScope,
  getManagedNamespaceResourceId,
  type PrincipalType,
} from './az-identity';
import { checkNamespaceStatus } from './az-namespaces';
import { type AzureRoleRequestOptions, createAzureRoleAssignment } from './az-role-assignments';

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

/**
 * Resolves a managed AKS namespace through REST, then grants a known Entra object access.
 * @param options - Namespace coordinates, role, principal and optional REST overrides.
 * @returns A resolved success/failure result. stdout contains assignment JSON when
 * available, stderr is empty, and error carries validation, lookup or write failures.
 * Known namespace absence does not create an assignment. Expected failures do not reject.
 */
export async function createNamespaceRoleAssignment(
  options: AzureRoleRequestOptions & {
    /** Managed AKS resource name, never an Arc cluster. */
    clusterName: string;
    /** Resource group containing that AKS cluster. */
    resourceGroup: string;
    /** Managed namespace resource name used to resolve the exact assignment scope. */
    namespaceName: string;
    /** Known Entra object GUID; no directory lookup is performed. */
    assigneeObjectId: string;
    /** Role name, definition GUID or definition ARM ID. */
    role: string;
    /** Required at runtime; omission produces a failure instead of using CLI defaults. */
    subscriptionId?: string;
    /** Defaults to User; callers can explicitly grant Group or ServicePrincipal access. */
    principalType?: PrincipalType;
  }
): Promise<{
  /** Whether namespace resolution and role creation/verified reuse succeeded. */
  success: boolean;
  /** Assignment JSON when returned, otherwise an empty string. */
  stdout: string;
  /** Always empty for this REST-backed operation; inspect error for failures. */
  stderr: string;
  /** Diagnostic when success is false. */
  error?: string;
}> {
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

export async function verifyNamespaceAccess(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  assigneeObjectId: string;
  subscriptionId?: string;
}): Promise<{
  success: boolean;
  hasAccess: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  const { clusterName, resourceGroup, namespaceName, assigneeObjectId, subscriptionId } = options;

  try {
    // First, get the resource ID of the managed namespace
    const namespaceArgs = [
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
    ];

    if (subscriptionId) {
      namespaceArgs.push('--subscription', subscriptionId);
    }

    debugLog(
      'Getting namespace resource ID for access verification:',
      'az',
      namespaceArgs.join(' ')
    );

    const { stdout: namespaceStdout, stderr: namespaceStderr } = await runCommandAsync(
      'az',
      namespaceArgs
    );

    if (namespaceStderr && needsRelogin(namespaceStderr)) {
      return {
        success: false,
        hasAccess: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Azure login required',
      };
    }

    if (namespaceStderr && isAzError(namespaceStderr)) {
      debugLog('Failed to get namespace resource ID:', namespaceStderr);
      return {
        success: false,
        hasAccess: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Failed to resolve namespace',
      };
    }

    const namespaceResourceId = namespaceStdout.trim();
    if (!namespaceResourceId) {
      debugLog('Namespace resource ID is empty:', namespaceStderr);
      return {
        success: false,
        hasAccess: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Failed to resolve namespace',
      };
    }

    // Now check for existing role assignments
    const roleArgs = [
      'role',
      'assignment',
      'list',
      '--assignee',
      assigneeObjectId,
      '--scope',
      namespaceResourceId,
      '--query',
      '[].{roleDefinitionName:roleDefinitionName,scope:scope}',
      '--output',
      'json',
    ];

    if (subscriptionId) {
      roleArgs.push('--subscription', subscriptionId);
    }

    debugLog('Checking role assignments:', 'az', roleArgs.join(' '));

    const { stdout: roleStdout, stderr: roleStderr } = await runCommandAsync('az', roleArgs);

    if (roleStderr && needsRelogin(roleStderr)) {
      return {
        success: false,
        hasAccess: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Azure login required',
      };
    }

    if (roleStderr && isAzError(roleStderr)) {
      debugLog('Failed to check role assignments:', roleStderr);
      return {
        success: false,
        hasAccess: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Failed to verify namespace access',
      };
    }

    try {
      const roleAssignments = JSON.parse(roleStdout || '[]');
      const hasAccess = roleAssignments.length > 0;

      return {
        success: true,
        hasAccess,
        stdout: roleStdout,
        stderr: roleStderr,
      };
    } catch (parseError) {
      debugLog('Failed to parse role assignments response:', parseError);
      return {
        success: false,
        hasAccess: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Failed to verify namespace access',
      };
    }
  } catch (error) {
    debugLog('Failed to verify namespace access:', error);
    return {
      success: false,
      hasAccess: false,
      stdout: '',
      stderr: '',
      error: 'Failed to verify namespace access',
    };
  }
}

/** Interface for a single Azure role assignment on a managed namespace. */
export interface NamespaceRoleAssignment {
  principalName: string | null;
  principalType: string | null;
  roleDefinitionName: string;
  scope: string;
}

/**
 * Lists Azure role assignments scoped to a project's namespace.
 *
 * Works for both cluster kinds, which differ only in how the namespace scope is
 * obtained:
 *
 * - **Managed AKS** — the managed namespace is a real ARM resource, so its ID is
 *   read with `az aks namespace show`.
 * - **Arc** — there is no namespace resource to look up; the scope is a path under
 *   the connected cluster and is constructed directly, saving a round trip.
 */
export async function listNamespaceRoleAssignments(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId?: string;
  /** Set for Arc (AKS Hybrid & Edge) clusters. Requires `subscriptionId`. */
  isArcCluster?: boolean;
}): Promise<{ success: boolean; assignments: NamespaceRoleAssignment[]; error?: string }> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId, isArcCluster } = options;

  try {
    if (isArcCluster) {
      if (!subscriptionId) {
        return { success: false, assignments: [], error: 'Missing subscription for Arc cluster' };
      }
      const arcScope = buildArcNamespaceScope(
        buildConnectedClusterScope(subscriptionId, resourceGroup, clusterName),
        namespaceName
      );
      return listRoleAssignmentsAtScope(arcScope, subscriptionId);
    }

    /** Fetch ARM ID of managed namespace */
    const nsArgs = [
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
    ];
    if (subscriptionId) {
      nsArgs.push('--subscription', subscriptionId);
    }

    debugLog('Getting namespace resource ID for role list:', 'az', nsArgs.join(' '));
    const { stdout: nsStdout, stderr: nsStderr } = await runCommandAsync('az', nsArgs);

    if (nsStderr && needsRelogin(nsStderr)) {
      debugLog('Namespace lookup requires re-login:', nsStderr);
      return {
        success: false,
        assignments: [],
        error: 'Azure login required',
      };
    }

    if (nsStderr && isAzError(nsStderr)) {
      debugLog('Namespace lookup failed:', nsStderr);
      return {
        success: false,
        assignments: [],
        error: 'Failed to resolve namespace',
      };
    }

    const namespaceResourceId = nsStdout.trim();
    if (!namespaceResourceId) {
      debugLog('Namespace lookup returned empty resource ID:', nsStderr);
      return {
        success: false,
        assignments: [],
        error: 'Failed to resolve namespace',
      };
    }

    return listRoleAssignmentsAtScope(namespaceResourceId, subscriptionId);
  } catch (error) {
    debugLog('Role assignment list threw:', error);
    return { success: false, assignments: [], error: 'Failed to load role assignments' };
  }
}

/** Runs `az role assignment list` against an already-resolved ARM scope. */
async function listRoleAssignmentsAtScope(
  scope: string,
  subscriptionId?: string
): Promise<{ success: boolean; assignments: NamespaceRoleAssignment[]; error?: string }> {
  const roleArgs = [
    'role',
    'assignment',
    'list',
    '--scope',
    scope,
    '--query',
    '[].{principalName:principalName,principalType:principalType,roleDefinitionName:roleDefinitionName,scope:scope}',
    '--output',
    'json',
  ];
  if (subscriptionId) {
    roleArgs.push('--subscription', subscriptionId);
  }

  debugLog('Listing role assignments:', 'az', roleArgs.join(' '));
  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await runCommandAsync('az', roleArgs));
  } catch (error) {
    // The command itself failed to run — a missing executable or a spawn error.
    // Callers `return` this helper's promise from inside their own try, which does
    // not catch a rejection, so the failure has to become a result here.
    debugLog('Role assignment list could not run:', error);
    return { success: false, assignments: [], error: 'Failed to load role assignments' };
  }

  if (stderr && needsRelogin(stderr)) {
    debugLog('Role assignment list requires re-login:', stderr);
    return { success: false, assignments: [], error: 'Azure login required' };
  }

  if (stderr && isAzError(stderr)) {
    debugLog('Role assignment list failed:', stderr);
    return { success: false, assignments: [], error: 'Failed to load role assignments' };
  }

  try {
    const assignments: NamespaceRoleAssignment[] = stdout ? JSON.parse(stdout) : [];
    return { success: true, assignments };
  } catch (error) {
    // `az` returned a zero exit code but unparseable output — treat as a failure
    // rather than letting the SyntaxError escape to the caller.
    debugLog('Role assignment list returned invalid JSON:', error);
    return { success: false, assignments: [], error: 'Failed to load role assignments' };
  }
}
