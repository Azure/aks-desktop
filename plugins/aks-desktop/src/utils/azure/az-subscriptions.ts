// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  debugLog,
  isAzError,
  isValidGuid,
  needsRelogin,
  runAzCommand,
  runCommandAsync,
} from './az-cli-core';
import { isValidAzResourceName } from './az-validation';

export async function getSubscriptionIds(): Promise<string[]> {
  const { stdout, stderr } = await runCommandAsync('az', [
    'account',
    'list',
    '--query',
    '[].id',
    '-o',
    'tsv',
  ]);
  if (!stdout) throw new Error(stderr || 'Failed to get subscription IDs');
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

export async function getSubscriptions(): Promise<any[]> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'list', '-o', 'json']);
  if (!stdout) throw new Error(stderr || 'Failed to get subscriptions');
  const subscriptions = JSON.parse(stdout).map((sub: any) => ({
    id: sub.id,
    name: sub.name,
    tenant: sub.tenantId,
    tenantName: sub.tenantDisplayName,
    status: sub.state,
  }));
  return resolveMissingTenantNames(subscriptions);
}

/**
 * Fill in `tenantName` for subscriptions where `az account list` omitted
 * `tenantDisplayName` — which it does for guest and cross-tenant access, leaving
 * the UI with nothing to show but the tenant GUID.
 *
 * Best-effort by design:
 *  - the extra `az account tenant list` call only runs when a name is actually
 *    missing, so the common single-tenant case pays no latency;
 *  - any failure (no active login, tenant not returned, no display name and no
 *    domain) leaves `tenantName` undefined so callers fall back to the GUID
 *    exactly as before. Tenant naming must never break subscription loading.
 */
async function resolveMissingTenantNames(subscriptions: any[]): Promise<any[]> {
  if (subscriptions.every(sub => sub.tenantName)) return subscriptions;

  let tenants: any[];
  try {
    tenants = await getTenants();
  } catch (error) {
    debugLog('Could not resolve tenant display names, falling back to tenant IDs:', error);
    return subscriptions;
  }

  const namesById = new Map<string, string>();
  for (const tenant of tenants) {
    // getTenants() already falls back to the GUID; treat that as "no name" so we
    // don't overwrite an absent name with a value that renders identically.
    const name = tenant.name && tenant.name !== tenant.id ? tenant.name : tenant.domain;
    if (tenant.id && name) namesById.set(tenant.id, name);
  }
  if (namesById.size === 0) return subscriptions;

  return subscriptions.map(sub =>
    sub.tenantName || !namesById.has(sub.tenant)
      ? sub
      : { ...sub, tenantName: namesById.get(sub.tenant) }
  );
}

export async function getTenants(): Promise<any[]> {
  const { stdout, stderr } = await runCommandAsync('az', [
    'account',
    'tenant',
    'list',
    '-o',
    'json',
  ]);
  if (!stdout) throw new Error(stderr || 'Failed to get tenants');
  return JSON.parse(stdout).map((tenant: any) => ({
    id: tenant.tenantId,
    name: tenant.displayName || tenant.tenantId,
    domain: tenant.domains?.[0] || '',
    status: 'Active',
  }));
}

export async function getResourceGroups(subscriptionId: string): Promise<any[]> {
  debugLog('Fetching resource groups for subscription:', subscriptionId);
  const { stdout, stderr } = await runCommandAsync('az', [
    'group',
    'list',
    '--subscription',
    subscriptionId,
    '--query',
    '[].{id:id,name:name,location:location}',
    '-o',
    'json',
  ]);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    throw new Error(`Failed to list resource groups: ${stderr}`);
  }

  try {
    const resourceGroups = JSON.parse(stdout);
    return resourceGroups.map((rg: any) => ({
      id: rg.id,
      name: rg.name,
      location: rg.location,
      subscriptionId: subscriptionId,
    }));
  } catch (error) {
    throw new Error('Failed to parse resource groups response');
  }
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

  const result = await runAzCommand(
    [
      'group',
      'show',
      '--name',
      resourceGroupName,
      '--subscription',
      subscriptionId,
      '--query',
      'location',
      '-o',
      'tsv',
    ],
    'Fetching resource group location:',
    'get resource group location',
    stdout => stdout.trim()
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? `Resource group '${resourceGroupName}' returned no location`);
  }

  return result.data;
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

  const result = await runAzCommand(
    ['group', 'exists', '--name', resourceGroupName, '--subscription', subscriptionId],
    'Checking resource group exists:',
    'check resource group existence',
    stdout => stdout.trim().toLowerCase() === 'true'
  );

  if (!result.success) {
    return { exists: false, error: result.error ?? 'Failed to check resource group existence' };
  }

  return { exists: result.data === true };
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

  const result = await runAzCommand(
    [
      'group',
      'create',
      '--name',
      resourceGroupName,
      '--location',
      location,
      '--subscription',
      subscriptionId,
      '--tags',
      ...(tags ?? ['createdBy=AKS Desktop']),
    ],
    'Creating resource group:',
    'create resource group'
  );

  return { success: result.success, error: result.error };
}

export async function getLocations(subscriptionId: string): Promise<any[]> {
  debugLog('Fetching Azure locations for subscription:', subscriptionId);
  const { stdout, stderr } = await runCommandAsync('az', [
    'account',
    'list-locations',
    '--subscription',
    subscriptionId,
    '--query',
    '[].{name:name,displayName:displayName,id:id}',
    '-o',
    'json',
  ]);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    throw new Error(`Failed to get locations: ${stderr}`);
  }

  // Log warnings but don't fail on them (like deprecation warnings)
  if (
    stderr &&
    !stderr.includes('UserWarning') &&
    !stderr.includes('pkg_resources is deprecated')
  ) {
    console.warn('Locations command warnings:', stderr);
  }

  try {
    const locations = JSON.parse(stdout || '[]');
    return locations
      .map((loc: any) => ({
        name: loc.name,
        displayName: loc.displayName,
        id: loc.id,
      }))
      .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));
  } catch (error) {
    console.error('Failed to parse locations response:', error);
    throw new Error('Failed to parse locations response');
  }
}

export async function getVmSizes(subscriptionId: string, location: string): Promise<any[]> {
  debugLog('Fetching VM sizes for location:', location);
  const { stdout, stderr } = await runCommandAsync('az', [
    'vm',
    'list-sizes',
    '--subscription',
    subscriptionId,
    '--location',
    location,
    '--query',
    '[?contains(name, `Standard_D`) || contains(name, `Standard_B`)].{name:name,cores:numberOfCores,memoryInMB:memoryInMB,diskSizeInMB:osDiskSizeInMB}',
    '-o',
    'json',
  ]);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    throw new Error(`Failed to get VM sizes for location ${location}: ${stderr}`);
  }

  try {
    const vmSizes = JSON.parse(stdout || '[]');
    // Filter and sort by cores, then by memory
    return vmSizes
      .filter((vm: any) => vm.cores >= 2 && vm.cores <= 32) // Reasonable range for AKS
      .sort((a: any, b: any) => a.cores - b.cores || a.memoryInMB - b.memoryInMB)
      .slice(0, 20); // Limit to 20 most common sizes
  } catch (error) {
    throw new Error('Failed to parse VM sizes response');
  }
}
