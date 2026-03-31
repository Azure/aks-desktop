// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { quoteForPlatform } from '../shared/quoteForPlatform';
import { debugLog, isAzError, needsRelogin, runCommandAsync } from './az-cli-core';
import { checkNamespaceStatus } from './az-namespaces';

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

export async function createNamespaceRoleAssignment(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  assigneeObjectId: string;
  role: string;
  subscriptionId?: string;
}): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const { clusterName, resourceGroup, namespaceName, assigneeObjectId, role, subscriptionId } =
    options;

  // Strip quotes from role if present (they may have been added for Windows)
  let cleanRole = role.trim();
  if (
    (cleanRole.startsWith('"') && cleanRole.endsWith('"')) ||
    (cleanRole.startsWith("'") && cleanRole.endsWith("'"))
  ) {
    cleanRole = cleanRole.slice(1, -1);
  }

  // On Windows, role names with spaces need double quotes for shell execution
  const finalRole = quoteForPlatform(cleanRole);

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

    debugLog('Getting namespace resource ID:', 'az', namespaceArgs.join(' '));

    const { stdout: namespaceStdout, stderr: namespaceStderr } = await runCommandAsync(
      'az',
      namespaceArgs
    );

    if (namespaceStderr && needsRelogin(namespaceStderr)) {
      return {
        success: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Azure login required',
      };
    }

    if (namespaceStderr && isAzError(namespaceStderr)) {
      return {
        success: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Failed to resolve namespace',
      };
    }

    const namespaceResourceId = namespaceStdout.trim();
    if (!namespaceResourceId) {
      return {
        success: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Failed to resolve namespace',
      };
    }

    // Now create the role assignment
    const roleArgs = [
      'role',
      'assignment',
      'create',
      '--assignee-object-id',
      assigneeObjectId,
      '--assignee-principal-type',
      'User',
      '--role',
      finalRole,
      '--scope',
      namespaceResourceId,
    ];

    if (subscriptionId) {
      roleArgs.push('--subscription', subscriptionId);
    }

    roleArgs.push('--output', 'json');

    debugLog('Creating role assignment:', 'az', roleArgs.join(' '));

    const { stdout: roleStdout, stderr: roleStderr } = await runCommandAsync('az', roleArgs);

    if (roleStderr && needsRelogin(roleStderr)) {
      return {
        success: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Azure login required',
      };
    }

    if (roleStderr && isAzError(roleStderr)) {
      debugLog('Failed to create role assignment:', roleStderr);
      return {
        success: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Failed to create role assignment',
      };
    }

    return {
      success: true,
      stdout: roleStdout,
      stderr: roleStderr,
    };
  } catch (error) {
    debugLog('Failed to create role assignment:', error);
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: 'Failed to create role assignment',
    };
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

/** Lists Azure role assignments on a provided managed namespace. */
export async function listNamespaceRoleAssignments(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId?: string;
}): Promise<{ success: boolean; assignments: NamespaceRoleAssignment[]; error?: string }> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  try {
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

    /** Fetch role assignments */
    const roleArgs = [
      'role',
      'assignment',
      'list',
      '--scope',
      namespaceResourceId,
      '--query',
      '[].{principalName:principalName,principalType:principalType,roleDefinitionName:roleDefinitionName,scope:scope}',
      '--output',
      'json',
    ];
    if (subscriptionId) {
      roleArgs.push('--subscription', subscriptionId);
    }

    debugLog('Listing role assignments:', 'az', roleArgs.join(' '));
    const { stdout, stderr } = await runCommandAsync('az', roleArgs);

    if (stderr && needsRelogin(stderr)) {
      debugLog('Role assignment list requires re-login:', stderr);
      return {
        success: false,
        assignments: [],
        error: 'Azure login required',
      };
    }

    if (stderr && isAzError(stderr)) {
      debugLog('Role assignment list failed:', stderr);
      return {
        success: false,
        assignments: [],
        error: 'Failed to load role assignments',
      };
    }

    const assignments: NamespaceRoleAssignment[] = stdout ? JSON.parse(stdout) : [];
    return { success: true, assignments };
  } catch (error) {
    debugLog('Role assignment list threw:', error);
    return { success: false, assignments: [], error: 'Failed to load role assignments' };
  }
}
