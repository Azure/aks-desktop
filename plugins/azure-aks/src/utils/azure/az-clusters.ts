// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import type { ManagedCluster } from '@azure/arm-containerservice';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { azureCredential } from '../../azureAuth';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { debugLog, getErrorMessage } from './az-helpers';
import { getClusterResourceGroupViaGraph, getClustersViaGraph } from './az-resource-graph';

/**
 * Lists AKS clusters via Azure Resource Graph. With a subscription id it
 * queries that subscription; without one it iterates all subscriptions.
 */
export async function getClusters(subscriptionId: string, query?: string): Promise<any[]> {
  const filterAad = query?.includes('aadProfile');
  return getClustersViaGraph(subscriptionId, filterAad);
}

export async function getClusterCapabilities(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
}): Promise<ClusterCapabilities> {
  const { subscriptionId, resourceGroup, clusterName } = options;

  try {
    const client = new ContainerServiceClient(azureCredential, subscriptionId);
    const cluster = await client.managedClusters.get(resourceGroup, clusterName);

    const aadProfile = cluster.aadProfile;
    return {
      sku: (cluster.sku?.name as ClusterCapabilities['sku']) || null,
      aadEnabled: aadProfile !== null && aadProfile !== undefined,
      azureRbacEnabled: aadProfile?.enableAzureRbac ?? null,
      networkPolicy:
        (cluster.networkProfile?.networkPolicy as ClusterCapabilities['networkPolicy']) || 'none',
      networkPlugin:
        (cluster.networkProfile?.networkPlugin as ClusterCapabilities['networkPlugin']) || null,
      prometheusEnabled: cluster.azureMonitorProfile?.metrics?.enabled ?? null,
      containerInsightsEnabled: cluster.addonProfiles?.omsagent?.enabled ?? null,
      kedaEnabled: cluster.workloadAutoScalerProfile?.keda?.enabled ?? null,
      vpaEnabled: cluster.workloadAutoScalerProfile?.verticalPodAutoscaler?.enabled ?? null,
      location: typeof cluster.location === 'string' ? cluster.location : null,
      tier: typeof cluster.sku?.tier === 'string' ? cluster.sku.tier : null,
      kubernetesVersion:
        typeof cluster.kubernetesVersion === 'string' ? cluster.kubernetesVersion : null,
    };
  } catch (error) {
    console.error('Failed to get cluster capabilities:', error);
    throw new Error(`Failed to get cluster capabilities: ${getErrorMessage(error)}`);
  }
}

export type AddonKey = 'azure-monitor-metrics' | 'keda' | 'vpa';

const ADDON_KEYS: AddonKey[] = ['azure-monitor-metrics', 'keda', 'vpa'];

/**
 * Mutates a managed cluster object in place to enable the requested addon.
 */
function applyAddon(cluster: ManagedCluster, addon: AddonKey): void {
  if (addon === 'azure-monitor-metrics') {
    cluster.azureMonitorProfile = {
      ...cluster.azureMonitorProfile,
      metrics: { ...cluster.azureMonitorProfile?.metrics, enabled: true },
    };
  } else if (addon === 'keda') {
    cluster.workloadAutoScalerProfile = {
      ...cluster.workloadAutoScalerProfile,
      keda: { enabled: true },
    };
  } else if (addon === 'vpa') {
    cluster.workloadAutoScalerProfile = {
      ...cluster.workloadAutoScalerProfile,
      verticalPodAutoscaler: { enabled: true },
    };
  }
}

/** Enables one or more cluster addons. Does not wait for the update to finish. */
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

  for (const a of addons) {
    if (!ADDON_KEYS.includes(a)) {
      return { success: false, error: `Unknown addon: ${a}` };
    }
  }

  try {
    const client = new ContainerServiceClient(azureCredential, subscriptionId);
    const cluster = await client.managedClusters.get(resourceGroup, clusterName);

    for (const a of addons) {
      applyAddon(cluster, a);
    }

    // Fire-and-forget: start the update but do not await completion (CLI used --no-wait).
    await client.managedClusters.beginCreateOrUpdate(resourceGroup, clusterName, cluster);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to enable addons (${addons.join(', ')}): ${getErrorMessage(error)}`,
    };
  }
}

export async function getClusterResourceIdAndGroup(
  clusterName: string,
  subscription: string
): Promise<{ resourceId: string; resourceGroup: string } | null> {
  if (!clusterName) return null;
  debugLog('cluster name:', clusterName, 'subscription:', subscription);

  try {
    const client = new ContainerServiceClient(azureCredential, subscription);
    const cluster = await client.managedClusters.get(
      await resolveResourceGroup(clusterName, subscription),
      clusterName
    );

    const resourceId: string = cluster.id || '';
    const resourceGroup: string = extractResourceGroup(resourceId);

    if (!resourceId) return null;
    return { resourceId, resourceGroup: resourceGroup || '' };
  } catch (error) {
    debugLog('getClusterResourceIdAndGroup error:', error);
    throw new Error(`Failed to get AKS cluster: ${getErrorMessage(error)}`);
  }
}

/** Resolves the resource group for a cluster via Resource Graph. */
async function resolveResourceGroup(clusterName: string, subscription: string): Promise<string> {
  const resourceGroup = await getClusterResourceGroupViaGraph(clusterName, subscription);
  if (!resourceGroup) {
    throw new Error(`Cluster '${clusterName}' not found in subscription`);
  }
  return resourceGroup;
}

/** Extracts the resource group segment from an ARM resource id. */
function extractResourceGroup(resourceId: string): string {
  const match = resourceId.match(/\/resourceGroups\/([^/]+)\//i);
  return match && match[1] ? match[1] : '';
}
