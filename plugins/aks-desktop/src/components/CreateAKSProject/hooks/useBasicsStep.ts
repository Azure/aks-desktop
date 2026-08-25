// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useRef } from 'react';
import { useAzureAuth } from '../../../hooks/useAzureAuth';
import type { ClusterState } from '../../../utils/azure/clusterState';
import {
  getClusterStateLabel,
  isAksHybridEdgeOnline,
  isClusterFailed as isProvisioningFailed,
} from '../../../utils/azure/clusterState';
import { normalizeClusterName } from '../../../utils/kubernetes/k8sNames';
import { getClusterSettings } from '../../../utils/shared/clusterSettings';
import type { SearchableSelectOption } from '../components/SearchableSelect';
import type { AzureCluster, AzureSubscription, FormData } from '../types';

/**
 * Adapts an {@link AzureCluster} to the shared {@link ClusterState} shape. The
 * two cluster lists in this plugin name the ARM provisioning state differently
 * (`status` here, `provisioningState` in the Add Cluster dialog), so the shared
 * state rules take one canonical shape and each caller maps into it.
 */
function toClusterState(cluster: AzureCluster): ClusterState {
  return {
    clusterType: cluster.clusterType,
    provisioningState: cluster.status,
    connectivityStatus: cluster.connectivityStatus,
  };
}

/**
 * The subset of {@link BasicsStepProps} that {@link useBasicsStep} actually
 * reads. Keeping the hook's input narrow makes the dependency contract explicit
 * and simplifies testing.
 */
export interface UseBasicsStepInput {
  formData: FormData;
  onFormDataChange: (updates: Partial<FormData>) => void;
  subscriptions: AzureSubscription[];
  clusters: AzureCluster[];
  loadingClusters: boolean;
  totalClusterCount: number | null;
}

// ---------------------------------------------------------------------------
// Pure helper functions (no hooks, fully testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Returns the helper text shown below the Cluster select field.
 *
 * - While clusters are loading, shows a static note about the Entra ID filter.
 * - After loading, reports how many eligible clusters were found and how many
 *   were hidden because they lack Azure Entra ID authentication.
 *
 * @param t - The i18n translation function.
 * @param loadingClusters - Whether clusters are currently being fetched.
 * @param clusterCount - Number of eligible (Entra ID) clusters in the list.
 * @param totalClusterCount - Total clusters in the subscription before filtering,
 *   or `null` if not yet known.
 */
export function getClusterHelperText(
  t: (key: string, options?: Record<string, unknown>) => string,
  loadingClusters: boolean,
  clusterCount: number,
  totalClusterCount: number | null
): string {
  if (loadingClusters) {
    return t('Only clusters with Azure Entra ID authentication are shown.');
  }
  const hiddenCount =
    totalClusterCount !== null && totalClusterCount > clusterCount
      ? totalClusterCount - clusterCount
      : 0;
  const hiddenSuffix =
    hiddenCount > 0
      ? ` (${t('{{count}} cluster(s) hidden — no Azure Entra ID', { count: hiddenCount })})`
      : '';
  if (clusterCount === 0) {
    return `${t('No eligible clusters found in this subscription.')}${hiddenSuffix}`;
  }
  return `${t('{{count}} eligible cluster(s) found.', { count: clusterCount })}${hiddenSuffix}`;
}

/**
 * Returns `true` when the cluster is in a provisioning or power state that
 * makes deployment unreliable (updating, upgrading, deleting, creating,
 * failed, stopping, stopped, deallocating, or deallocated).
 *
 * @param cluster - The Azure cluster to inspect.
 */
export function isClusterNonReady(cluster: AzureCluster): boolean {
  const provisioningState = cluster.status?.toLowerCase() || '';
  const powerState = cluster.powerState?.toLowerCase() || '';

  const nonReadyProvisioningStates = ['updating', 'upgrading', 'deleting', 'creating', 'failed'];
  const nonReadyPowerStates = ['stopping', 'stopped', 'deallocating', 'deallocated'];

  return (
    nonReadyProvisioningStates.includes(provisioningState) ||
    nonReadyPowerStates.includes(powerState)
  );
}

/**
 * Returns a human-readable warning message for the cluster's current
 * non-ready state, or an empty string if the cluster is ready.
 *
 * @param cluster - The Azure cluster to inspect.
 * @param t - The i18n translation function.
 */
export function getClusterStateMessage(cluster: AzureCluster, t: (key: string) => string): string {
  const provisioningState = cluster.status?.toLowerCase() || '';
  const powerState = cluster.powerState?.toLowerCase() || '';

  if (provisioningState === 'updating' || provisioningState === 'upgrading') {
    return t('Cluster is currently updating. Deployment may fail.');
  }
  if (provisioningState === 'deleting') {
    return t('Cluster is being deleted. Cannot deploy to this cluster.');
  }
  if (provisioningState === 'creating') {
    return t('Cluster is still being created. Please wait until creation completes.');
  }
  if (provisioningState === 'failed') {
    return t('Cluster is in a failed state. Please check Azure portal.');
  }
  if (powerState === 'stopped' || powerState === 'stopping') {
    return t('Cluster is stopped. Please start the cluster before deploying.');
  }
  if (powerState === 'deallocated' || powerState === 'deallocating') {
    return t('Cluster is deallocated. Please start the cluster before deploying.');
  }
  return '';
}

