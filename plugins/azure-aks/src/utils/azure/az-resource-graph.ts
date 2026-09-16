// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { azureCredential } from '../../azureAuth';
import { debugLog, isValidGuid } from './az-helpers';

export async function getClusterResourceGroupViaGraph(
  clusterName: string,
  subscription: string
): Promise<string | null> {
  try {
    if (!subscription || !isValidGuid(subscription)) {
      debugLog('Resource Graph: Missing or invalid subscription ID');
      return null;
    }

    // Sanitize clusterName: allow only alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
      debugLog('Resource Graph: Invalid cluster name format');
      return null;
    }

    const query = `
      Resources
      | where type == 'microsoft.containerservice/managedclusters'
      | where name == '${clusterName}'
      | project resourceGroup
      | limit 1
    `;

    const client = new ResourceGraphClient(azureCredential);
    const result = await client.resources({
      query,
      subscriptions: [subscription],
    });

    const resourceGroup = (result.data as any[])?.[0]?.resourceGroup;

    if (resourceGroup) {
      debugLog('Resource Graph: Found resource group:', resourceGroup);
      return resourceGroup;
    }

    debugLog('Resource Graph: No results');
    return null;
  } catch (error) {
    debugLog('Resource Graph error:', error);
    return null;
  }
}

/**
 * Fetches a single page of AKS clusters from Azure Resource Graph.
 *
 * The Resource Graph query returns at most 1000 results per call. If more
 * results exist, the response includes a `skipToken` cursor that can be used to
 * fetch the next page. This function returns both the clusters and a `skipToken`
 * when pagination is required to fetch all clusters in larger subscriptions.
 *
 * @param query - Azure Resource Graph query to execute.
 * @param subscriptionId - Subscription scope for the query.
 * @param skipToken - Pagination token from a previous call to fetch the next page.
 * @returns The cluster records and an optional `skipToken` for the next page.
 */
async function fetchGraphPage(
  query: string,
  subscriptionId: string | undefined,
  skipToken?: string
): Promise<{ clusters: any[]; skipToken?: string }> {
  const client = new ResourceGraphClient(azureCredential);
  const result = await client.resources({
    query,
    subscriptions: subscriptionId ? [subscriptionId] : undefined,
    options: { resultFormat: 'objectArray', top: 1000, skipToken },
  });

  const clusters = (result.data as any[]) || [];

  return { clusters, skipToken: result.skipToken };
}

export async function getClustersViaGraph(
  subscriptionId: string,
  filterAad: boolean = false
): Promise<any[]> {
  if (subscriptionId && !isValidGuid(subscriptionId)) {
    throw new Error('Invalid subscription ID format');
  }

  const aadFilter = filterAad ? '| where isnotnull(properties.aadProfile)' : '';

  const query = `
    Resources
    | where type =~ 'microsoft.containerservice/managedclusters'
    ${aadFilter}
    | extend agentPools = properties.agentPoolProfiles
    | mv-expand agentPools
    | extend poolNodeCount = toint(agentPools['count'])
    | summarize
        nodeCount = sum(poolNodeCount)
      by
        name,
        resourceGroup,
        location,
        version = tostring(properties.kubernetesVersion),
        status = tostring(properties.provisioningState),
        powerState = tostring(properties.powerState.code)
    | order by name asc
  `;

  // Fetch first page
  let page = await fetchGraphPage(query, subscriptionId);
  const allClusters = [...page.clusters];

  // Fetch remaining pages if the subscription has more clusters than one page holds.
  // The Resource Graph response includes a `skipToken` only when more pages exist;
  // on the final page it is null/absent, which will terminate the loop.
  const MAX_PAGES = 100; // 100,000 cluster limit.
  let pageCount = 1;
  while (page.skipToken && pageCount < MAX_PAGES) {
    page = await fetchGraphPage(query, subscriptionId, page.skipToken);
    allClusters.push(...page.clusters);
    pageCount++;
  }

  if (page.skipToken && pageCount >= MAX_PAGES) {
    debugLog(
      `Resource Graph pagination hit MAX_PAGES limit (${MAX_PAGES}). Results may be truncated.`
    );
  }

  return allClusters.map((cluster: any) => ({
    name: cluster.name,
    subscription: subscriptionId,
    resourceGroup: cluster.resourceGroup,
    location: cluster.location,
    version: cluster.version,
    status: cluster.status,
    powerState: cluster.powerState || 'Unknown',
    nodeCount: cluster.nodeCount || 0,
  }));
}

export async function getClusterCount(subscriptionId: string): Promise<number> {
  try {
    // Validate subscriptionId is a GUID to prevent KQL injection
    if (!isValidGuid(subscriptionId)) {
      console.error('Invalid subscription ID format:', subscriptionId);
      return -1;
    }

    const query = `Resources | where type =~ 'microsoft.containerservice/managedclusters' | where subscriptionId == '${subscriptionId}' | count`;

    const client = new ResourceGraphClient(azureCredential);
    const result = await client.resources({
      query,
      subscriptions: [subscriptionId],
    });

    return (
      (result.data as any[])?.[0]?.Count ??
      (result.data as any[])?.[0]?.count_ ??
      result.totalRecords ??
      -1
    );
  } catch (error) {
    console.error('Failed to get cluster count:', error);
    return -1;
  }
}
