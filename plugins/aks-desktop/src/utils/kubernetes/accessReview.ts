// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

/** Outcome of checking one assignee's access to a namespace. */
export interface AccessReviewResult {
  /** The subject that was tested — the name the apiserver would see. */
  user: string;
  /** `null` when the review itself could not be performed. */
  allowed: boolean | null;
  /** Why the apiserver allowed or denied, when it says. */
  reason?: string;
  /** Set when the review could not be run at all (e.g. no permission to ask). */
  error?: string;
}

/**
 * Asks the cluster whether a user may act in `namespace`, using a
 * `SubjectAccessReview` — the API behind `kubectl auth can-i --as`.
 *
 * This exists because neither authorization model fails loudly. A RoleBinding
 * accepts any subject name, so one naming a subject the authenticator never
 * produces applies cleanly and grants nothing; and an Azure role assignment can
 * be created against a scope that grants nothing either. Asking the apiserver
 * directly is the only way to know a grant took effect, so project creation
 * verifies rather than assumes.
 *
 * **Both identifiers are needed**, because each authorizer keys on a different
 * one — the same split that makes a project need both in the first place:
 *
 * - **Kubernetes RBAC** matches `spec.user` against the RoleBinding subject,
 *   which is the UPN.
 * - **Azure RBAC** (`guard`) resolves the Entra principal from `spec.extra.oid`
 *   and ignores the username. Without it, guard answers "Azure does not have
 *   opinion for this non AAD user" and the review comes back denied even when
 *   the role assignment is in place.
 *
 * Sending both means one review works under either model. The extra is inert
 * where it is not needed: the RBAC authorizer ignores unknown extras.
 *
 * Requires permission to create SubjectAccessReviews (cluster admins have it).
 * When that is missing the result is `allowed: null` with an error, which the
 * caller should report as "could not verify" — not as a failed grant.
 *
 * @param clusterName - Headlamp cluster (kubeconfig context) name.
 * @param user - Username to test — the UPN. Falls back to the object ID when no
 *   UPN is known, which still lets `guard` answer via the extra.
 * @param objectId - Entra object ID, sent as `extra.oid` for `guard`.
 * @param namespace - Namespace the access is scoped to.
 * @param verb - Verb to test; defaults to `get`.
 * @param resource - Resource to test; defaults to `pods`.
 * @returns The apiserver decision, or an indeterminate result when review fails.
 */
export async function reviewNamespaceAccess(
  clusterName: string,
  user: string,
  objectId: string | undefined,
  namespace: string,
  verb: string = 'get',
  resource: string = 'pods'
): Promise<AccessReviewResult> {
  const body = {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SubjectAccessReview',
    spec: {
      user,
      ...(objectId ? { extra: { oid: [objectId] } } : {}),
      resourceAttributes: { namespace, verb, resource },
    },
  };

  try {
    const response = (await ApiProxy.clusterRequest(
      '/apis/authorization.k8s.io/v1/subjectaccessreviews',
      {
        cluster: clusterName,
        method: 'POST',
        isJSON: true,
        autoLogoutOnAuthError: false,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )) as { status?: { allowed?: boolean; reason?: string } };

    return {
      user,
      allowed: response?.status?.allowed === true,
      reason: response?.status?.reason,
    };
  } catch (error) {
    return {
      user,
      allowed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
