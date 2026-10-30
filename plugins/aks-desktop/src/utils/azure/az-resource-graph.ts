// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Azure Resource Graph queries, using the ARM REST API. */

import { debugLog, getErrorMessage, isValidGuid } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import { azListAll, azRequest, type AzRequestOptions, AzureRequestError } from './az-http';
import { getSubscriptionCredential } from './az-token';

const RESOURCE_GRAPH_API_VERSION = '2022-10-01';
const TENANTS_API_VERSION = '2022-12-01';
const PAGE_SIZE = 1000;
const MAX_PAGES = 100; // 100,000 rows.

/** Request options passed through to every Resource Graph request. */
export type ResourceGraphRequestOptions = Pick<
  AzRequestOptions,
  'tenantId' | 'credential' | 'signal'
>;

interface ResourceGraphPage<T> {
  data?: T[];
  $skipToken?: string;
  resultTruncated?: 'true' | 'false';
}

/**
 * Runs a Resource Graph query and returns every row, following `$skipToken` pages.
 *
 * @param query - KQL query, sent as-is.
 * @param subscriptions - Subscriptions to search. Omit to search the token's whole tenant.
 * @param options - Tenant, credential, or abort signal for the requests.
 * @throws When a request fails, or results are truncated and cannot be paged.
 */
export async function queryResourceGraph<T>(
  query: string,
  subscriptions?: string[],
  options: ResourceGraphRequestOptions = {}
): Promise<T[]> {
  const rows: T[] = [];
  let skipToken: string | undefined;
  const { endpoint, scope } = await getAzureCloudEndpoints(undefined, options.signal);

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await azRequest<ResourceGraphPage<T>>({
      ...options,
      // Use a token from the subscription's own tenant, which may not be the CLI default's.
      credential:
        options.credential ??
        (subscriptions?.length === 1 ? getSubscriptionCredential(subscriptions[0]) : undefined),
      endpoint,
      scope,
      url: '/providers/Microsoft.ResourceGraph/resources',
      method: 'POST',
      apiVersion: RESOURCE_GRAPH_API_VERSION,
      // Queries are read-only, so retrying on throttling or network errors is safe.
      maxRetries: 3,
      body: {
        ...(subscriptions && { subscriptions }),
        query,
        options: {
          resultFormat: 'objectArray',
          $top: PAGE_SIZE,
          ...(skipToken && { $skipToken: skipToken }),
        },
      },
    });
    if (result?.data !== undefined && !Array.isArray(result.data)) {
      throw new AzureRequestError('Malformed Resource Graph response: `data` is not an array');
    }
    rows.push(...(result?.data ?? []));

    skipToken = result?.$skipToken;
    if (!skipToken) {
      // No more pages. If Azure still marks the results as truncated, the rest can't be fetched.
      if (result?.resultTruncated === 'true') {
        throw new AzureRequestError('Resource Graph results were truncated');
      }
      return rows;
    }
  }
  throw new AzureRequestError(`Resource Graph results exceeded ${MAX_PAGES} pages`);
}

/**
 * Resolves a cluster's resource group from Azure Resource Graph.
 *
 * @param clusterType - Restricts the lookup to one provider. Names are unique per
 *   type and resource group, so a managed AKS cluster and an Arc-connected one can
 *   legally share a name; without this the answer would be whichever row came
 *   back first, and the caller could be handed the other resource's group. When
 *   the kind is unknown the lookup still searches both, but reports nothing rather
 *   than guessing if the name is ambiguous.
 * @returns The resource group, or `null` when it is not found, ambiguous, or the query fails.
 */
export async function getClusterResourceGroupViaGraph(
  clusterName: string,
  subscription: string,
  clusterType?: 'aks' | 'aksarc'
): Promise<string | null> {
  if (!subscription || !isValidGuid(subscription)) {
    debugLog('Resource Graph: Missing or invalid subscription ID');
    return null;
  }

  // Sanitize clusterName: allow only alphanumeric, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
    debugLog('Resource Graph: Invalid cluster name format');
    return null;
  }

  // Both cluster kinds are looked up here. An AKS Hybrid & Edge cluster is a
  // `microsoft.kubernetes/connectedclusters` resource and would otherwise never
  // resolve, leaving callers without the resource group they need to reach any
  // Azure API for it (metrics, capabilities, role assignments).
  const typeFilter =
    clusterType === 'aksarc'
      ? "type == 'microsoft.kubernetes/connectedclusters'"
      : clusterType === 'aks'
      ? "type == 'microsoft.containerservice/managedclusters'"
      : "type in ('microsoft.containerservice/managedclusters', 'microsoft.kubernetes/connectedclusters')";

  // Deduplicate before limiting: managed and Arc resources can produce
  // multiple rows in one group, which must not hide a match in another group.
  // Two distinct groups are enough for the ambiguity check below.
  const query = `
    Resources
    | where ${typeFilter}
    | where name == '${clusterName}'
    | summarize by resourceGroup
    | limit 2
  `;

  try {
    const rows = await queryResourceGraph<{ resourceGroup?: string }>(query, [subscription]);
    const groups = [...new Set(rows.map(row => row.resourceGroup).filter(Boolean))];

    if (groups.length > 1) {
      // The name exists as more than one resource. Answering with either would
      // point the caller at the wrong cluster's resource group.
      debugLog(
        'Resource Graph: cluster name is ambiguous across resource groups/types:',
        groups.join(', ')
      );
      return null;
    }

    debugLog('Resource Graph: resource group lookup result:', groups[0] ?? '(none)');
    return groups[0] ?? null;
  } catch (error) {
    debugLog('Resource Graph error:', getErrorMessage(error));
    return null;
  }
}

