// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { debugLog, isAzError, needsRelogin, runCommandAsync } from './az-cli-core';
import { getClusterResourceGroupViaGraph, getClustersViaGraph } from './az-resource-graph';
import { getSubscriptions } from './az-subscriptions';

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
      let parsed: any[];
      try {
        parsed = JSON.parse(stdout);
      } catch (error) {
        throw new Error(
          `Failed to parse az aks list response: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      if (!Array.isArray(parsed)) {
        throw new Error('Failed to parse az aks list response: expected a JSON array');
      }

      parsed.forEach((cluster: any) => {
        clusters.push({
          name: cluster.name,
          subscription: subscriptionId,
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
          let parsed: any[];
          try {
            parsed = JSON.parse(stdout);
          } catch (error) {
            throw new Error(
              `Failed to parse az aks list response: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }

          if (!Array.isArray(parsed)) {
            throw new Error('Failed to parse az aks list response: expected a JSON array');
          }

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

/**
 * Discovers Azure BareMetal Kubernetes clusters in the given subscription.
 *
 * Uses `az connectedk8s list` to enumerate clusters. If the `connectedk8s`
 * CLI extension is not installed, the function gracefully returns an empty
 * list instead of throwing.
 *
 * Each returned cluster object includes a `clusterType: 'aksarc'` discriminator
 * so callers can distinguish BareMetal clusters from standard AKS managed clusters.
 *
 * @param subscriptionId - Azure subscription GUID to query.
 * @returns An array of cluster objects, or an empty array when the extension is unavailable.
 */
export async function getConnectedClusters(subscriptionId: string): Promise<any[]> {
  const clusters: any[] = [];

  const args = ['connectedk8s', 'list', '--subscription', subscriptionId, '-o', 'json'];
  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr) {
    // If the extension is unavailable, fall back to returning no BareMetal clusters.
    const commandNotFound =
      stderr.includes("'connectedk8s'") ||
      stderr.includes('az extension add --name connectedk8s') ||
      stderr.includes('unrecognized arguments: connectedk8s');
    if (commandNotFound) {
      debugLog('connectedk8s extension not available; skipping BareMetal cluster discovery');
      return clusters;
    }

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
  }

  if (!stdout) {
    return clusters;
  }

  let parsed: any[];
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Failed to parse connectedk8s list response: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Failed to parse connectedk8s list response: expected a JSON array');
  }

  parsed.forEach((cluster: any) => {
    clusters.push({
      name: cluster.name,
      subscription: subscriptionId,
      resourceGroup: cluster.resourceGroup,
      location: cluster.location,
      version: cluster.kubernetesVersion || cluster.agentVersion || '',
      status: cluster.provisioningState || cluster.connectivityStatus || 'Unknown',
      powerState: cluster.connectivityStatus || 'Unknown',
      nodeCount: 0,
      clusterType: 'aksarc',
    });
  });

  return clusters;
}

export async function getAksClusterStatus(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
}): Promise<{
  provisioningState: string;
  powerState: string;
  kubernetesVersion: string;
  ready: boolean;
}> {
  const { subscriptionId, resourceGroup, clusterName } = options;

  const args = [
    'aks',
    'show',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
    '--output',
    'json',
  ];

  debugLog('Checking AKS cluster status:', 'az', args.join(' '));

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    console.error('Failed to get cluster status:', stderr);
    throw new Error(`Failed to get cluster status: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    const provisioningState = result.provisioningState || 'Unknown';
    const powerState = result.powerState?.code || 'Unknown';
    const kubernetesVersion = result.kubernetesVersion || 'Unknown';
    const ready = provisioningState === 'Succeeded' && powerState === 'Running';

    debugLog(
      `Cluster status: provisioningState=${provisioningState}, powerState=${powerState}, ready=${ready}`
    );

    return {
      provisioningState,
      powerState,
      kubernetesVersion,
      ready,
    };
  } catch (error) {
    console.error('Failed to parse cluster status response:', error);
    throw new Error(`Failed to parse cluster status: ${error}`);
  }
}

export async function getClusterCapabilities(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
}): Promise<ClusterCapabilities> {
  const { subscriptionId, resourceGroup, clusterName } = options;

  const args = [
    'aks',
    'show',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
    '--query',
    '{sku:sku.name,aadProfile:aadProfile,azureRbacEnabled:aadProfile.enableAzureRbac,networkPolicy:networkProfile.networkPolicy,networkPlugin:networkProfile.networkPlugin,prometheusEnabled:azureMonitorProfile.metrics.enabled,containerInsightsEnabled:addonProfiles.omsagent.enabled,kedaEnabled:workloadAutoScalerProfile.keda.enabled,vpaEnabled:workloadAutoScalerProfile.verticalPodAutoscaler.enabled}',
    '--output',
    'json',
  ];

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    console.error('Failed to get cluster capabilities:', stderr);
    throw new Error(`Failed to get cluster capabilities: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    return {
      sku: (result.sku as ClusterCapabilities['sku']) || null,
      aadEnabled: result.aadProfile !== null && result.aadProfile !== undefined,
      azureRbacEnabled: result.azureRbacEnabled ?? null,
      networkPolicy: (result.networkPolicy as ClusterCapabilities['networkPolicy']) || 'none',
      networkPlugin: (result.networkPlugin as ClusterCapabilities['networkPlugin']) || null,
      prometheusEnabled: result.prometheusEnabled ?? null,
      containerInsightsEnabled: result.containerInsightsEnabled ?? null,
      kedaEnabled: result.kedaEnabled ?? null,
      vpaEnabled: result.vpaEnabled ?? null,
    };
  } catch (error) {
    console.error('Failed to parse cluster capabilities response:', error);
    throw new Error(`Failed to parse cluster capabilities: ${error}`);
  }
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

export async function getAksKubeconfig(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  mergeWithExisting?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  kubeconfigPath?: string;
}> {
  const { subscriptionId, resourceGroup, clusterName, mergeWithExisting = true } = options;

  const args = [
    'aks',
    'get-credentials',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
  ];

  // Add merge flag if requested (default behavior)
  if (mergeWithExisting) {
    args.push('--overwrite-existing');
  } else {
    args.push('--file', `~/.kube/config-${clusterName}`);
  }

  debugLog('Getting AKS kubeconfig:', 'az', args.join(' '));

  const { stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && isAzError(stderr)) {
    console.error('Failed to get kubeconfig:', stderr);
    throw new Error(`Failed to get kubeconfig: ${stderr}`);
  }

  const kubeconfigPath = mergeWithExisting ? '~/.kube/config' : `~/.kube/config-${clusterName}`;

  return {
    success: true,
    message: mergeWithExisting
      ? `Kubeconfig merged successfully. Cluster context '${clusterName}' is now available.`
      : `Kubeconfig saved to ${kubeconfigPath}`,
    kubeconfigPath,
  };
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
    let resourceGroup: string = item.resourceGroup || '';

    if (!resourceGroup && resourceId) {
      const match = resourceId.match(/\/resourceGroups\/([^/]+)\//i);
      if (match && match[1]) resourceGroup = match[1];
    }

    if (!resourceId) return null;
    return { resourceId, resourceGroup };
  } catch (parseError) {
    debugLog('parseError:', parseError);
    throw new Error('Failed to parse AKS list response');
  }
}
