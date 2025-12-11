import { getClusters, getSubscriptions as getAzSubscriptions, runCommandAsync } from './az-cli';

export interface Subscription {
  id: string;
  name: string;
  state: string;
  tenantId: string;
  isDefault: boolean;
}

export interface AKSCluster {
  name: string;
  resourceGroup: string;
  location: string;
  kubernetesVersion: string;
  provisioningState: string;
  fqdn: string;
  isAzureRBACEnabled: boolean;
}

/**
 * Get list of Azure subscriptions
 */
export async function getSubscriptions(): Promise<{
  success: boolean;
  message: string;
  subscriptions?: Subscription[];
}> {
  try {
    const subs = await getAzSubscriptions();

    return {
      success: true,
      message: 'Subscriptions retrieved successfully',
      subscriptions: subs.map((sub: any) => ({
        id: sub.id,
        name: sub.name,
        state: sub.status || 'Unknown',
        tenantId: sub.tenant,
        isDefault: false, // We don't have this info from the existing function
      })),
    };
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get list of AKS clusters in a subscription
 */
export async function getAKSClusters(subscriptionId: string): Promise<{
  success: boolean;
  message: string;
  clusters?: AKSCluster[];
}> {
  try {
    const clusters = await getClusters(subscriptionId);

    return {
      success: true,
      message: 'AKS clusters retrieved successfully',
      clusters: clusters.map((cluster: any) => ({
        name: cluster.name,
        resourceGroup: cluster.resourceGroup,
        location: cluster.location,
        kubernetesVersion: cluster.version,
        provisioningState: cluster.status,
        fqdn: '', // Not returned by getClusters
        isAzureRBACEnabled: cluster.aadProfile !== null,
      })),
    };
  } catch (error) {
    console.error('Error getting AKS clusters:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Register an AKS cluster using the Electron IPC API.
 * This calls the native registration logic in the Electron backend.
 *
 * @param managedNamespace - Optional managed namespace name to use for scoped credentials
 */
export async function registerAKSCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  managedNamespace?: string
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    console.log(
      '[AKS] Registering cluster:',
      clusterName,
      managedNamespace ? `with managed namespace: ${managedNamespace}` : ''
    );

    // Call the Electron IPC handler
    const desktopApi = (window as any).desktopApi;

    if (!desktopApi || !desktopApi.registerAKSCluster) {
      console.error('[AKS] Desktop API not available - running in non-desktop mode?');
      return {
        success: false,
        message: 'Desktop API not available. This feature is only available in desktop mode.',
      };
    }

    // Get cluster info
    const clusterInfo = await getAKSClusterDetails(subscriptionId, resourceGroup, clusterName);
    if (!clusterInfo.success) {
      return {
        success: false,
        message: clusterInfo.message,
      };
    }

    const result = await desktopApi.registerAKSCluster(
      subscriptionId,
      resourceGroup,
      clusterName,
      clusterInfo.cluster?.isAzureRBACEnabled,
      managedNamespace
    );

    console.log('[AKS] Registration result:', result);
    return result;
  } catch (error) {
    console.error('[AKS] Error registering AKS cluster:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get details for a specific AKS cluster
 */
export async function getAKSClusterDetails(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<{
  success: boolean;
  message: string;
  cluster?: AKSCluster;
}> {
  try {
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

    const { stdout, stderr } = await runCommandAsync('az', args);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      return {
        success: false,
        message: stderr || 'Failed to get AKS cluster details',
      };
    }

    if (!stdout) {
      return {
        success: false,
        message: 'No cluster details returned from Azure CLI',
      };
    }

    try {
      const cluster = JSON.parse(stdout);
      return {
        success: true,
        message: 'Cluster details retrieved successfully',
        cluster: {
          name: cluster.name,
          resourceGroup: cluster.resourceGroup,
          location: cluster.location,
          kubernetesVersion: cluster.kubernetesVersion,
          provisioningState: cluster.provisioningState,
          fqdn: cluster.fqdn,
          isAzureRBACEnabled: cluster.aadProfile !== null,
        },
      };
    } catch (parseError) {
      console.error('Error parsing cluster details:', parseError);
      return {
        success: false,
        message: 'Failed to parse cluster details',
      };
    }
  } catch (error) {
    console.error('Error getting AKS cluster details:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
