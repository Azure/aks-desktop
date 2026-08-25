import { getClusterSettings, setClusterSettings } from '../shared/clusterSettings';
import { getClusters } from './az-clusters';
import { getSubscriptions as getAzSubscriptions } from './az-subscriptions';

export interface Subscription {
  id: string;
  name: string;
  state: string;
  tenantId: string;
  tenantName: string;
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

/** Tail promise used to serialize native kubeconfig updates. */
let registrationQueue = Promise.resolve();

/** Reserves one canonical cluster name for an Azure scope across queued registrations. */
interface RegistrationScopeReservation {
  /** Azure subscription that owns the reserved cluster name. */
  subscriptionId: string;
  /** Azure resource group that owns the reserved cluster name. */
  resourceGroup: string;
  /** Number of queued or active registrations using this reservation. */
  pendingCount: number;
  /** Whether native registration completed successfully in this session. */
  registered: boolean;
}

/** Scopes reserved by registrations started during this application session. */
const registrationScopes = new Map<string, RegistrationScopeReservation>();

/**
 * Checks whether persisted or reserved Azure scope metadata matches a requested scope.
 *
 * @param scope - Scope metadata to validate.
 * @param subscriptionId - Requested Azure subscription ID.
 * @param resourceGroup - Requested Azure resource group.
 * @returns `true` when both scope fields are strings and match case-insensitively.
 */
function scopeMatches(
  scope: { subscriptionId?: unknown; resourceGroup?: unknown } | undefined,
  subscriptionId: string,
  resourceGroup: string
): boolean {
  return (
    typeof scope?.subscriptionId === 'string' &&
    typeof scope.resourceGroup === 'string' &&
    scope.subscriptionId.toLowerCase() === subscriptionId.toLowerCase() &&
    scope.resourceGroup.toLowerCase() === resourceGroup.toLowerCase()
  );
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
        tenantName: sub.tenantName || sub.tenant,
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
        isAzureRBACEnabled: cluster.aadProfile?.enableAzureRbac === true,
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
 * Registrations run serially because each native operation reads and rewrites
 * the shared kubeconfig file.
 *
 * @param subscriptionId - Azure subscription containing the cluster.
 * @param resourceGroup - Azure resource group containing the cluster.
 * @param clusterName - AKS cluster to register.
 * @param managedNamespace - Optional managed namespace name to use for scoped credentials
 * @param clusterAlreadyRegistered - Whether Headlamp currently has this cluster name active.
 * @returns The native registration result after earlier registrations finish.
 */
export async function registerAKSCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  managedNamespace?: string,
  clusterAlreadyRegistered = false
): Promise<{
  success: boolean;
  message: string;
}> {
  if (clusterAlreadyRegistered) {
    const registeredScope = getClusterSettings(clusterName).azureRegistration;
    if (!scopeMatches(registeredScope, subscriptionId, resourceGroup)) {
      return {
        success: false,
        message: `Cluster '${clusterName}' is already registered from a different or unknown Azure scope.`,
      };
    }
  }

  const reservationKey = clusterName.toLowerCase();
  let existingReservation = registrationScopes.get(reservationKey);
  if (
    existingReservation?.registered &&
    existingReservation.pendingCount === 0 &&
    !clusterAlreadyRegistered
  ) {
    registrationScopes.delete(reservationKey);
    existingReservation = undefined;
  }
  if (existingReservation && !scopeMatches(existingReservation, subscriptionId, resourceGroup)) {
    return {
      success: false,
      message: `Cluster '${clusterName}' is already registered from a different or unknown Azure scope.`,
    };
  }
  const reservation = existingReservation ?? {
    subscriptionId,
    resourceGroup,
    pendingCount: 0,
    registered: clusterAlreadyRegistered,
  };
  reservation.pendingCount++;
  registrationScopes.set(reservationKey, reservation);

  const previousRegistration = registrationQueue;
  let releaseRegistration!: () => void;
  registrationQueue = new Promise(resolve => {
    releaseRegistration = resolve;
  });
  await previousRegistration;

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

    const result: unknown = await desktopApi.registerAKSCluster(
      subscriptionId,
      resourceGroup,
      clusterName,
      false, // isAzureRBACEnabled
      managedNamespace,
      'aks'
    );

    if (
      typeof result !== 'object' ||
      result === null ||
      typeof (result as { success?: unknown }).success !== 'boolean' ||
      typeof (result as { message?: unknown }).message !== 'string'
    ) {
      return {
        success: false,
        message: 'Cluster registration returned an invalid response.',
      };
    }

    console.debug('[AKS] Registration result:', result);
    const registrationResult = result as { success: boolean; message: string };
    if (registrationResult.success) {
      reservation.registered = true;
      try {
        const settings = getClusterSettings(clusterName);
        setClusterSettings(clusterName, {
          ...settings,
          azureRegistration: { subscriptionId, resourceGroup },
        });
      } catch (error) {
        console.warn('[AKS] Failed to persist cluster registration scope:', error);
      }
    }
    return registrationResult;
  } catch (error) {
    console.error('[AKS] Error registering AKS cluster:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    reservation.pendingCount--;
    if (reservation.pendingCount === 0 && !reservation.registered) {
      registrationScopes.delete(reservationKey);
    }
    releaseRegistration();
  }
}
