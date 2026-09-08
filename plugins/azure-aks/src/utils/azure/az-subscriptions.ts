// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ResourceManagementClient } from '@azure/arm-resources';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { azureCredential } from '../../azureAuth';
import { debugLog, getErrorMessage, isValidGuid } from './az-helpers';
import { isValidAzResourceName } from './az-validation';

export async function getSubscriptionIds(): Promise<string[]> {
  const client = new SubscriptionClient(azureCredential);
  const ids: string[] = [];
  for await (const sub of client.subscriptions.list()) {
    if (sub.subscriptionId) {
      ids.push(sub.subscriptionId);
    }
  }
  return ids;
}

export async function getSubscriptions(): Promise<any[]> {
  const client = new SubscriptionClient(azureCredential);
  const subscriptions: any[] = [];
  for await (const sub of client.subscriptions.list()) {
    subscriptions.push({
      id: sub.subscriptionId,
      name: sub.displayName,
      tenant: sub.tenantId,
      tenantName: '',
      status: sub.state,
    });
  }
  return subscriptions;
}

export async function getTenants(): Promise<any[]> {
  const client = new SubscriptionClient(azureCredential);
  const tenants: any[] = [];
  for await (const tenant of client.tenants.list()) {
    tenants.push({
      id: tenant.tenantId,
      name: tenant.displayName || tenant.tenantId,
      domain: tenant.domains?.split(',')[0] || tenant.defaultDomain || '',
      status: 'Active',
    });
  }
  return tenants;
}

export async function getResourceGroups(subscriptionId: string): Promise<any[]> {
  debugLog('Fetching resource groups for subscription:', subscriptionId);
  const client = new ResourceManagementClient(azureCredential, subscriptionId);
  const resourceGroups: any[] = [];
  for await (const rg of client.resourceGroups.list()) {
    resourceGroups.push({
      id: rg.id,
      name: rg.name,
      location: rg.location,
      subscriptionId,
    });
  }
  return resourceGroups;
}

export async function getResourceGroupLocation(options: {
  resourceGroupName: string;
  subscriptionId: string;
}): Promise<string> {
  const { resourceGroupName, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    throw new Error(`Invalid subscription ID format: '${subscriptionId}'`);
  }
  if (!isValidAzResourceName(resourceGroupName)) {
    throw new Error(`Invalid resource group name: '${resourceGroupName}'`);
  }

  const client = new ResourceManagementClient(azureCredential, subscriptionId);
  const rg = await client.resourceGroups.get(resourceGroupName);

  if (!rg.location) {
    throw new Error(`Resource group '${resourceGroupName}' returned no location`);
  }

  return rg.location;
}

export async function resourceGroupExists(options: {
  resourceGroupName: string;
  subscriptionId: string;
}): Promise<{ exists: boolean; error?: string }> {
  const { resourceGroupName, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { exists: false, error: `Invalid subscription ID format: '${subscriptionId}'` };
  }
  if (!isValidAzResourceName(resourceGroupName)) {
    return { exists: false, error: `Invalid resource group name: '${resourceGroupName}'` };
  }

  try {
    const client = new ResourceManagementClient(azureCredential, subscriptionId);
    const result = await client.resourceGroups.checkExistence(resourceGroupName);
    return { exists: result.body === true };
  } catch (error) {
    return { exists: false, error: getErrorMessage(error) };
  }
}

export async function createResourceGroup(options: {
  resourceGroupName: string;
  location: string;
  subscriptionId: string;
  tags?: string[];
}): Promise<{ success: boolean; error?: string }> {
  const { resourceGroupName, location, subscriptionId, tags } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: `Invalid subscription ID format: '${subscriptionId}'` };
  }
  if (!isValidAzResourceName(resourceGroupName)) {
    return { success: false, error: `Invalid resource group name: '${resourceGroupName}'` };
  }

  try {
    const client = new ResourceManagementClient(azureCredential, subscriptionId);
    await client.resourceGroups.createOrUpdate(resourceGroupName, {
      location,
      tags: parseTags(tags ?? ['createdBy=AKS Desktop']),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

/** Converts a `key=value` string array into a tags record. */
function parseTags(tags: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const tag of tags) {
    const separatorIndex = tag.indexOf('=');
    if (separatorIndex === -1) {
      record[tag] = '';
    } else {
      record[tag.slice(0, separatorIndex)] = tag.slice(separatorIndex + 1);
    }
  }
  return record;
}

export async function getLocations(subscriptionId: string): Promise<any[]> {
  debugLog('Fetching Azure locations for subscription:', subscriptionId);
  const client = new SubscriptionClient(azureCredential);
  const locations: any[] = [];
  for await (const loc of client.subscriptions.listLocations(subscriptionId)) {
    locations.push({
      name: loc.name,
      displayName: loc.displayName,
      id: loc.id,
    });
  }
  return locations.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
}
