// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { debugLog, isValidGuid } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import {
  azListAll,
  azRequest,
  type AzRequestOptions,
  AzureRequestError,
  createAzureRequestSignal,
  waitForAzureRetry,
} from './az-http';
import { getSubscriptionCredential } from './az-token';

/** Explicit Entra object kind, avoiding a directory lookup for a known object ID. */
export type AzureRolePrincipalType = 'ServicePrincipal' | 'User' | 'Group';
/** REST overrides; production defaults use the configured cloud and scope's subscription. */
export type AzureRoleRequestOptions = Pick<
  AzRequestOptions,
  'credential' | 'tenantId' | 'endpoint' | 'signal' | 'timeoutMs'
> & {
  /** OAuth token scope override, distinct from the role assignment's ARM scope. */
  audience?: string;
};
const API_VERSION = '2022-04-01';

/** Fills in missing ARM endpoint and token scope from the configured cloud unless a credential is supplied. */
export async function getAzureRoleTransport(
  options: AzureRoleRequestOptions
): Promise<Pick<AzRequestOptions, 'endpoint' | 'scope'>> {
  if (options.credential || (options.endpoint && options.audience)) {
    return { endpoint: options.endpoint, scope: options.audience };
  }
  const linked = createAzureRequestSignal(options.signal, options.timeoutMs);
  try {
    const cloud = await getAzureCloudEndpoints(undefined, linked.signal);
    return {
      endpoint: options.endpoint ?? cloud.endpoint,
      scope: options.audience ?? cloud.scope,
    };
  } finally {
    linked.dispose();
  }
}

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

/** Normalizes ARM IDs for comparison. */
function canonical(value: string) {
  return decodeURI(value).replace(/\/+$/, '').toLowerCase();
}

/** Expands role IDs to full ARM IDs and leaves role names unresolved. */
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

/** Validates the ARM scope and extracts its subscription ID. */
function validateRoleScope(value: string) {
  const scope = value.trim().replace(/\/+$/, '');
  const subscriptionId = scope.match(/^\/subscriptions\/([^/]+)(?:\/|$)/i)?.[1];
  if (
    /[?#\\]/.test(scope) ||
    scope
      .split('/')
      .slice(1)
      .some(segment => {
        const decoded = decodeURIComponent(segment);
        return !decoded || ['.', '..'].includes(decoded) || /[/\\]/.test(decoded);
      }) ||
    !subscriptionId ||
    !isValidGuid(subscriptionId)
  ) {
    throw new AzureRequestError('Role scope must be a subscription resource ID');
  }
  return { scope, subscriptionId };
}

/** Builds role request options for the target subscription. */
async function roleRequest(options: AzureRoleRequestOptions, subscriptionId: string) {
  return {
    ...options,
    ...(await getAzureRoleTransport(options)),
    credential: options.credential ?? getSubscriptionCredential(subscriptionId),
    apiVersion: API_VERSION,
  };
}

/** Lists direct grants on the requested scope. */
async function listExactRoleAssignments(
  request: Omit<AzRequestOptions, 'url'>,
  scope: string
): Promise<AzureRoleAssignment[]> {
  const filter = new URLSearchParams({ $filter: 'atScope()' });
  const items = await azListAll<AzureRoleAssignment>({
    ...request,
    url: `${scope}/providers/Microsoft.Authorization/roleAssignments?${filter}`,
  });
  // ARM can include assignments at parent scopes even with atScope().
  const target = canonical(scope);
  return items.filter(item => {
    const assignedScope = item?.properties?.scope;
    return typeof assignedScope === 'string' && canonical(assignedScope) === target;
  });
}

type RoleDefinition = { id?: string; properties?: { roleName?: string } };

function listRoleDefinitions(
  request: Omit<AzRequestOptions, 'url'>,
  scope: string,
  filter?: URLSearchParams
) {
  return azListAll<RoleDefinition>({
    ...request,
    url: `${scope}/providers/Microsoft.Authorization/roleDefinitions${filter ? `?${filter}` : ''}`,
  });
}

/** Extracts the lowercase GUID from a role definition ID. */
function roleDefinitionKey(id: string | undefined, subscriptionId: string): string | undefined {
  return definitionId(id ?? '', subscriptionId)
    ?.split('/')
    .pop()
    ?.toLowerCase();
}

/**
 * Lists role assignments at the given ARM scope, optionally filtering by principal ID.
 * Returns a role definition ID when its name cannot be resolved.
 */
export async function listAzureRoleAssignmentsAtScope(
  options: AzureRoleRequestOptions & { scope: string; principalId?: string }
): Promise<Array<{ assignment: AzureRoleAssignment; roleDefinitionName: string }>> {
  const { scope, subscriptionId } = validateRoleScope(options.scope);
  const { principalId } = options;
  if (principalId !== undefined && !isValidGuid(principalId)) {
    throw new AzureRequestError('Invalid principal ID format');
  }
  const request = await roleRequest(options, subscriptionId);
  const principal = principalId?.toLowerCase();
  const assignments = (await listExactRoleAssignments(request, scope)).filter(({ properties }) => {
    const id = properties?.principalId;
    return principal === undefined || (typeof id === 'string' && id.toLowerCase() === principal);
  });
  const names = new Map<string, string>();
  if (
    assignments.some(({ properties }) =>
      roleDefinitionKey(properties?.roleDefinitionId, subscriptionId)
    )
  ) {
    try {
      for (const definition of await listRoleDefinitions(request, scope)) {
        const key = roleDefinitionKey(definition?.id, subscriptionId);
        const name = definition?.properties?.roleName;
        if (key && typeof name === 'string' && name) names.set(key, name);
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      debugLog('Failed to resolve Azure role names:', error);
    }
  }
  return assignments.map(assignment => {
    const key = roleDefinitionKey(assignment.properties?.roleDefinitionId, subscriptionId);
    return {
      assignment,
      roleDefinitionName: (key && names.get(key)) || key || '',
    };
  });
}

/** Generates a stable assignment ID for retries. */
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

/** Creates a role assignment or returns an existing grant after verifying it matches. */
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
  const { scope, subscriptionId: scopeSubscriptionId } = validateRoleScope(options.scope);
  const role = options.role.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!role) throw new AzureRequestError('A role name or definition ID is required');
  const request = await roleRequest(options, scopeSubscriptionId);
  let roleDefinitionId = definitionId(role, scopeSubscriptionId);
  if (!roleDefinitionId) {
    const filter = new URLSearchParams({ $filter: `roleName eq '${role.replace(/'/g, "''")}'` });
    const definitions = await listRoleDefinitions(request, scope, filter);
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
      maxRetries: 3,
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
    const linked = createAzureRequestSignal(options.signal, options.timeoutMs);
    try {
      for (;;) {
        const assignments = await listExactRoleAssignments(
          { ...request, signal: linked.signal },
          scope
        );
        const existing = assignments.find(
          ({ properties }) =>
            properties?.principalId?.toLowerCase() === principalId.toLowerCase() &&
            properties.principalType === principalType &&
            canonical(
              definitionId(properties.roleDefinitionId ?? '', scopeSubscriptionId) ?? ''
            ) === canonical(resolvedRoleId)
        );
        if (existing) return existing;
        await waitForAzureRetry(undefined, linked.signal);
      }
    } catch (verificationError) {
      // Preserve an unverified conflict on deadline; caller cancellation still propagates.
      if (
        linked.signal.aborted &&
        !options.signal?.aborted &&
        verificationError === linked.signal.reason
      ) {
        throw error;
      }
      throw verificationError;
    } finally {
      linked.dispose();
    }
  }
}
