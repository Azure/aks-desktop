// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { mapUIRoleToAzureRole, UserAssignment } from '../../components/CreateAKSProject/types';
import {
  createNamespaceRoleAssignment,
  resolveUserObjectId,
  verifyNamespaceAccess,
} from './az-cli';

const AKS_NAMESPACE_USER_ROLE = 'Azure Kubernetes Service Namespace User';
const AKS_NAMESPACE_CONTRIBUTOR_ROLE = 'Azure Kubernetes Service Namespace Contributor';

export interface AssignRolesOptions {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId: string;
  assignments: UserAssignment[];
  onProgress?: (message: string) => void;
  /** Translation function for user-facing messages. Falls back to identity if not provided. */
  t?: (key: string, options?: Record<string, any>) => string;
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
  const translate =
    options.t ??
    ((key: string, opts?: Record<string, any>) => {
      if (!opts) return key;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        key
      );
    });

  const validAssignments = assignments.filter(a => a.email.trim() !== '');

  if (validAssignments.length === 0) {
    onProgress?.(translate('No user assignments to process') + '...');
    return { success: true, results: [], errors: [] };
  }

  onProgress?.(
    translate('Adding user access for {{count}} assignee', {
      count: validAssignments.length,
    }) + '...'
  );

  const assignmentResults: string[] = [];
  const assignmentErrors: string[] = [];

  for (const assignment of validAssignments) {
    try {
      onProgress?.(translate('Looking up user {{email}}', { email: assignment.email }) + '...');

      const userLookup = await resolveUserObjectId(assignment.email);
      if (!userLookup.success || !userLookup.objectId) {
        assignmentErrors.push(
          translate('Failed to resolve user {{email}}: {{message}}', {
            email: assignment.email,
            message: userLookup.error || translate('User not found'),
          })
        );
        continue;
      }

      const assigneeObjectId = userLookup.objectId;
      const azureRole = mapUIRoleToAzureRole(assignment.role);

      const rolesToAssign = [azureRole, AKS_NAMESPACE_USER_ROLE, AKS_NAMESPACE_CONTRIBUTOR_ROLE];

      const roleResults: Array<{
        role: string;
        success: boolean;
        error?: string;
        stderr?: string;
      }> = [];

      for (const role of rolesToAssign) {
        onProgress?.(
          translate('Assigning {{role}} to {{email}}', { role, email: assignment.email }) + '...'
        );

        const roleResult = await createNamespaceRoleAssignment({
          clusterName,
          resourceGroup,
          namespaceName,
          assigneeObjectId,
          role,
          subscriptionId,
        });

        if (!roleResult.success) {
          const errorDetails = roleResult.stderr || roleResult.error || translate('Unknown error');
          roleResults.push({
            role,
            success: false,
            error: errorDetails,
            stderr: roleResult.stderr,
          });
        } else {
          roleResults.push({ role, success: true });
        }
      }

      const failedRoles = roleResults.filter(r => !r.success);
      if (failedRoles.length > 0) {
        const failedRoleDetails = failedRoles
          .map(r => {
            const errorMsg = r.stderr || r.error || translate('Unknown error');
            return `${r.role}: ${errorMsg}`;
          })
          .join('; ');
        assignmentErrors.push(
          translate('Failed to assign roles to user {{email}}. {{details}}', {
            email: assignment.email,
            details: failedRoleDetails,
          })
        );
        continue;
      }

      onProgress?.(
        translate('Verifying access for user {{email}}', { email: assignment.email }) + '...'
      );
      const verifyResult = await verifyNamespaceAccess({
        clusterName,
        resourceGroup,
        namespaceName,
        assigneeObjectId,
        subscriptionId,
      });

      if (!verifyResult.success) {
        assignmentErrors.push(
          translate('Failed to verify access for user {{email}}: {{message}}', {
            email: assignment.email,
            message: verifyResult.error || translate('Verification failed'),
          })
        );
      } else if (!verifyResult.hasAccess) {
        assignmentErrors.push(
          translate('User {{email}} does not have the expected access to the namespace', {
            email: assignment.email,
          })
        );
      } else {
        assignmentResults.push(
          translate('User {{email}} added successfully', { email: assignment.email })
        );
      }
    } catch (userError) {
      assignmentErrors.push(
        translate('Error processing user {{email}}: {{message}}', {
          email: assignment.email,
          message: userError instanceof Error ? userError.message : String(userError),
        })
      );
    }
  }

  return {
    success: assignmentErrors.length === 0,
    results: assignmentResults,
    errors: assignmentErrors,
  };
}
