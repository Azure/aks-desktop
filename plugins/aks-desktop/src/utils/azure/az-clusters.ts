// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { debugLog, getErrorMessage, isAzError, needsRelogin, runCommandAsync } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import { azListAll } from './az-http';
import { type AksClusterReadOptions, getManagedClusterDetails } from './az-managed-clusters';
import { getClusterResourceGroupViaGraph, getClustersViaGraph } from './az-resource-graph';
import { getSubscriptions } from './az-subscriptions';
import { getSubscriptionCredential } from './az-token';

export async function getClusters(subscriptionId?: string, query?: string): Promise<any[]> {
  const clusters: any[] = [];

  if (subscriptionId) {
    // Try Azure Resource Graph first (10x faster than az aks list)
    try {
      const filterAad = query?.includes('aadProfile');
      const graphClusters = await getClustersViaGraph(subscriptionId, filterAad);
      return graphClusters;
    } catch (graphError) {
      console.warn('Resource Graph query failed, falling back to az aks list:', graphError);
    }

    // Fallback to az aks list
    const command = ['aks', 'list', '--subscription', subscriptionId];

    // Add query parameter if provided
    if (query) {
      command.push('--query', query);
    }

    // Always add JSON output format
    command.push('-o', 'json');

    const { stdout, stderr } = await runCommandAsync('az', command);

    if (stderr) {
      // Check if stderr contains only warnings (not actual errors)
      const isWarningOnly =
        stderr.includes('WARNING:') &&
        !isAzError(stderr) &&
        !stderr.includes('error:') &&
        !stderr.includes('failed') &&
        !stderr.includes('Failed');

      if (!isWarningOnly) {
        throw new Error(stderr);
      }
      // If it's just warnings, continue processing stdout
    }
    if (stdout) {
      const parsed = JSON.parse(stdout);
      parsed.forEach((cluster: any) => {
        clusters.push({
          name: cluster.name,
          subscription: subscriptionId,
          resourceGroup: cluster.resourceGroup,
          location: cluster.location,
          version: cluster.kubernetesVersion,
          status: cluster.provisioningState,
          aadProfile: cluster.aadProfile,
          powerState: cluster.powerState?.code || 'Unknown',
          nodeCount:
            cluster.agentPoolProfiles?.reduce(
              (acc: number, pool: any) => acc + (pool.count || 0),
              0
            ) || 0,
        });
      });
    }
  } else {
    // Fetch clusters from all subscriptions (original behavior)
    const subs = await getSubscriptions();

    for (const sub of subs) {
      const { stdout } = await runCommandAsync('az', [
        'aks',
        'list',
        '--subscription',
        sub.id,
        '-o',
        'json',
      ]);
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          parsed.forEach((cluster: any) => {
            clusters.push({
              id: cluster.id,
              name: cluster.name,
              subscription: sub.id,
              resourceGroup: cluster.resourceGroup,
              location: cluster.location,
              version: cluster.kubernetesVersion,
              status: cluster.provisioningState,
              powerState: cluster.powerState?.code || 'Unknown',
              nodeCount:
                cluster.agentPoolProfiles?.reduce(
                  (acc: number, pool: any) => acc + (pool.count || 0),
                  0
                ) || 0,
              vmSize: cluster.agentPoolProfiles?.[0]?.vmSize || '',
            });
          });
        } catch (parseError) {
          console.warn(`Failed to parse AKS cluster list for subscription ${sub.id}:`, parseError);
        }
      }
    }
  }
  return clusters;
}

/** API version for listing `Microsoft.Kubernetes/connectedClusters`. */
const CONNECTED_CLUSTERS_API_VERSION = '2024-01-01';

/** The fields read from an ARM `Microsoft.Kubernetes/connectedClusters` resource. */
interface ConnectedClusterResource {
  id?: string;
  name?: string;
  location?: string;
  kind?: string | null;
  properties?: {
    kubernetesVersion?: string;
    agentVersion?: string;
    provisioningState?: string;
    connectivityStatus?: string;
    distribution?: string;
    aadProfile?: { enableAzureRBAC?: boolean };
  };
}

/** An AKS Hybrid & Edge cluster found in a subscription. */
export interface ConnectedClusterSummary {
  name: string;
  subscription: string;
  resourceGroup: string;
  location: string;
  version: string;
  status: string;
  powerState: string;
  /** Arc agent heartbeat status, such as `Connected`, `Offline` or `Expired`. */
  connectivityStatus: string;
  nodeCount: number;
  clusterType: 'aksarc';
  /** `true` when the cluster uses Azure RBAC, `false` when it uses Kubernetes RBAC. */
  azureRbacEnabled: boolean;
}

