// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { azureCredential } from '../../azureAuth';
import { debugLog, getErrorMessage } from './az-helpers';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

// Allowlist for OData filter values — blocks injection of OData operators and quotes
const ODATA_SAFE_QUERY_PATTERN = /^[a-zA-Z0-9@._ -]+$/;

export interface AzureADUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}

/**
 * Determines whether an error should permanently disable user search so the UI
 * can fall back to manual UUID entry (conditional access / insufficient
 * directory read permissions).
 */
function isPermissionError(text: string): boolean {
  return (
    text.includes('AADSTS530084') ||
    text.includes('AADSTS50079') ||
    text.includes('Authorization_RequestDenied') ||
    text.includes('Insufficient privileges')
  );
}

/**
 * Searches Azure AD users by display name, mail, or UPN prefix via the
 * Microsoft Graph REST API. Results are limited to 15.
 * May fail if the tenant blocks directory reads via conditional access policies;
 * such failures return `success: false` so the UI can disable search.
 */
export async function searchAzureADUsers(
  query: string
): Promise<{ success: boolean; users: AzureADUser[]; error?: string }> {
  if (!query || query.trim().length < 2) {
    return { success: true, users: [] };
  }

  const trimmed = query.trim();

  // Reject queries with characters that could manipulate the OData filter
  if (!ODATA_SAFE_QUERY_PATTERN.test(trimmed)) {
    return { success: true, users: [] };
  }

  const filterValue = `startswith(displayName,'${trimmed}') or startswith(mail,'${trimmed}') or startswith(userPrincipalName,'${trimmed}')`;

  const url =
    'https://graph.microsoft.com/v1.0/users' +
    `?$filter=${encodeURIComponent(filterValue)}` +
    '&$select=id,displayName,mail,userPrincipalName' +
    '&$top=15';

  try {
    debugLog('Searching Azure AD users:', trimmed);

    const credential = azureCredential;
    const { token } = await credential.getToken(GRAPH_SCOPE);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ConsistencyLevel: 'eventual',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 403 || isPermissionError(body)) {
        return { success: false, users: [], error: body || `HTTP ${response.status}` };
      }
      return { success: true, users: [] };
    }

    const data = await response.json();
    const users: AzureADUser[] = (data.value ?? []).map((u: any) => ({
      id: u.id,
      displayName: u.displayName,
      mail: u.mail ?? null,
      userPrincipalName: u.userPrincipalName,
    }));

    return { success: true, users };
  } catch (error) {
    const message = getErrorMessage(error);
    if (isPermissionError(message)) {
      return { success: false, users: [], error: message };
    }
    return { success: true, users: [] };
  }
}
