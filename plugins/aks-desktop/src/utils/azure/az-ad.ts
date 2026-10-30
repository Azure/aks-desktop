// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { isEntraObjectId, isUserPrincipalName } from '../shared/entraIdentifiers';
import { getErrorMessage } from './az-cli-core';
import { azRequest, AzureRequestError } from './az-http';

// Preserve the existing search input contract; identifiers resolved below are not restricted.
const ODATA_SAFE_QUERY_PATTERN = /^[a-zA-Z0-9@._ -]+$/;
const GRAPH_USERS_URL = 'https://graph.microsoft.com/v1.0/users';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const USER_FIELDS = 'id,displayName,mail,userPrincipalName';
const SEARCH_LIMIT = 15;

/** Selected Entra user identifiers and basic directory profile. */
export interface AzureADUser {
  /** Entra object ID used by Azure role assignments, not Kubernetes subjects. */
  id: string;
  /** Directory display name. */
  displayName: string;
  /** Optional directory email address; it is not a substitute for the UPN. */
  mail: string | null;
  /** Sign-in name used as a Kubernetes RoleBinding subject, including guest UPNs. */
  userPrincipalName: string;
}

/** Identifies authentication or authorization errors that make Entra directory lookup unavailable. */
export function isAzureADLookupUnavailable(error?: string): boolean {
  return /AADSTS(?:530084|50076|50079|65001|65004)\b|Authorization_RequestDenied|ErrorAccessDenied|\baccessDenied\b|insufficient privileges|consent_required|insufficient_claims/i.test(
    error ?? ''
  );
}

/**
 * Validates selected Graph fields without accepting partially populated directory users.
 * @param value - Untrusted Graph response item.
 * @returns The selected profile, with object ID and UPN kept distinct.
 * @throws {AzureRequestError} If required fields are missing or invalid.
 */
function parseUser(value: unknown): AzureADUser {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !isEntraObjectId(value.id) ||
    !('displayName' in value) ||
    typeof value.displayName !== 'string' ||
    !('mail' in value) ||
    (value.mail !== null && typeof value.mail !== 'string') ||
    !('userPrincipalName' in value) ||
    typeof value.userPrincipalName !== 'string' ||
    !isUserPrincipalName(value.userPrincipalName)
  ) {
    throw new AzureRequestError('Malformed Graph user response');
  }
  const { id, displayName, userPrincipalName } = value;
  return {
    id,
    displayName,
    mail: typeof value.mail === 'string' ? value.mail : null,
    userPrincipalName,
  };
}

/**
 * Searches Graph by display name, mail or UPN prefix in the CLI's default account.
 * Only the first page is requested; suggestions are capped at 15.
 * @param query - Trimmed before use; fewer than two characters or characters outside
 * the existing ASCII letters/digits/`@._ -` allowlist return an empty success.
 * @returns Selected users, or an explicit failure for authentication, HTTP or payload errors.
 */
export async function searchAzureADUsers(
  query: string
): Promise<{ success: boolean; users: AzureADUser[]; error?: string }> {
  if (!query || query.trim().length < 2) {
    return { success: true, users: [] };
  }

  const trimmed = query.trim();

  if (!ODATA_SAFE_QUERY_PATTERN.test(trimmed)) {
    return { success: true, users: [] };
  }

  const escaped = trimmed.replace(/'/g, "''");
  const url = new URL(GRAPH_USERS_URL);
  url.searchParams.set(
    '$filter',
    ['displayName', 'mail', 'userPrincipalName']
      .map(field => `startswith(${field},'${escaped}')`)
      .join(' or ')
  );
  url.searchParams.set('$select', USER_FIELDS);
  url.searchParams.set('$top', String(SEARCH_LIMIT));

  try {
    const data = await azRequest<{ value?: unknown }>({ url: url.href, scope: GRAPH_SCOPE });
    if (!data || !Array.isArray(data.value)) {
      throw new AzureRequestError('Malformed Graph user list response');
    }
    const users = data.value.map(parseUser).slice(0, SEARCH_LIMIT);
    return { success: true, users };
  } catch (error) {
    return {
      success: false,
      users: [],
      error: `Failed to search Azure AD users: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Resolves a single Entra user from either identifier and returns both.
 *
 * Both are needed and neither substitutes for the other: Azure role assignments
 * key on the **object ID**, while a Kubernetes RoleBinding subject must be the
 * **UPN** (the apiserver sees the OID only as an unmatched `Extra: oid`
 * attribute). Users picked from search already carry both; this fills the gap
 * for values typed by hand when directory search is blocked.
 *
 * Uses Graph in the CLI's default account without changing the selected account.
 * @param idOrUpn - Object ID or UPN, trimmed and validated before authentication.
 * @returns A complete selected user, or an explicit validation/authentication/HTTP failure.
 */
export async function resolveAzureADUser(
  idOrUpn: string
): Promise<{ success: boolean; user?: AzureADUser; error?: string }> {
  const trimmed = idOrUpn.trim();

  if (!isUserPrincipalName(trimmed) && !isEntraObjectId(trimmed)) {
    return { success: false, error: 'Not a valid object ID or user principal name' };
  }

  // Graph requires OData key syntax for UPNs beginning with `$`.
  const identifier = trimmed.startsWith('$') ? trimmed.replace(/'/g, "''") : trimmed;
  const encoded = encodeURIComponent(identifier).replace(/'/g, '%27');
  const url = new URL(
    trimmed.startsWith('$') ? `${GRAPH_USERS_URL}('${encoded}')` : `${GRAPH_USERS_URL}/${encoded}`
  );
  url.searchParams.set('$select', USER_FIELDS);

  try {
    const data = await azRequest<unknown>({ url: url.href, scope: GRAPH_SCOPE });
    return { success: true, user: parseUser(data) };
  } catch (error) {
    return {
      success: false,
      error: `Failed to resolve Azure AD user: ${getErrorMessage(error)}`,
    };
  }
}
