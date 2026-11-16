// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { getLoginStatus } from './az-auth';
import { debugLog, getErrorMessage, isAzError, needsRelogin, runCommandAsync } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import { azListAll } from './az-http';
import { type AksClusterReadOptions, getManagedClusterDetails } from './az-managed-clusters';
import { getClusterResourceGroupViaGraph, getClustersViaGraph } from './az-resource-graph';
import { getSubscriptions } from './az-subscriptions';
import { AzTokenError, getSubscriptionCredential } from './az-token';

/** Fields consumed from ARM managedClusters lists; CLI responses flatten properties. */
interface ManagedClusterResource {
  id?: string;
  name?: string;
  location?: string;
  properties?: {
    kubernetesVersion?: string;
    provisioningState?: string;
    powerState?: { code?: string } | null;
    aadProfile?: { enableAzureRBAC?: boolean; [key: string]: unknown } | null;
    agentPoolProfiles?: { count?: number; vmSize?: string }[] | null;
  } | null;
}

async function listManagedClusters(
  subscriptionId: string,
  tenantId?: string
): Promise<ManagedClusterResource[]> {
  const credential = getSubscriptionCredential(subscriptionId);
  const { endpoint, scope } = await getAzureCloudEndpoints();
  return azListAll<ManagedClusterResource>({
    endpoint,
    scope,
    credential,
    tenantId,
    url: `/subscriptions/${encodeURIComponent(
      subscriptionId
    )}/providers/Microsoft.ContainerService/managedClusters`,
    apiVersion: '2026-01-01',
  });
}

function managedClusterSummary(
  cluster: ManagedClusterResource,
  subscription: string,
  allSubscriptions = false
) {
  const properties = cluster.properties ?? {};
  const { enableAzureRBAC, ...aadProfile } = properties.aadProfile ?? {};
  return {
    name: cluster.name,
    subscription,
    resourceGroup: resourceGroupFromId(cluster.id),
    location: cluster.location,
    version: properties.kubernetesVersion,
    status: properties.provisioningState,
    powerState: properties.powerState?.code || 'Unknown',
    nodeCount: properties.agentPoolProfiles?.reduce((sum, pool) => sum + (pool.count || 0), 0) || 0,
    // Preserve the existing per-path summary shapes and CLI-facing AAD casing.
    ...(allSubscriptions
      ? { id: cluster.id, vmSize: properties.agentPoolProfiles?.[0]?.vmSize || '' }
      : {
          aadProfile: properties.aadProfile && { ...aadProfile, enableAzureRbac: enableAzureRBAC },
        }),
  };
}

export async function getClusters(subscriptionId?: string, query?: string): Promise<any[]> {
  if (subscriptionId) {
    const filterAad = query?.includes('aadProfile');
    try {
      return await getClustersViaGraph(subscriptionId, filterAad);
    } catch (graphError) {
      console.warn('Resource Graph query failed, falling back to ARM REST:', graphError);
    }
    return (await listManagedClusters(subscriptionId))
      .filter(cluster => !filterAad || Boolean(cluster.properties?.aadProfile))
      .map(cluster => managedClusterSummary(cluster, subscriptionId));
  }

  const clusters: any[] = [];
  for (const sub of await getSubscriptions()) {
    try {
      const resources = await listManagedClusters(sub.id, sub.tenant);
      clusters.push(...resources.map(cluster => managedClusterSummary(cluster, sub.id, true)));
    } catch (error) {
      // Keep reachable inventory, but do not present a failed subscription as successfully empty.
      console.warn(
        `Could not list AKS clusters for subscription ${sub.id}:`,
        getErrorMessage(error)
      );
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
    const account = await getLoginStatus();
    const accountError = account.error ?? '';
    if (!account.isLoggedIn) {
      if (
        /InteractionRequired|interaction_required|multi-factor authentication|AADSTS50076/.test(
          accountError
        )
      ) {
        throw new Error(
          'Your Azure session requires re-authentication. Please run "az login" to sign in again.'
        );
      }
      if (accountError.includes('No subscriptions found')) {
        throw new Error(
          'No Azure subscriptions found. Please run "az login" to sign in with an account that has active subscriptions.'
        );
      }
      return result;
    }
    result.subscriptionId = account.subscriptionId;

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

      // Prefer Resource Graph; a missing/ambiguous group also falls through to ARM.
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
        debugLog('Resource Graph failed, falling back to ARM REST:', graphError);
      }

      result.clusterName = clusterName;
      try {
        const clusters = await listManagedClusters(result.subscriptionId, account.tenantId);
        const cluster = clusters.find(cluster => cluster.name === clusterName);
        if (cluster) {
          result.resourceGroup = resourceGroupFromId(cluster.id);
        } else {
          console.warn(`Cluster ${clusterName} not found in subscription ${result.subscriptionId}`);
        }
      } catch (error) {
        console.warn(`Could not get cluster info for ${clusterName}:`, getErrorMessage(error));
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
        const [cluster] = await listManagedClusters(result.subscriptionId, account.tenantId);
        if (cluster) {
          result.clusterName = cluster.name;
          result.resourceGroup = resourceGroupFromId(cluster.id);
          debugLog('Using first available cluster:', result);
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
  try {
    const clusters = await listManagedClusters(subscription);
    const cluster = clusters.find(cluster => cluster.name === clusterName);
    if (!cluster?.id) return null;
    return { resourceId: cluster.id, resourceGroup: resourceGroupFromId(cluster.id) };
  } catch (error) {
    if (error instanceof AzTokenError && error.needsRelogin) {
      throw new Error('Authentication required. Please log in to Azure CLI: az login');
    }
    throw error;
  }
}
