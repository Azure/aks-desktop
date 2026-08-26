// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { debugLog, isAzError, isValidGuid, needsRelogin, runCommandAsync } from './az-cli-core';

/**
 * Resolves a cluster's resource group from Azure Resource Graph.
 *
 * @param clusterType - Restricts the lookup to one provider. Names are unique per
 *   type and resource group, so a managed AKS cluster and an Arc-connected one can
 *   legally share a name; without this the answer would be whichever row came
 *   back first, and the caller could be handed the other resource's group. When
 *   the kind is unknown the lookup still searches both, but reports nothing rather
 *   than guessing if the name is ambiguous.
 */
export async function getClusterResourceGroupViaGraph(
  clusterName: string,
  subscription: string,
  clusterType?: 'aks' | 'aksarc'
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

    const { stdout, stderr } = await runCommandAsync('az', [
      'graph',
      'query',
      '-q',
      query,
      '--output',
      'json',
      '--subscription',
      subscription,
    ]);

    if (stderr) {
      debugLog(stderr);
    }

    if (stderr && needsRelogin(stderr)) {
      debugLog('Resource Graph: Authentication required');
      return null;
    }

    if (stderr && isAzError(stderr)) {
      debugLog('Resource Graph query failed:', stderr);
      return null;
    }

    try {
      const result = JSON.parse(stdout);
      const rows: Array<{ resourceGroup?: string }> = result.data ?? [];
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

      const resourceGroup = groups[0];

      if (resourceGroup) {
        debugLog('Resource Graph: Found resource group:', resourceGroup);
        return resourceGroup;
      }

      debugLog('Resource Graph: No results');
      return null;
    } catch (parseError) {
      debugLog('Resource Graph: Parse error:', parseError);
      return null;
    }
  } catch (error) {
    debugLog('Resource Graph error:', error);
    return null;
  }
}

/**
 * Fetches a single page of AKS clusters from Azure Resource Graph.
 *
 * The Resource Graph query returns at most 1000 results per call with --first 1000. (Maximum)
 * If more results exist, the raw response includes a `skip_token` cursor that can
 * be used to fetch the next page of results. This function returns both the clusters and
 * a `skipToken` (mapped from the raw `skip_token` field) when pagination is required to
 * fetch all clusters in larger subscriptions.
 *
 * @param query - Azure Resource Graph query to execute.
 * @param skipToken - Pagination token from a previous call to fetch the next page.
 * @returns The cluster records and an optional `skipToken` for the next page.
 */
async function fetchGraphPage(
  query: string,
  skipToken?: string
): Promise<{ clusters: any[]; skipToken?: string }> {
  const pageSize = '1000';
  const args = ['graph', 'query', '-q', query, '--first', pageSize, '--output', 'json'];
  // Append skip token for pagination if provided
  if (skipToken) {
    args.push('--skip-token', skipToken);
  }

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    throw new Error(`Resource Graph query failed: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    const clusters = result.data || [];

    return { clusters, skipToken: result.skip_token };
  } catch (parseError: unknown) {
    const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    const stdoutPreview = stdout.length > 500 ? stdout.slice(0, 500) + '…' : stdout;
    throw new Error(
      `Failed to parse Resource Graph query response: ${parseErrorMessage}. ` +
        `Stdout length=${stdout.length}, preview=${JSON.stringify(stdoutPreview)}`
    );
  }
}

export async function getClustersViaGraph(
  subscriptionId: string,
  filterAad: boolean = false
): Promise<any[]> {
  if (!isValidGuid(subscriptionId)) {
    throw new Error('Invalid subscription ID format');
  }

  const aadFilter = filterAad ? '| where isnotnull(properties.aadProfile)' : '';

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
        name,
        resourceGroup,
        location,
        version = tostring(properties.kubernetesVersion),
        status = tostring(properties.provisioningState),
        powerState = tostring(properties.powerState.code),
        azureRbacEnabled = tobool(properties.aadProfile.enableAzureRbac)
    | order by name asc
  `;

  // Fetch first page
  let page = await fetchGraphPage(query);
  const allClusters = [...page.clusters];

  // Fetch remaining pages if the subscription has more clusters than one page holds.
  // The Resource Graph response includes a `skipToken` only when more pages exist;
  // on the final page it is null/absent, which will terminate the loop.
  const MAX_PAGES = 100; // 100,000 cluster limit.
  let pageCount = 1;
  while (page.skipToken && pageCount < MAX_PAGES) {
    page = await fetchGraphPage(query, page.skipToken);
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
    aadProfile:
      typeof cluster.azureRbacEnabled === 'boolean'
        ? { enableAzureRbac: cluster.azureRbacEnabled }
        : undefined,
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
    const { stdout, stderr } = await runCommandAsync('az', [
      'graph',
      'query',
      '-q',
      query,
      '--output',
      'json',
    ]);

    if (stderr && isAzError(stderr)) {
      console.error('getClusterCount: Azure CLI error:', stderr);
      return -1;
    }

    try {
      const result = JSON.parse(stdout);
      return result.data?.[0]?.Count ?? result.data?.[0]?.count_ ?? -1;
    } catch (parseError) {
      console.error('getClusterCount: Failed to parse response:', parseError);
      return -1;
    }
  } catch (error) {
    console.error('Failed to get cluster count:', error);
    return -1;
  }
}
