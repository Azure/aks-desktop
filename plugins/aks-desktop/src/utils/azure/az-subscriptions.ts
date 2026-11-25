// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Azure subscription discovery and resource group operations, using the ARM REST API. */

import { getErrorMessage, isValidGuid, runCommandAsync } from './az-cli-core';
import { clearAzureCloudCache, getAzureCloudEndpoints } from './az-cloud';
import { azListAll, azRequest, azRequestRaw, AzureRequestError } from './az-http';
import {
  clearAzureTokenCaches,
  getAzureAccountGeneration,
  getNativeSubscriptionTenant,
  getSubscriptionCredential,
  setNativeSubscriptionTenants,
} from './az-token';
import { isValidAzResourceGroupName } from './az-validation';
import { hasNativeSession, isAzureExplicitlySignedOut } from './native-auth';

const SUBSCRIPTIONS_API_VERSION = '2022-12-01';
const RESOURCE_GROUPS_API_VERSION = '2021-04-01';
let nativeDiscoverySequence = 0;
let nativePublishedDiscoverySequence = 0;
interface SubscriptionTenantMetadata {
  tenant: string;
  tenantName?: string;
}
let nativePublishedDiscovery:
  | {
      accountGeneration: number;
      subscriptions: Array<Record<string, any>>;
      listedTenants: Map<string, SubscriptionTenantMetadata[]>;
    }
  | undefined;
/** Used when `createResourceGroup` is called without `tags`. */
const DEFAULT_RESOURCE_GROUP_TAGS = ['createdBy=AKS Desktop'];

/** A tenant as returned by `GET /tenants`. */
interface ArmTenant {
  tenantId: string;
  displayName?: string;
  defaultDomain?: string;
  domains?: string[];
}

/** A subscription as returned by `GET /subscriptions`. Its `id` is a path, not the GUID. */
interface ArmSubscription {
  subscriptionId: string;
  displayName: string;
  tenantId: string;
  state: string;
}

/** Identifies one resource group. */
interface ResourceGroupOptions {
  resourceGroupName: string;
  subscriptionId: string;
}

function resolveNativeSubscriptionTenants(
  subscriptions: Array<Record<string, any>>,
  listedTenants: Map<string, SubscriptionTenantMetadata[]>
) {
  return subscriptions.flatMap(subscription => {
    const tenant = getNativeSubscriptionTenant(subscription.id);
    if (!tenant) return [];
    const metadata = listedTenants
      .get(subscription.id)
      ?.find(value => value.tenant.toLowerCase() === tenant.toLowerCase());
    return [
      {
        ...subscription,
        tenant,
        tenantName: metadata?.tenantName,
        tenants: [...subscription.tenants],
      },
    ];
  });
}

/**
 * Lists subscriptions across all tenants in the active CLI cloud.
 * Tenants that fail (e.g. MFA required) are skipped. Disabled entries remain included.
 *
 * @param refresh - Clears cached tokens and cloud metadata, and refreshes the CLI profile.
 * @param options.strict - Reject partial discovery if no enabled subscription was found.
 * @returns `{ id, name, tenant, tenantName, status, environmentName }` for each subscription.
 * @throws When cloud configuration or tenants cannot be read, or every tenant fails.
 */
