import { getClusters, getConnectedClusters } from './az-clusters';
import { getSubscriptions as getAzSubscriptions } from './az-subscriptions';

/** An Azure subscription returned by the Azure CLI. */
export interface Subscription {
  /** The subscription GUID. */
  id: string;
  /** Human-readable subscription display name. */
  name: string;
  /** Subscription state, e.g. `"Enabled"`. */
  state: string;
  /** The Azure AD tenant that owns this subscription. */
  tenantId: string;
  /** Whether this is the CLI's currently-active default subscription. */
  isDefault: boolean;
}

/** A unified representation of an AKS managed cluster or an AKS BareMetal (connected) cluster. */
export interface AKSCluster {
  /** Cluster resource name. */
  name: string;
  /** Azure resource group containing the cluster. */
  resourceGroup: string;
  /** Azure region / location. */
  location: string;
  /** Kubernetes version running on the cluster. */
  kubernetesVersion: string;
  /** Current provisioning state, e.g. `"Succeeded"`. */
  provisioningState: string;
  /** Fully-qualified domain name (empty for BareMetal clusters). */
  fqdn: string;
  /** Whether Azure RBAC is enabled on the cluster's AAD profile. */
  isAzureRBACEnabled: boolean;
  /** Discriminator: `'aks'` for managed clusters, `'aksarc'` for Arc-connected clusters. */
  clusterType: 'aks' | 'aksarc';
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

/** Return type of {@link getAKSClusters}. */
export type GetAKSClustersResult = { success: boolean; message: string; clusters?: AKSCluster[] };

// Defense-in-depth: prevent the React t-in-deps infinite loop from spawning
// hundreds of concurrent az CLI processes.
//
// Two layers of protection:
//   1. In-flight deduplication — concurrent calls for the same subscription
//      share one promise instead of each spawning a separate az process.
//   2. Short TTL cache — sequential calls within 10 s return the cached result
//      without touching the CLI at all.
const _aksInFlight = new Map<string, Promise<GetAKSClustersResult>>();
const _aksCache = new Map<string, { result: GetAKSClustersResult; ts: number }>();
const AKS_CLUSTERS_CACHE_TTL_MS = 10_000;

/** For tests only — resets in-flight and TTL caches between test cases. */
export function _clearAKSClustersCache(): void {
  _aksInFlight.clear();
  _aksCache.clear();
}

async function _doGetAKSClusters(subscriptionId: string): Promise<GetAKSClustersResult> {
  try {
    const [aksClusters, arcClusters] = await Promise.all([
      getClusters(subscriptionId),
      getConnectedClusters(subscriptionId),
    ]);
    const clusters = [...aksClusters, ...arcClusters];

    return {
      success: true,
      message: 'AKS/BareMetal clusters retrieved successfully',
      clusters: clusters.map((cluster: any) => ({
        name: cluster.name,
        resourceGroup: cluster.resourceGroup,
        location: cluster.location,
        kubernetesVersion: cluster.version || '',
        provisioningState: cluster.status,
        fqdn: '', // Not returned by getClusters
        isAzureRBACEnabled: cluster.aadProfile?.enableAzureRbac === true,
        clusterType: cluster.clusterType || 'aks',
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
 * Get list of AKS clusters in a subscription.
 *
 * Calls are deduplicated (concurrent requests share one promise) and
 * successful results are cached for {@link AKS_CLUSTERS_CACHE_TTL_MS} ms to
 * guard against runaway React re-render loops.
 */
export async function getAKSClusters(subscriptionId: string): Promise<GetAKSClustersResult> {
  // Return a fresh cached result without touching the CLI.
  const cached = _aksCache.get(subscriptionId);
  if (cached && Date.now() - cached.ts < AKS_CLUSTERS_CACHE_TTL_MS) {
    return cached.result;
  }

  // Reuse an already-in-flight call rather than spawning a second az process.
  const inFlight = _aksInFlight.get(subscriptionId);
  if (inFlight) return inFlight;

  const promise = _doGetAKSClusters(subscriptionId)
    .then(result => {
      // Only cache successful results; errors should be retried immediately.
      if (result.success) {
        _aksCache.set(subscriptionId, { result, ts: Date.now() });
      }
      return result;
    })
    .finally(() => {
      _aksInFlight.delete(subscriptionId);
    });

  _aksInFlight.set(subscriptionId, promise);
  return promise;
}

/**
 * Register an AKS cluster using the Electron IPC API.
 * This calls the native registration logic in the Electron backend.
 *
 * When `clusterType` is `'aksarc'`, the backend runs
 * `az aksarc get-credentials` instead of `az aks get-credentials`.
 *
 * @param subscriptionId - Azure subscription ID
 * @param resourceGroup - Azure resource group name
 * @param clusterName - Cluster name
 * @param managedNamespace - Optional managed namespace name to use for scoped credentials
 * @param clusterType - `'aks'` for managed clusters, `'aksarc'` for Arc-connected clusters
 */
export async function registerAKSCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  managedNamespace?: string,
  clusterType: 'aks' | 'aksarc' = 'aks'
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    console.debug(
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

    const result = await desktopApi.registerAKSCluster(
      subscriptionId,
      resourceGroup,
      clusterName,
      false, // isAzureRBACEnabled retained for backwards compatibility
      managedNamespace,
      clusterType
    );

    console.debug('[AKS] Registration result:', result);
    return result;
  } catch (error) {
    console.error('[AKS] Error registering AKS cluster:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
