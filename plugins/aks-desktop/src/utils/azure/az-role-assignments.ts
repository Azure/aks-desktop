// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { isValidGuid } from './az-cli-core';
import { azListAll, azRequest, type AzRequestOptions, AzureRequestError } from './az-http';
import { getSubscriptionCredential } from './az-token';

/** Explicit Entra object kind, avoiding a directory lookup for a known object ID. */
export type AzureRolePrincipalType = 'ServicePrincipal' | 'User' | 'Group';
/** REST authentication/request overrides; absent credentials bind to the scope's subscription. */
export type AzureRoleRequestOptions = Pick<
  AzRequestOptions,
  'credential' | 'tenantId' | 'endpoint' | 'signal' | 'timeoutMs'
> & {
  /** OAuth token scope override, distinct from the role assignment's ARM scope. */
  audience?: string;
};
const API_VERSION = '2022-04-01';

/** ARM role-assignment fields needed to verify exact-scope conflict idempotency. */
export interface AzureRoleAssignment {
  /** Complete assignment ARM ID, if Azure returned a response body. */
  id?: string;
  /** Assignment identity used to compare an existing RoleAssignmentExists result. */
  properties?: {
    /** Entra principal object GUID, not its display name or application/client ID. */
    principalId?: string;
    /** Azure principal kind returned by ARM. */
    principalType?: string;
    /** Full or provider-relative role-definition resource ID. */
    roleDefinitionId?: string;
    /** Exact assigned ARM resource scope; inherited/parent assignments do not match. */
    scope?: string;
  };
}

/**
 * @param value - ARM identifier or deterministic assignment-name component.
 * @returns URI-decoded, lowercase text without trailing slashes.
 * @throws URIError for malformed escapes, rather than comparing ambiguous IDs.
 */
function canonical(value: string) {
  return decodeURI(value).replace(/\/+$/, '').toLowerCase();
}

/**
 * @param role - Definition GUID, provider-relative ID, full ID, or unresolved role name.
 * @param subscriptionId - Target scope subscription used to expand a GUID/relative ID.
 * @returns A definition ARM ID, or undefined when role-name lookup is required.
 */
function definitionId(role: string, subscriptionId: string): string | undefined {
  const prefix = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/`;
  if (isValidGuid(role)) return prefix + role;
  if (
    /^\/providers\/Microsoft\.Authorization\/roleDefinitions\//i.test(role) &&
    isValidGuid(role.split('/').pop() ?? '')
  ) {
    return prefix + role.split('/').pop();
  }
  if (
    /^\/.*\/providers\/Microsoft\.Authorization\/roleDefinitions\/[^/]+$/i.test(role) &&
    isValidGuid(role.split('/').pop() ?? '')
  )
    return role;
  return undefined;
}

/**
 * @param values - Ordered scope, definition ID, principal ID and principal type.
 * @returns A deterministic SHA-256 UUIDv8, stable across equivalent ID casing/encoding.
 */
async function assignmentName(values: string[]): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(values.map(canonical)))
    )
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

/**
 * Creates one assignment using stable retry identity and exact-match idempotency.
 * @param options - Assignment identity plus REST authentication/cancellation overrides.
 * @returns The created body, undefined for an empty successful response, or a
 * verified existing assignment after RoleAssignmentExists. Matching includes scope,
 * principal, principal type and definition; role-name lookup follows all pages.
 * @throws For invalid input, missing/ambiguous definitions, HTTP/auth failures,
 * cancellation, or conflicts that cannot be verified as the same assignment.
 */
export async function createAzureRoleAssignment(
  options: AzureRoleRequestOptions & {
    /** Caller subscription GUID; the ARM scope may target another accessible subscription. */
    subscriptionId: string;
    /** Full subscription/resource ARM scope, including managed namespace, ACR or Arc scopes. */
    scope: string;
    /** Known Entra object GUID; never resolved through directory search. */
    principalId: string;
    /** Explicit User, Group or ServicePrincipal kind. */
    principalType: AzureRolePrincipalType;
    /** Exact role name, definition GUID or definition ARM ID. */
    role: string;
  }
): Promise<AzureRoleAssignment | undefined> {
  const { subscriptionId, principalId, principalType } = options;
  if (!isValidGuid(subscriptionId) || !isValidGuid(principalId)) {
    throw new AzureRequestError('Invalid subscription ID or principal ID format');
  }
  if (!['ServicePrincipal', 'User', 'Group'].includes(principalType)) {
    throw new AzureRequestError('Invalid principal type');
  }
  const scope = options.scope.trim().replace(/\/+$/, '');
  const scopeSubscriptionId = scope.match(/^\/subscriptions\/([^/]+)(?:\/|$)/i)?.[1];
  if (
    /[?#\\]/.test(scope) ||
    scope.split('/').some(segment => {
      const decoded = decodeURIComponent(segment);
      return ['.', '..'].includes(decoded) || /[/\\]/.test(decoded);
    }) ||
    !scopeSubscriptionId ||
    !isValidGuid(scopeSubscriptionId)
  ) {
    throw new AzureRequestError('Role scope must be a subscription resource ID');
  }
  const request = {
    ...options,
    scope: options.audience,
    credential: options.credential ?? getSubscriptionCredential(scopeSubscriptionId),
    apiVersion: API_VERSION,
  };
  const role = options.role.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!role) throw new AzureRequestError('A role name or definition ID is required');
  let roleDefinitionId = definitionId(role, scopeSubscriptionId);
  if (!roleDefinitionId) {
    const filter = new URLSearchParams({ $filter: `roleName eq '${role.replace(/'/g, "''")}'` });
    const definitions = await azListAll<{ id?: string; properties?: { roleName?: string } }>({
      ...request,
      url: `${scope}/providers/Microsoft.Authorization/roleDefinitions?${filter}`,
    });
    const matching = definitions.filter(
      item => item.properties?.roleName?.toLowerCase() === role.toLowerCase()
    );
    if (matching.length !== 1 || !matching[0].id) {
      throw new AzureRequestError(
        `Expected one role definition named "${role}", found ${matching.length}`
      );
    }
    roleDefinitionId = definitionId(matching[0].id, scopeSubscriptionId);
    if (!roleDefinitionId)
      throw new AzureRequestError('Role definition response contains an invalid resource ID');
  }
  const name = await assignmentName([scope, roleDefinitionId, principalId, principalType]);
  const resolvedRoleId = roleDefinitionId;
  const url = `${scope}/providers/Microsoft.Authorization/roleAssignments/${name}`;
  try {
    return await azRequest<AzureRoleAssignment>({
      ...request,
      url,
      method: 'PUT',
      body: { properties: { roleDefinitionId, principalId, principalType } },
    });
  } catch (error) {
    if (
      !(
        error instanceof AzureRequestError &&
        error.status === 409 &&
        error.code === 'RoleAssignmentExists'
      )
    ) {
      throw error;
    }
    const filter = new URLSearchParams({ $filter: `principalId eq '${principalId}'` });
    const assignments = await azListAll<AzureRoleAssignment>({
      ...request,
      url: `${scope}/providers/Microsoft.Authorization/roleAssignments?${filter}`,
    });
    const existing = assignments.find(
      ({ properties }) =>
        properties?.principalId?.toLowerCase() === principalId.toLowerCase() &&
        properties.principalType === principalType &&
        canonical(properties.scope ?? '') === canonical(scope) &&
        canonical(definitionId(properties.roleDefinitionId ?? '', scopeSubscriptionId) ?? '') ===
          canonical(resolvedRoleId)
    );
    if (!existing) throw error;
    return existing;
  }
}