export async function getSubscriptions(
  refresh = false,
  options?: { strict?: boolean }
): Promise<any[]> {
  let profile: Map<string, string> | undefined;
  const nativeSession = hasNativeSession();
  if (!nativeSession && isAzureExplicitlySignedOut()) {
    throw new Error('Azure login is required');
  }
  const accountGeneration = getAzureAccountGeneration();
  const discoverySequence = nativeSession ? ++nativeDiscoverySequence : 0;
  if (refresh) {
    clearAzureTokenCaches();
    clearAzureCloudCache();
    if (!nativeSession) profile = await listCliProfileSubscriptions(true);
  }
  const cloud = await getAzureCloudEndpoints();
  const cloudOptions = { endpoint: cloud.endpoint, scope: cloud.scope };

  // ARM only lists subscriptions from the token's tenant, so query each tenant separately.
  const tenants = await azListAll<ArmTenant>({
    ...cloudOptions,
    url: '/tenants',
    apiVersion: SUBSCRIPTIONS_API_VERSION,
  });
  const results = await Promise.allSettled(
    tenants.map(tenant =>
      azListAll<ArmSubscription>({
        ...cloudOptions,
        url: '/subscriptions',
        apiVersion: SUBSCRIPTIONS_API_VERSION,
        tenantId: tenant.tenantId,
      })
    )
  );

  const subscriptions = new Map<string, any>();
  const listedTenants = new Map<string, SubscriptionTenantMetadata[]>();
  const errors: unknown[] = [];
  const failedTenantIds: string[] = [];

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      errors.push(result.reason);
      failedTenantIds.push(tenants[index].tenantId);
      console.warn(
        `Skipping subscriptions for tenant ${tenants[index].tenantId}:`,
        getErrorMessage(result.reason)
      );
      continue;
    }
    // Use the queried tenant, not the home tenant (they differ for Lighthouse), like the CLI.
    // Guest tenants often have no display name, so fall back to their domain.
    const tenant = tenants[index];
    const tenantName =
      tenant.displayName || tenant.defaultDomain || tenant.domains?.[0] || undefined;
    for (const sub of result.value) {
      const listed = listedTenants.get(sub.subscriptionId) ?? [];
      listedTenants.set(sub.subscriptionId, [...listed, { tenant: tenant.tenantId, tenantName }]);
      // The same subscription can be returned by more than one tenant; keep the first.
      if (subscriptions.has(sub.subscriptionId)) continue;
      subscriptions.set(sub.subscriptionId, {
        id: sub.subscriptionId,
        name: sub.displayName,
        tenant: tenant.tenantId,
        tenantName,
        status: sub.state,
        environmentName: cloud.name,
      });
    }
  }

  if (
    errors.length > 0 &&
    (errors.length === tenants.length ||
      (options?.strict && ![...subscriptions.values()].some(sub => sub.status === 'Enabled')))
  ) {
    throw errors[0];
  }
  // TODO: Remove this block and the tenant preference below with listCliProfileSubscriptions.
  if (!nativeSession && !profile && subscriptions.size > 0) {
    profile = await listCliProfileSubscriptions(false);
    if ([...subscriptions.keys()].some(id => !profile!.has(id.toLowerCase()))) {
      profile = await listCliProfileSubscriptions(true);
    }
  }
  // Prefer the CLI profile's tenant, which subscription-bound tokens are validated against.
  for (const [id, sub] of subscriptions) {
    const profileTenant = profile?.get(id.toLowerCase());
    const match = listedTenants.get(id)!.find(t => t.tenant.toLowerCase() === profileTenant);
    if (match) Object.assign(sub, match);
    sub.tenants = listedTenants.get(id)!.map(value => value.tenant);
  }
  let discovered = [...subscriptions.values()];
  if (!nativeSession && isAzureExplicitlySignedOut()) {
    throw new Error('Azure login is required');
  }
  if (nativeSession) {
    if (accountGeneration !== getAzureAccountGeneration() || !hasNativeSession()) {
      throw new Error('Azure account changed during subscription discovery');
    }
    if (discoverySequence < nativePublishedDiscoverySequence) {
      if (nativePublishedDiscovery?.accountGeneration !== accountGeneration) {
        throw new Error('Azure subscription discovery was superseded by a newer result');
      }
      return resolveNativeSubscriptionTenants(
        nativePublishedDiscovery.subscriptions,
        nativePublishedDiscovery.listedTenants
      );
    }
    if (
      discoverySequence > nativePublishedDiscoverySequence &&
      !setNativeSubscriptionTenants(discovered, accountGeneration, failedTenantIds)
    ) {
      throw new Error('Azure account changed during subscription discovery');
    }
    nativePublishedDiscoverySequence = Math.max(
      nativePublishedDiscoverySequence,
      discoverySequence
    );
    discovered = resolveNativeSubscriptionTenants(discovered, listedTenants);
    nativePublishedDiscovery = {
      accountGeneration,
      subscriptions: discovered.map(subscription => ({
        ...subscription,
        tenants: [...subscription.tenants],
      })),
      listedTenants,
    };
  }
  return discovered;
}

/**
 * TODO: Remove once tokens and cluster registration no longer use `--subscription`, which
 * only resolves subscriptions in the CLI profile.
 * @returns Lowercased subscription IDs mapped to their lowercased CLI profile tenant,
 * optionally refreshed first.
 */
