// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { isEntraObjectId, isUserPrincipalName } from '../shared/entraIdentifiers';
import { getLoginStatus } from './az-auth';
import { getErrorMessage } from './az-cli-core';
import { getAzureGraphEndpoints } from './az-cloud';
import { azRequest, AzureRequestError } from './az-http';
import { type AzCliCredential, createAzCliCredential } from './az-token';

// Preserve the existing search input contract; identifiers resolved below are not restricted.
const ODATA_SAFE_QUERY_PATTERN = /^[a-zA-Z0-9@._ -]+$/;
const USER_FIELDS = 'id,displayName,mail,userPrincipalName';
const SEARCH_LIMIT = 15;

let generation = 0;
let current: { identity: string; credential: AzCliCredential } | undefined;

function clearContext() {
  generation++;
  current?.credential.clearCache();
  current = undefined;
}

if (typeof window !== 'undefined') {
  window.addEventListener('azure-auth-update', clearContext);
  window.addEventListener('azure-account-change', clearContext);
}

/**
 * Resolves the selected CLI account before consulting any Graph credential cache.
 * @returns Named-cloud Graph routing and a credential isolated to the full account identity.
 * @throws For unavailable/incomplete accounts, invalid clouds or a concurrent account change.
 */
async function getAzureGraphContext() {
  const account = await getLoginStatus();
  if (!account.isLoggedIn) {
    clearContext();
    throw new Error(account.error ?? 'Not logged in to Azure CLI');
  }
  if (
    typeof account.username !== 'string' ||
    !account.username.trim() ||
    !account.subscriptionId ||
    !account.tenantId ||
    !account.environmentName
  ) {
    clearContext();
    throw new Error('Current Azure CLI account is missing user, subscription, tenant or cloud');
  }

  const observedGeneration = generation;
  const { endpoint, scope } = await getAzureGraphEndpoints(account.environmentName);
  if (observedGeneration !== generation) {
    throw new Error('Azure CLI account changed during Graph context lookup; retry the lookup');
  }
  const identity = JSON.stringify([
    account.username,
    account.subscriptionId,
    account.tenantId,
    account.environmentName,
    endpoint,
    scope,
  ]);
  if (current?.identity !== identity) {
    current?.credential.clearCache();
    current = { identity, credential: createAzCliCredential(account.subscriptionId) };
  }
  return { endpoint, scope, tenantId: account.tenantId, credential: current.credential };
}

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
  try {
    const context = await getAzureGraphContext();
    const url = new URL(`${context.endpoint}/v1.0/users`);
    url.searchParams.set(
      '$filter',
      ['displayName', 'mail', 'userPrincipalName']
        .map(field => `startswith(${field},'${escaped}')`)
        .join(' or ')
    );
    url.searchParams.set('$select', USER_FIELDS);
    url.searchParams.set('$top', String(SEARCH_LIMIT));
    const data = await azRequest<{ value?: unknown }>({ ...context, url: url.href });
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
  try {
    const context = await getAzureGraphContext();
    const usersUrl = `${context.endpoint}/v1.0/users`;
    const url = new URL(
      trimmed.startsWith('$') ? `${usersUrl}('${encoded}')` : `${usersUrl}/${encoded}`
    );
    url.searchParams.set('$select', USER_FIELDS);
    const data = await azRequest<unknown>({ ...context, url: url.href });
    return { success: true, user: parseUser(data) };
  } catch (error) {
    return {
      success: false,
      error: `Failed to resolve Azure AD user: ${getErrorMessage(error)}`,
    };
  }
}
