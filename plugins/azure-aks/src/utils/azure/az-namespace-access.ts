// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { AuthorizationManagementClient } from '@azure/arm-authorization';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { azureCredential } from '../../azureAuth';
import { debugLog, getErrorMessage, isValidGuid } from './az-helpers';
import { checkNamespaceStatus } from './az-namespaces';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/**
 * Resolves a user email/UPN to their Azure AD object ID via Microsoft Graph.
 * GUIDs are returned as-is without a directory lookup.
 */
async function resolveUserPrincipalId(userIdentifier: string): Promise<string> {
  if (isValidGuid(userIdentifier)) {
    return userIdentifier;
  }

  const credential = azureCredential;
  const { token } = await credential.getToken(GRAPH_SCOPE);

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userIdentifier)}?$select=id`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to resolve user '${userIdentifier}': ${response.status} ${errorText}`);
  }

  const user = await response.json();
  if (!user.id) {
    throw new Error(`User '${userIdentifier}' not found or has no object ID`);
  }

  return user.id;
}

/**
 * Resolves the ARM resource ID of a managed namespace via the
 * ContainerServiceClient. Returns undefined if the namespace has no ID.
 */
async function getNamespaceResourceId(
  subscriptionId: string | undefined,
  resourceGroup: string,
  clusterName: string,
  namespaceName: string
): Promise<string | undefined> {
  const aksClient = new ContainerServiceClient(azureCredential, subscriptionId!);
  const namespace = await aksClient.managedNamespaces.get(
    resourceGroup,
    clusterName,
    namespaceName
  );
  return namespace.id;
}

/**
 * Finds a role definition ID by role display name (or matching ID) within scope.
 */
async function findRoleDefinitionId(
  authClient: AuthorizationManagementClient,
  scope: string,
  roleName: string
): Promise<string | undefined> {
  for await (const roleDef of authClient.roleDefinitions.list(scope)) {
    if (roleDef.roleName === roleName || roleDef.id === roleName) {
      return roleDef.id;
    }
  }
  return undefined;
}

/** Strips surrounding single/double quotes and trims a role string. */
function cleanRoleName(role: string): string {
  return role.trim().replace(/^["']|["']$/g, '');
}

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

  const cleanRole = cleanRoleName(role);

  try {
    const principalId = await resolveUserPrincipalId(assigneeObjectId);

    const namespaceResourceId = await getNamespaceResourceId(
      subscriptionId,
      resourceGroup,
      clusterName,
      namespaceName
    );
    if (!namespaceResourceId) {
      return { success: false, stdout: '', stderr: '', error: 'Failed to resolve namespace' };
    }

    const authClient = new AuthorizationManagementClient(azureCredential, subscriptionId!);

    const roleDefinitionId = await findRoleDefinitionId(authClient, namespaceResourceId, cleanRole);
    if (!roleDefinitionId) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        error: `Role definition not found: ${cleanRole}`,
      };
    }

    await authClient.roleAssignments.create(namespaceResourceId, crypto.randomUUID(), {
      roleDefinitionId,
      principalId,
      principalType: 'User',
    });

    return { success: true, stdout: '', stderr: '' };
  } catch (error) {
    debugLog('Failed to create role assignment:', error);
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to create role assignment: ${getErrorMessage(error)}`,
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
    const principalId = await resolveUserPrincipalId(assigneeObjectId);

    const namespaceResourceId = await getNamespaceResourceId(
      subscriptionId,
      resourceGroup,
      clusterName,
      namespaceName
    );
    if (!namespaceResourceId) {
      return {
        success: false,
        hasAccess: false,
        stdout: '',
        stderr: '',
        error: 'Failed to resolve namespace',
      };
    }

    const authClient = new AuthorizationManagementClient(azureCredential, subscriptionId!);

    let hasAccess = false;
    for await (const assignment of authClient.roleAssignments.listForScope(namespaceResourceId, {
      filter: `principalId eq '${principalId}'`,
    })) {
      if (assignment.principalId === principalId) {
        hasAccess = true;
        break;
      }
    }

    return { success: true, hasAccess, stdout: '', stderr: '' };
  } catch (error) {
    debugLog('Failed to verify namespace access:', error);
    return {
      success: false,
      hasAccess: false,
      stdout: '',
      stderr: '',
      error: `Failed to verify namespace access: ${getErrorMessage(error)}`,
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
    const namespaceResourceId = await getNamespaceResourceId(
      subscriptionId,
      resourceGroup,
      clusterName,
      namespaceName
    );
    if (!namespaceResourceId) {
      return { success: false, assignments: [], error: 'Failed to resolve namespace' };
    }

    const authClient = new AuthorizationManagementClient(azureCredential, subscriptionId!);

    const rawAssignments: Array<{
      principalId?: string;
      principalType?: string;
      roleDefinitionId?: string;
      scope?: string;
    }> = [];
    for await (const assignment of authClient.roleAssignments.listForScope(namespaceResourceId)) {
      rawAssignments.push(assignment);
    }

    // Resolve role definition names (cached by definition ID).
    const roleNameCache = new Map<string, string>();
    const resolveRoleName = async (roleDefinitionId?: string): Promise<string> => {
      if (!roleDefinitionId) {
        return '';
      }
      const cached = roleNameCache.get(roleDefinitionId);
      if (cached !== undefined) {
        return cached;
      }
      let name = '';
      try {
        const roleDef = await authClient.roleDefinitions.getById(roleDefinitionId);
        name = roleDef.roleName ?? '';
      } catch (error) {
        debugLog('Failed to resolve role definition name:', error);
      }
      roleNameCache.set(roleDefinitionId, name);
      return name;
    };

    const assignments: NamespaceRoleAssignment[] = [];
    for (const assignment of rawAssignments) {
      assignments.push({
        principalName: assignment.principalId ?? null,
        principalType: assignment.principalType ?? null,
        roleDefinitionName: await resolveRoleName(assignment.roleDefinitionId),
        scope: assignment.scope ?? namespaceResourceId,
      });
    }

    return { success: true, assignments };
  } catch (error) {
    debugLog('Role assignment list threw:', error);
    return {
      success: false,
      assignments: [],
      error: `Failed to load role assignments: ${getErrorMessage(error)}`,
    };
  }
}