/**
 * Lists the managed AKS clusters in a subscription, with node counts summed across pools.
 *
 * @param filterAad - Only return clusters with Microsoft Entra ID (AAD) integration.
 * @throws When the subscription ID is invalid or the query fails.
 */
export async function getClustersViaGraph(
  subscriptionId: string,
  filterAad: boolean = false
): Promise<any[]> {
  if (!isValidGuid(subscriptionId)) {
    throw new Error('Invalid subscription ID format');
  }

  const aadFilter = filterAad ? '| where isnotnull(properties.aadProfile)' : '';

  // `id` is kept in the summarize so Resource Graph can page past 1,000 clusters.
  const query = `
    Resources
    | where type =~ 'microsoft.containerservice/managedclusters'
    | where subscriptionId == '${subscriptionId}'
    ${aadFilter}
    | extend agentPools = properties.agentPoolProfiles
    | mv-expand agentPools
    | extend poolNodeCount = toint(agentPools['count'])
    | summarize
        nodeCount = sum(poolNodeCount)
      by
        id,
        name,
        resourceGroup,
        location,
        version = tostring(properties.kubernetesVersion),
        status = tostring(properties.provisioningState),
        powerState = tostring(properties.powerState.code),
        azureRbacEnabled = tobool(properties.aadProfile.enableAzureRbac)
    | order by name asc, id asc
  `;

  const clusters = await queryResourceGraph<any>(query, [subscriptionId]);

  return clusters.map((cluster: any) => ({
    name: cluster.name,
    subscription: subscriptionId,
    resourceGroup: cluster.resourceGroup,
    location: cluster.location,
    version: cluster.version,
    status: cluster.status,
    powerState: cluster.powerState || 'Unknown',
    nodeCount: cluster.nodeCount || 0,
    aadProfile:
      typeof cluster.azureRbacEnabled === 'boolean'
        ? { enableAzureRbac: cluster.azureRbacEnabled }
        : undefined,
  }));
}

/**
 * Counts the managed AKS clusters in a subscription.
 *
 * @returns The count, or `-1` when the subscription ID is invalid or the query fails.
 */
export async function getClusterCount(subscriptionId: string): Promise<number> {
  // Validate subscriptionId is a GUID to prevent KQL injection
  if (!isValidGuid(subscriptionId)) {
    console.error('Invalid subscription ID format:', subscriptionId);
    return -1;
  }

  const query = `Resources | where type =~ 'microsoft.containerservice/managedclusters' | where subscriptionId == '${subscriptionId}' | count`;
  try {
    const [row] = await queryResourceGraph<{ Count?: number; count_?: number }>(query, [
      subscriptionId,
    ]);
    return row?.Count ?? row?.count_ ?? -1;
  } catch (error) {
    console.error('Failed to get cluster count:', getErrorMessage(error));
    return -1;
  }
}

/** A managed namespace row from Resource Graph. */
export interface ManagedNamespaceRow {
  id: string;
  /** `clusterName/namespaceName`. */
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  labels: Record<string, string> | null;
  provisioningState: string;
}

/**
 * Lists AKS managed namespaces in every tenant the account belongs to.
 * Each tenant is queried with its own token; tenants that fail are skipped.
 *
 * @param signal - Cancels the requests.
 * @returns The namespaces found, and one message per tenant that failed.
 * @throws When tenants cannot be listed or every tenant fails.
 */
export async function getManagedNamespacesViaGraph(
  signal?: AbortSignal
): Promise<{ namespaces: ManagedNamespaceRow[]; errors: string[] }> {
  const query = `resources | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces' | project id, name, resourceGroup, subscriptionId, labels=properties['labels'], provisioningState=properties['provisioningState'] | order by id asc`;

  const { endpoint, scope } = await getAzureCloudEndpoints(undefined, signal);
  const tenants = await azListAll<{ tenantId: string }>({
    endpoint,
    scope,
    url: '/tenants',
    apiVersion: TENANTS_API_VERSION,
    signal,
  });
  const results = await Promise.allSettled(
    tenants.map(({ tenantId }) =>
      queryResourceGraph<ManagedNamespaceRow>(query, undefined, { tenantId, signal })
    )
  );

  const namespaces = new Map<string, ManagedNamespaceRow>();
  const errors: string[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      errors.push(`Tenant ${tenants[index].tenantId}: ${getErrorMessage(result.reason)}`);
      continue;
    }
    // The same subscription can show up under more than one tenant, so keying by ID removes duplicates.
    for (const row of result.value) {
      namespaces.set(row.id.toLowerCase(), row);
    }
  }

  if (errors.length > 0 && errors.length === tenants.length) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return { namespaces: [...namespaces.values()], errors };
}
