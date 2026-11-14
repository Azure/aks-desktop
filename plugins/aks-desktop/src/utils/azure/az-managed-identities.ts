// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** User-assigned managed identity operations through the ARM REST API. */

import { getErrorMessage, isValidGuid } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import { azListAll, azRequest, type AzRequestOptions, AzureRequestError } from './az-http';
import { getSubscriptionCredential } from './az-token';
import { isValidAzResourceName, type ManagedIdentityResult } from './az-validation';

const IDENTITY_API_VERSION = '2023-01-31';
const RESOURCE_GROUPS_API_VERSION = '2021-04-01';

/** User-assigned identity fields read from ARM responses. */
interface ArmIdentity {
  id?: string;
  name?: string;
  properties?: { clientId?: unknown; principalId?: unknown; tenantId?: unknown };
}

/** Checks that a value is a GUID string. */
const isGuid = (value: unknown): value is string => typeof value === 'string' && isValidGuid(value);

/** Builds the ARM path of a resource group. */
function groupPath(subscriptionId: string, resourceGroup: string): string {
  return (
    `/subscriptions/${encodeURIComponent(subscriptionId)}` +
    `/resourceGroups/${encodeURIComponent(resourceGroup)}`
  );
}

/** Returns the ARM endpoint, token scope and credential for requests in a subscription. */
async function requestBase(subscriptionId: string) {
  const { endpoint, scope } = await getAzureCloudEndpoints();
  return { endpoint, scope, credential: getSubscriptionCredential(subscriptionId) };
}

/** Returns an identity's client, principal and tenant IDs, or undefined if any is missing or invalid. */
function identityIds(identity: ArmIdentity | undefined) {
  const { clientId, principalId, tenantId } = identity?.properties ?? {};
  return isGuid(clientId) && isGuid(principalId) && isGuid(tenantId)
    ? { clientId, principalId, tenantId }
    : undefined;
}

/** Gets an identity's IDs, or `notFound` if the identity does not exist. */
async function readIdentity(
  url: string,
  identityName: string,
  base: Omit<AzRequestOptions, 'url'>
): Promise<ManagedIdentityResult> {
  let identity: ArmIdentity | undefined;
  try {
    identity = await azRequest<ArmIdentity>({ ...base, url, apiVersion: IDENTITY_API_VERSION });
  } catch (error) {
    // Missing resource groups and subscriptions are failures, not a missing identity.
    if (
      error instanceof AzureRequestError &&
      error.status === 404 &&
      (!error.code || error.code === 'ResourceNotFound')
    ) {
      return { success: false, notFound: true };
    }
    throw error;
  }
  const ids = identityIds(identity);
  if (!ids) {
    throw new Error(
      `Managed identity '${identityName}' returned incomplete clientId, principalId or tenantId`
    );
  }
  return { success: true, ...ids };
}

/** Gets a managed identity's client, principal and tenant IDs. */
export async function getManagedIdentity(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<ManagedIdentityResult> {
  const { identityName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  try {
    const url = `${groupPath(
      subscriptionId,
      resourceGroup
    )}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${encodeURIComponent(
      identityName
    )}`;
    return await readIdentity(url, identityName, await requestBase(subscriptionId));
  } catch (error) {
    return { success: false, error: `Failed to get managed identity: ${getErrorMessage(error)}` };
  }
}

/** Creates or updates a workload managed identity in its resource group's location. */
export async function createManagedIdentity(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<ManagedIdentityResult> {
  const { identityName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  try {
    const base = await requestBase(subscriptionId);
    const group = groupPath(subscriptionId, resourceGroup);
    const url = `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${encodeURIComponent(
      identityName
    )}`;

    let location: unknown;
    try {
      location = (
        await azRequest<{ location?: unknown }>({
          ...base,
          url: group,
          apiVersion: RESOURCE_GROUPS_API_VERSION,
        })
      )?.location;
    } catch (error) {
      throw new Error(`Failed to get resource group location: ${getErrorMessage(error)}`);
    }
    if (typeof location !== 'string' || !location) {
      throw new Error(`Resource group '${resourceGroup}' returned no location`);
    }

    let created: ArmIdentity | undefined;
    try {
      created = await azRequest<ArmIdentity>({
        ...base,
        url,
        apiVersion: IDENTITY_API_VERSION,
        method: 'PUT',
        body: { location, tags: { purpose: 'workload-identity', createdBy: 'AKS Desktop' } },
      });
    } catch (error) {
      // Race condition catch: overlapping creates of the same identity can return 409.
      // If the identity now exists, return it.
      if (!(error instanceof AzureRequestError && error.status === 409)) throw error;
      const existing = await readIdentity(url, identityName, base);
      if (existing.success) return existing;
      throw error;
    }

    const ids = identityIds(created);
    if (ids) return { success: true, ...ids };
    const existing = await readIdentity(url, identityName, base);
    if (existing.success) return existing;
    throw new Error(`Managed identity '${identityName}' was not readable after creation`);
  } catch (error) {
    return {
      success: false,
      error: `Failed to create managed identity: ${getErrorMessage(error)}`,
    };
  }
}

/** Lists the managed identities in a resource group. */
export async function listManagedIdentities(options: {
  resourceGroup: string;
  subscriptionId: string;
}): Promise<{
  success: boolean;
  identities?: Array<{
    name: string;
    clientId: string;
    principalId: string;
    resourceGroup: string;
  }>;
  error?: string;
}> {
  const { resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid resource group name' };
  }

  try {
    const items = await azListAll<ArmIdentity>({
      ...(await requestBase(subscriptionId)),
      url: `${groupPath(
        subscriptionId,
        resourceGroup
      )}/providers/Microsoft.ManagedIdentity/userAssignedIdentities`,
      apiVersion: IDENTITY_API_VERSION,
    });
    const identities = [];
    for (const { id, name, properties } of items) {
      if (!name || !isGuid(properties?.clientId) || !isGuid(properties?.principalId)) {
        console.warn('Skipping managed identity with incomplete properties:', id ?? name);
        continue;
      }
      identities.push({
        name,
        clientId: properties.clientId,
        principalId: properties.principalId,
        resourceGroup,
      });
    }
    return { success: true, identities };
  } catch (error) {
    return {
      success: false,
      error: `Failed to list managed identities: ${getErrorMessage(error)}`,
    };
  }
}