/** The AKS Hybrid & Edge clusters found in a subscription, and why listing failed if it did. */
export interface ConnectedClusterDiscovery {
  clusters: ConnectedClusterSummary[];
  /** The Azure error message when the clusters could not be listed. */
  error?: string;
}

/**
 * Reads the resource group name from an ARM resource ID.
 * @param id - ARM resource ID, such as `/subscriptions/{sub}/resourceGroups/{rg}/providers/...`.
 * @returns The resource group name, or an empty string when the ID has none.
 */
function resourceGroupFromId(id: string | undefined): string {
  return /\/resourceGroups\/([^/]+)/i.exec(id ?? '')?.[1] ?? '';
}

/**
 * Lists the AKS Hybrid & Edge (AKS Arc) clusters in a subscription through ARM REST.
 *
 * Only connected clusters with `kind: "ProvisionedCluster"` are returned; other
 * Arc-enabled Kubernetes clusters are skipped. This function never throws, so a
 * failure here cannot stop managed AKS clusters from being listed.
 *
 * @param subscriptionId - Azure subscription GUID to query.
 * @returns The clusters found, plus the error message if the request failed.
 */
export async function getConnectedClusters(
  subscriptionId: string
): Promise<ConnectedClusterDiscovery> {
  let resources: ConnectedClusterResource[];
  try {
    const { endpoint, scope } = await getAzureCloudEndpoints();
    resources = await azListAll<ConnectedClusterResource>({
      endpoint,
      scope,
      url: `/subscriptions/${encodeURIComponent(
        subscriptionId
      )}/providers/Microsoft.Kubernetes/connectedClusters`,
      apiVersion: CONNECTED_CLUSTERS_API_VERSION,
      credential: getSubscriptionCredential(subscriptionId),
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.warn('Could not list AKS Hybrid & Edge clusters:', message);
    return { clusters: [], error: message };
  }

  const clusters: ConnectedClusterSummary[] = [];
  for (const resource of resources) {
    // Generic Arc-connected clusters have no `ProvisionedCluster` kind and are not AKS clusters.
    if (resource?.kind !== 'ProvisionedCluster') {
      debugLog(
        'Skipping non-AKS-Arc connected cluster:',
        resource?.name,
        `(kind=${resource?.kind ?? 'null'}, distribution=${
          resource?.properties?.distribution ?? ''
        })`
      );
      continue;
    }
    const properties = resource.properties ?? {};
    clusters.push({
      name: resource.name ?? '',
      subscription: subscriptionId,
      resourceGroup: resourceGroupFromId(resource.id),
      location: resource.location ?? '',
      version: properties.kubernetesVersion || properties.agentVersion || '',
      status: properties.provisioningState || properties.connectivityStatus || 'Unknown',
      powerState: properties.connectivityStatus || 'Unknown',
      connectivityStatus: properties.connectivityStatus || 'Unknown',
      nodeCount: 0,
      clusterType: 'aksarc',
      azureRbacEnabled: properties.aadProfile?.enableAzureRBAC === true,
    });
  }

  return { clusters };
}

/**
 * @param options - Managed AKS coordinates and shared REST/authentication overrides.
 * @returns Observed provisioning, power and version values with Unknown fallbacks.
 * ready is true only for the pair Succeeded/Running, never provisioning alone.
 * @throws Propagated detail-read, credential or cancellation failures.
 */
export async function getAksClusterStatus(options: AksClusterReadOptions): Promise<{
  /** ARM provisioning state, or Unknown when missing/empty. */
  provisioningState: string;
  /** Observed power code, or Unknown when missing/empty. */
  powerState: string;
  /** ARM Kubernetes version, or Unknown when missing/empty. */
  kubernetesVersion: string;
  /** Whether both provisioning and power permit using the cluster. */
  ready: boolean;
}> {
  const { properties } = await getManagedClusterDetails(options);
  const provisioningState = properties.provisioningState || 'Unknown';
  const powerState = properties.powerState?.code || 'Unknown';
  return {
    provisioningState,
    powerState,
    kubernetesVersion: properties.kubernetesVersion || 'Unknown',
    ready: provisioningState === 'Succeeded' && powerState === 'Running',
  };
}

/**
 * @param options - Managed AKS coordinates and shared REST/authentication overrides.
 * @returns UI capabilities projected from nested ARM profiles. False flags stay
 * false; missing feature flags become null, missing AAD profile means aadEnabled=false,
 * and missing/empty networkPolicy becomes none. SKU remains top-level metadata.
 * @throws Propagated detail-read, credential or cancellation failures.
 */
export async function getClusterCapabilities(
  options: AksClusterReadOptions
): Promise<ClusterCapabilities> {
  const { properties, sku, location } = await getManagedClusterDetails(options);
  return {
    sku: sku?.name || null,
    tier: typeof sku?.tier === 'string' ? sku.tier : null,
    location: typeof location === 'string' ? location : null,
    kubernetesVersion:
      typeof properties.kubernetesVersion === 'string' ? properties.kubernetesVersion : null,
    aadEnabled: properties.aadProfile !== null && properties.aadProfile !== undefined,
    azureRbacEnabled: properties.aadProfile?.enableAzureRBAC ?? null,
    networkPolicy: properties.networkProfile?.networkPolicy || 'none',
    networkPlugin: properties.networkProfile?.networkPlugin || null,
    prometheusEnabled: properties.azureMonitorProfile?.metrics?.enabled ?? null,
    containerInsightsEnabled: properties.addonProfiles?.omsagent?.enabled ?? null,
    kedaEnabled: properties.workloadAutoScalerProfile?.keda?.enabled ?? null,
    vpaEnabled: properties.workloadAutoScalerProfile?.verticalPodAutoscaler?.enabled ?? null,
  };
}

export type AddonKey = 'azure-monitor-metrics' | 'keda' | 'vpa';

// Enable one or more cluster addons in a single az aks update command
export async function enableClusterAddon(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  addon: AddonKey | AddonKey[];
}): Promise<{ success: boolean; error?: string }> {
  const { subscriptionId, resourceGroup, clusterName, addon } = options;

  const addons = Array.isArray(addon) ? addon : [addon];

  if (addons.length === 0) {
    return { success: false, error: 'No addons specified' };
  }

  const addonFlags: Partial<Record<AddonKey, string[]>> = {
    'azure-monitor-metrics': ['--enable-azure-monitor-metrics'],
    keda: ['--enable-keda'],
    vpa: ['--enable-vpa'],
  };

  const flags: string[] = [];
  for (const a of addons) {
    const f = addonFlags[a];
    if (!f) {
      return { success: false, error: `Unknown addon: ${a}` };
    }
    flags.push(...f);
  }

  const args = [
    'aks',
    'update',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
    ...flags,
    '--no-wait',
  ];

  const { stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    return { success: false, error: 'Authentication required. Please log in to Azure CLI.' };
  }

  if (stderr && isAzError(stderr)) {
    return { success: false, error: `Failed to enable addons (${addons.join(', ')}): ${stderr}` };
  }

  return { success: true };
}

export async function getClusterInfo(clusterName?: string): Promise<{
  clusterName?: string;
  resourceGroup?: string;
  subscriptionId?: string;
}> {
  const result: {
    clusterName?: string;
    resourceGroup?: string;
    subscriptionId?: string;
  } = {};

  try {
    // First get the current subscription
    const { stdout: accountStdout, stderr: accountStderr } = await runCommandAsync('az', [
      'account',
      'show',
      '--output',
      'json',
    ]);

    if (accountStderr && !accountStdout) {
      const isInteractionRequired =
        accountStderr.includes('InteractionRequired') ||
        accountStderr.includes('interaction_required') ||
        accountStderr.includes('multi-factor authentication') ||
        accountStderr.includes('AADSTS50076');
      if (isInteractionRequired) {
        throw new Error(
          'Your Azure session requires re-authentication. Please run "az login" to sign in again.'
        );
      }
      if (accountStderr.includes('No subscriptions found')) {
        throw new Error(
          'No Azure subscriptions found. Please run "az login" to sign in with an account that has active subscriptions.'
        );
      }
    }

    if (accountStdout) {
      try {
        const account = JSON.parse(accountStdout);
        result.subscriptionId = account.id;
      } catch (parseError) {
        console.warn('Could not parse Azure account info:', parseError);
      }
    }

    if (!result.subscriptionId) {
      console.warn('No subscription ID found, cannot query cluster info');
      return result;
    }

    // If cluster name is provided, find its resource group
    if (clusterName) {
      // Sanitize clusterName: allow only alphanumeric, hyphens, and underscores
      if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
        console.warn('getClusterInfo: Invalid cluster name format');
        return result;
      }

      // FAST PATH: Try Azure Resource Graph query first (2-3s vs 36s for az aks list)
      try {
        const resourceGroupFromGraph = await getClusterResourceGroupViaGraph(
          clusterName,
          result.subscriptionId
        );

        if (resourceGroupFromGraph) {
          result.clusterName = clusterName;
          result.resourceGroup = resourceGroupFromGraph;
          return result;
        }
      } catch (graphError) {
        debugLog('Resource Graph failed, falling back to az aks list:', graphError);
      }

      // FALLBACK: Use slower az aks list query if Resource Graph fails
      try {
        const { stdout: clusterStdout } = await runCommandAsync('az', [
          'aks',
          'list',
          '--subscription',
          result.subscriptionId,
          '--query',
          `[?name=='${clusterName}'].{name:name,resourceGroup:resourceGroup}`,
          '-o',
          'json',
        ]);

        if (clusterStdout) {
          const clusters = JSON.parse(clusterStdout);
          if (clusters.length > 0) {
            result.clusterName = clusters[0].name;
            result.resourceGroup = clusters[0].resourceGroup;
            debugLog(`Found cluster info for ${clusterName}:`, result);
          } else {
            console.warn(
              `Cluster ${clusterName} not found in subscription ${result.subscriptionId}`
            );
            result.clusterName = clusterName; // Still return the provided name
          }
        }
      } catch (azError) {
        console.warn(`Could not get cluster info for ${clusterName}:`, azError);
        result.clusterName = clusterName; // Still return the provided name
      }
    } else {
      // No cluster name provided, try to get from current kubectl context as fallback
      try {
        const { stdout: contextStdout } = await runCommandAsync('kubectl', [
          'config',
          'current-context',
        ]);
        if (contextStdout && contextStdout.trim()) {
          const contextName = contextStdout.trim();

          // Parse context name to extract cluster name
          if (contextName.includes('_')) {
            // Format: resourcegroup_clustername
            const parts = contextName.split('_');
            const potentialClusterName = parts[1] || parts[0];
            return getClusterInfo(potentialClusterName); // Recursive call with cluster name
          } else {
            // Try using the context name as cluster name
            return getClusterInfo(contextName);
          }
        }
      } catch (kubectlError) {
        console.warn('Could not get current context from kubectl:', kubectlError);
      }

      // If still no cluster name, get the first available cluster
      try {
        const { stdout: clustersStdout } = await runCommandAsync('az', [
          'aks',
          'list',
          '--subscription',
          result.subscriptionId,
          '--query',
          '[].{name:name,resourceGroup:resourceGroup}',
          '-o',
          'json',
        ]);

        if (clustersStdout) {
          const clusters = JSON.parse(clustersStdout);
          if (clusters.length > 0) {
            result.clusterName = clusters[0].name;
            result.resourceGroup = clusters[0].resourceGroup;
            debugLog('Using first available cluster:', result);
          }
        }
      } catch (azError) {
        console.warn('Could not list AKS clusters:', azError);
      }
    }

    debugLog('Cluster info resolved:', result);
    return result;
  } catch (error) {
    console.error('Failed to get cluster info:', error);
    if (
      error instanceof Error &&
      (error.message.includes('re-authentication') ||
        error.message.includes('No Azure subscriptions'))
    ) {
      throw error;
    }
    return result;
  }
}

export async function getClusterResourceIdAndGroup(
  clusterName: string,
  subscription: string
): Promise<{ resourceId: string; resourceGroup: string } | null> {
  if (!clusterName) return null;
  debugLog('cluster name:', clusterName, 'subscription:', subscription);
  const { stdout, stderr } = await runCommandAsync('az', [
    'aks',
    'list',
    '--query',
    `[?name=='${clusterName}']`,
    '-o',
    'json',
    '--subscription',
    subscription,
  ]);

  debugLog('stdout:', stdout);
  debugLog('stderr:', stderr);
  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    throw new Error(`Failed to list AKS clusters: ${stderr}`);
  }

  try {
    const arr = JSON.parse(stdout || '[]');
    if (!Array.isArray(arr) || arr.length === 0) return null;

    const item = arr[0] || {};
    const resourceId: string = item.id || '';
    const resourceGroup: string = item.resourceGroup || resourceGroupFromId(resourceId);

    if (!resourceId) return null;
    return { resourceId, resourceGroup };
  } catch (parseError) {
    debugLog('parseError:', parseError);
    throw new Error('Failed to parse AKS list response');
  }
}