async function listCliProfileSubscriptions(refresh: boolean): Promise<Map<string, string>> {
  if (isAzureExplicitlySignedOut()) throw new Error('Azure login is required');
  const { stdout, stderr } = await runCommandAsync('az', [
    'account',
    'list',
    '--all',
    ...(refresh ? ['--refresh'] : []),
    '--output',
    'json',
  ]);
  if (!stdout.trim()) throw new Error(stderr || 'Failed to read Azure CLI subscriptions');
  return new Map(
    JSON.parse(stdout).map((sub: { id: string; tenantId: string }) => [
      sub.id.toLowerCase(),
      sub.tenantId?.toLowerCase(),
    ])
  );
}

/** @returns An error message if the subscription ID or group name is invalid. */
function validateResourceGroup({
  resourceGroupName,
  subscriptionId,
}: ResourceGroupOptions): string | undefined {
  if (!isValidGuid(subscriptionId)) return `Invalid subscription ID format: '${subscriptionId}'`;
  if (!isValidAzResourceGroupName(resourceGroupName)) {
    return `Invalid resource group name: '${resourceGroupName}'`;
  }
  return undefined;
}

function resourceGroupPath({ resourceGroupName, subscriptionId }: ResourceGroupOptions): string {
  return (
    `/subscriptions/${encodeURIComponent(subscriptionId)}` +
    `/resourceGroups/${encodeURIComponent(resourceGroupName)}`
  );
}

/** Builds the `azRequest` options for a resource group. */
async function resourceGroupRequest(options: ResourceGroupOptions) {
  const { endpoint, scope } = await getAzureCloudEndpoints();
  return {
    url: resourceGroupPath(options),
    apiVersion: RESOURCE_GROUPS_API_VERSION,
    credential: getSubscriptionCredential(options.subscriptionId),
    endpoint,
    scope,
  };
}

/** Turns `['a=1', 'b=x=y']` into `{ a: '1', b: 'x=y' }`, splitting each at its first `=`. */
function parseTags(tags: string[]): Record<string, string> {
  return Object.fromEntries(
    tags.map(tag => {
      const separator = tag.indexOf('=');
      return separator < 0 ? [tag, ''] : [tag.slice(0, separator), tag.slice(separator + 1)];
    })
  );
}

/** @throws When the input is invalid, the group is missing, or it has no location. */
export async function getResourceGroupLocation(options: ResourceGroupOptions): Promise<string> {
  const error = validateResourceGroup(options);
  if (error) throw new Error(error);

  let group: { location?: unknown } | undefined;
  try {
    group = await azRequest(await resourceGroupRequest(options));
  } catch (err) {
    throw new Error(`Failed to get resource group location: ${getErrorMessage(err)}`);
  }
  if (typeof group?.location !== 'string' || !group.location) {
    throw new Error(`Resource group '${options.resourceGroupName}' returned no location`);
  }
  return group.location;
}

/** @returns `error` for any failure other than 404, so callers don't treat 403 as missing. */
export async function resourceGroupExists(
  options: ResourceGroupOptions
): Promise<{ exists: boolean; error?: string }> {
  const error = validateResourceGroup(options);
  if (error) return { exists: false, error };

  try {
    // 204 means the group exists; 404 means it does not.
    await azRequestRaw({ ...(await resourceGroupRequest(options)), method: 'HEAD' });
    return { exists: true };
  } catch (err) {
    if (err instanceof AzureRequestError && err.status === 404) return { exists: false };
    return {
      exists: false,
      error: `Failed to check resource group existence: ${getErrorMessage(err)}`,
    };
  }
}

/**
 * Creates a resource group, or updates it if it already exists.
 *
 * @param options.tags - `key=value` strings. Replaces the default `createdBy=AKS Desktop` tag.
 */
export async function createResourceGroup(
  options: ResourceGroupOptions & { location: string; tags?: string[] }
): Promise<{ success: boolean; error?: string }> {
  const error = validateResourceGroup(options);
  if (error) return { success: false, error };

  try {
    await azRequest({
      ...(await resourceGroupRequest(options)),
      method: 'PUT',
      body: {
        location: options.location,
        tags: parseTags(options.tags ?? DEFAULT_RESOURCE_GROUP_TAGS),
      },
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to create resource group: ${getErrorMessage(err)}` };
  }
}