/**
 * Returns a collision-free select value without changing the cluster name stored in form data.
 *
 * @param cluster - Azure cluster whose option identity is required.
 * @returns A serialized tuple containing the cluster name and resource group.
 */
export function getClusterOptionValue(cluster: AzureCluster): string {
  return JSON.stringify([cluster.name, cluster.resourceGroup]);
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

/**
 * Return type for {@link useBasicsStep}.
 */
export interface UseBasicsStepResult {
  /** Ref attached to the Project Name input to steal focus on mount. */
  projectNameRef: React.RefObject<HTMLInputElement>;
  /** Subscription list formatted for {@link SearchableSelect}. */
  subscriptionOptions: SearchableSelectOption[];
  /** Cluster list formatted for {@link SearchableSelect}. */
  clusterOptions: SearchableSelectOption[];
  /** Helper text shown below the Cluster select field. */
  clusterHelperText: string;
  /** The currently selected Azure subscription object, or `undefined` if none. */
  selectedSubscription: AzureSubscription | undefined;
  /** The currently selected Azure cluster object, or `undefined` if none. */
  selectedCluster: AzureCluster | undefined;
  /** Composite select value for the selected cluster and resource group. */
  selectedClusterValue: string;
  /**
   * `true` when a cluster is selected but is not present in the headlamp
   * kubeconfig — the user must register it before proceeding.
   */
  isClusterMissing: boolean;
  /** `true` when the active same-name cluster belongs to another or unknown Azure scope. */
  clusterScopeConflict: boolean;
  /**
   * When the selected cluster is in a non-ready state, contains the cluster
   * object and a pre-translated warning message. `null` otherwise.
   */
  nonReadyCluster: { cluster: AzureCluster; message: string } | null;
  /**
   * Generic field change handler. Calls `onFormDataChange` with a single
   * key-value patch.
   */
  handleInputChange: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  /**
   * Cluster selection handler. Updates both `cluster` and `resourceGroup`
   * together so they stay in sync.
   */
  handleClusterChange: (clusterName: string) => void;
}

export type ClusterRegistrationState = 'missing' | 'registered' | 'scope-conflict';

/**
 * Resolves whether a selected Azure cluster matches the active kubeconfig entry.
 *
 * @param headlampClusters - Current Headlamp cluster configuration, if available.
 * @param clusterName - Selected Azure cluster name.
 * @param subscriptionId - Selected Azure subscription ID.
 * @param resourceGroup - Selected Azure resource group.
 * @returns Whether the cluster is missing, registered in scope, or conflicts by scope.
 */
export function getClusterRegistrationState(
  headlampClusters: Record<string, unknown> | null | undefined,
  clusterName: string,
  subscriptionId: string,
  resourceGroup: string
): ClusterRegistrationState {
  const activeCluster = Object.values(headlampClusters || {}).find(
    (cluster: any) =>
      typeof cluster.name === 'string' &&
      normalizeClusterName(cluster.name) === normalizeClusterName(clusterName)
  );
  if (!activeCluster) return 'missing';

  const settings = getClusterSettings(clusterName);
  const registeredScope =
    settings.clusterType === 'aksarc'
      ? { subscriptionId: settings.subscriptionId, resourceGroup: settings.resourceGroup }
      : settings.azureRegistration;
  const scopeMatches =
    typeof registeredScope?.subscriptionId === 'string' &&
    typeof registeredScope.resourceGroup === 'string' &&
    registeredScope.subscriptionId.toLowerCase() === subscriptionId.toLowerCase() &&
    registeredScope.resourceGroup.toLowerCase() === resourceGroup.toLowerCase();
  return scopeMatches ? 'registered' : 'scope-conflict';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Encapsulates all stateful logic for the Basics step of the Create AKS
 * Project wizard.
 *
 * Responsibilities:
 * - Focus the Project Name input on mount (when nothing else has focus).
 * - Auto-select the default subscription once `authStatus.subscriptionId` is
 *   known and matches an entry in the subscription list.
 * - Derive display-ready option lists for the subscription and cluster
 *   `SearchableSelect` fields.
 * - Compute the cluster helper text, selected subscription and cluster objects,
 *   missing-cluster flag, and non-ready cluster warning from the current form state.
 * - Provide `handleInputChange` and `handleClusterChange` callbacks that
 *   delegate to `props.onFormDataChange`.
 *
 * @param props - The fields from {@link UseBasicsStepInput} that the hook needs.
 * @returns Derived Basics-step state and handlers for the current form data.
 */
export function useBasicsStep(props: UseBasicsStepInput): UseBasicsStepResult {
  const { t } = useTranslation();
  const {
    formData,
    onFormDataChange,
    subscriptions,
    clusters,
    loadingClusters,
    totalClusterCount,
  } = props;

  const headlampClusters = K8s.useClustersConf();
  const authStatus = useAzureAuth();

  // Focus the Project Name input on mount. Only steals focus when nothing
  // else is focused (activeElement is <body>) so it doesn't interrupt
  // interactions that started before the AzureAuthGuard finished mounting.
  const projectNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement?.tagName === 'BODY') {
      projectNameRef.current?.focus();
    }
  }, []);

  // Auto-select the default subscription exactly once. The ref guards against
  // re-running when the effect re-fires due to unrelated dependency changes.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (
      !autoSelected.current &&
      authStatus?.subscriptionId &&
      !formData.subscription &&
      subscriptions &&
      subscriptions.find(it => it.id === authStatus.subscriptionId)
    ) {
      autoSelected.current = true;
      onFormDataChange({ subscription: authStatus.subscriptionId });
    }
  }, [formData.subscription, authStatus?.subscriptionId, subscriptions, onFormDataChange]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const subscriptionOptions: SearchableSelectOption[] = subscriptions.map(sub => {
    // tenantName is absent for guest/cross-tenant subscriptions, and can equal
    // the GUID once upstream fallbacks apply — don't render the GUID twice.
    const tenantLabel =
      sub.tenantName && sub.tenantName !== sub.tenant
        ? `${sub.tenantName} - (${sub.tenant})`
        : sub.tenant;
    return {
      value: sub.id,
      label: sub.name,
      subtitle: `${t('Tenant')}: ${tenantLabel} • ${t('Status')}: ${sub.status}`,
    };
  });

  const clusterOptions: SearchableSelectOption[] = clusters.map(cluster => {
    const state = toClusterState(cluster);
    const offline = !isAksHybridEdgeOnline(state);
    return {
      value: getClusterOptionValue(cluster),
      label: cluster.name,
      subtitle: `${t('Resource Group')}: ${cluster.resourceGroup} • ${cluster.location} • ${
        cluster.version
      } • ${t('{{count}} nodes', { count: cluster.nodeCount })} • ${getClusterStateLabel(state)}`,
      // Clusters in a Failed provisioning state are not deployable, and an Arc
      // cluster whose agent is offline cannot be reached at all — disable both
      // (non-selectable) in the dropdown. The subtitle shows "Failed"/"Offline"
      // so the reason is visible.
      disabled: isProvisioningFailed(state) || offline,
      // Tag Arc-connected clusters so they stand out in the dropdown, matching the
      // "AKS Hybrid & Edge" and "Offline" chips used in the Add Cluster dialog.
      chips: [
        ...(cluster.clusterType === 'aksarc'
          ? [{ label: t('AKS Hybrid & Edge'), icon: 'mdi:server', color: 'info' as const }]
          : []),
        ...(offline
          ? [{ label: t('Offline'), icon: 'mdi:cloud-off-outline', color: 'default' as const }]
          : []),
      ],
    };
  });

  const clusterHelperText = getClusterHelperText(
    t,
    loadingClusters,
    clusters.length,
    totalClusterCount
  );

  const selectedSubscription = formData.subscription
    ? subscriptions.find(s => s.id === formData.subscription)
    : undefined;

  const selectedCluster = formData.cluster
    ? clusters.find(c => c.name === formData.cluster && c.resourceGroup === formData.resourceGroup)
    : undefined;
  const selectedClusterValue = selectedCluster ? getClusterOptionValue(selectedCluster) : '';

  const clusterRegistrationState = selectedCluster
    ? getClusterRegistrationState(
        headlampClusters,
        selectedCluster.name,
        formData.subscription,
        selectedCluster.resourceGroup
      )
    : undefined;
  const isClusterMissing =
    clusterRegistrationState === 'missing' || clusterRegistrationState === 'scope-conflict';
  const clusterScopeConflict = clusterRegistrationState === 'scope-conflict';

  const nonReadyCluster: UseBasicsStepResult['nonReadyCluster'] =
    selectedCluster && isClusterNonReady(selectedCluster)
      ? {
          cluster: selectedCluster,
          message: getClusterStateMessage(selectedCluster, t),
        }
      : null;

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------

  const handleInputChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    onFormDataChange({ [field]: value } as Pick<FormData, K>);
  };

  const handleClusterChange = (clusterValue: string) => {
    if (!clusterValue) {
      onFormDataChange({ cluster: '', resourceGroup: '' });
      return;
    }
    const found = clusters.find(c => getClusterOptionValue(c) === clusterValue);
    if (found) {
      onFormDataChange({ cluster: found.name, resourceGroup: found.resourceGroup });
    }
  };

  return {
    projectNameRef,
    subscriptionOptions,
    clusterOptions,
    clusterHelperText,
    selectedSubscription,
    selectedCluster,
    selectedClusterValue,
    isClusterMissing,
    clusterScopeConflict,
    nonReadyCluster,
    handleInputChange,
    handleClusterChange,
  };
}
