// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { UserAssignment } from '../../components/CreateAKSProject/types';
import { mapUIRoleToAzureRole } from '../../components/CreateAKSProject/types';
import { createNamespaceRoleAssignment, verifyNamespaceAccess } from './az-cli';

export interface AssignRolesOptions {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId: string;
  assignments: UserAssignment[];
  onProgress?: (message: string) => void;
}

export interface AssignRolesResult {
  success: boolean;
  results: string[];
  errors: string[];
}

/**
 * Assigns Azure RBAC roles to users on a managed namespace.
 * For each user, assigns the selected role plus two default namespace roles.
 * Verifies access after assignment.
 */
export async function assignRolesToNamespace(
  options: AssignRolesOptions
): Promise<AssignRolesResult> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId, assignments, onProgress } =
    options;

  const validAssignments = assignments.filter(a => a.email.trim() !== '');

  if (validAssignments.length === 0) {
    onProgress?.('No user assignments to process...');
    return { success: true, results: [], errors: [] };
  }

  onProgress?.(`Adding user access for ${validAssignments.length} assignee(s)...`);

  const assignmentResults: string[] = [];
  const assignmentErrors: string[] = [];

  for (let index = 0; index < validAssignments.length; index++) {
    const assignment = validAssignments[index];
    onProgress?.(`Adding user ${assignment.email}...`);

    try {
      const azureRole = mapUIRoleToAzureRole(assignment.role);

      const rolesToAssign = [
        azureRole,
        'Azure Kubernetes Service Namespace User',
        'Azure Kubernetes Service Namespace Contributor',
      ];

      const roleAssignmentResults: Array<{
        role: string;
        success: boolean;
        error?: string;
        stderr?: string;
        skipped?: boolean;
      }> = [];

      for (const role of rolesToAssign) {
        onProgress?.(`Assigning ${role} to ${assignment.email}...`);

        const roleResult = await createNamespaceRoleAssignment({
          clusterName,
          resourceGroup,
          namespaceName,
          assignee: assignment.email,
          role,
          subscriptionId,
        });

        if (!roleResult.success) {
          const errorDetails = roleResult.stderr || roleResult.error || 'Unknown error';
          roleAssignmentResults.push({
            role,
            success: false,
            error: errorDetails,
            stderr: roleResult.stderr,
          });
        } else {
          roleAssignmentResults.push({ role, success: true });
        }
      }

      const failedRoles = roleAssignmentResults.filter(r => !r.success && !r.skipped);
      if (failedRoles.length > 0) {
        const failedRoleDetails = failedRoles
          .map(r => {
            const errorMsg = r.stderr || r.error || 'Unknown error';
            return `${r.role}: ${errorMsg}`;
          })
          .join('; ');
        assignmentErrors.push(
          `Failed to assign roles to user ${assignment.email}. ${failedRoleDetails}`
        );
        continue;
      }

      onProgress?.(`Verifying access for user ${assignment.email}...`);
      const verifyResult = await verifyNamespaceAccess({
        clusterName,
        resourceGroup,
        namespaceName,
        assignee: assignment.email,
        subscriptionId,
      });

      if (!verifyResult.success) {
        assignmentErrors.push(
          `Failed to verify access for user ${assignment.email}: ${
            verifyResult.error || 'Verification failed'
          }`
        );
      } else if (!verifyResult.hasAccess) {
        assignmentErrors.push(
          `User ${assignment.email} does not have the expected access to the namespace`
        );
      } else {
        assignmentResults.push(`✓ User ${assignment.email} added successfully`);
      }
    } catch (userError) {
      assignmentErrors.push(
        `Error processing user ${assignment.email}: ${
          userError instanceof Error ? userError.message : String(userError)
        }`
      );
    }
  }

  return {
    success: assignmentErrors.length === 0,
    results: assignmentResults,
    errors: assignmentErrors,
  };
}
