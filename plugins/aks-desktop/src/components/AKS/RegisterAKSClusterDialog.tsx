// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import { useRegisteredClusters } from '../../hooks/useRegisteredClusters';
import { trackError } from '../../telemetry';
import { trackAksFeature } from '../../telemetry/aksFeature';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { getAKSClusters, getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';
import { startProxy, verifyAksHybridEdgeCluster } from '../../utils/azure/aksHybridEdgeProxy';
import { getClusterCapabilities } from '../../utils/azure/az-clusters';
import { isExtensionInstalled } from '../../utils/azure/az-extensions';
import { normalizeClusterName } from '../../utils/kubernetes/k8sNames';
import {
  getClusterSettings,
  markAksHybridEdgeAppearance,
  setClusterSettings,
} from '../../utils/shared/clusterSettings';
import type {
  AKSCluster,
  Subscription,
  SubscriptionRefreshState,
  Tenant,
} from './RegisterAKSClusterDialogPure';
import RegisterAKSClusterDialogPure from './RegisterAKSClusterDialogPure';

interface SubscriptionListChanges {
  /** Whether IDs or user-visible subscription metadata differ. */
  differs: boolean;
  /** Number of subscription IDs absent from the cached list. */
  addedCount: number;
}

/**
 * Compares cached and refreshed subscription snapshots without depending on list order.
 *
 * @param cached - Subscription snapshot returned from Azure CLI cache.
 * @param refreshed - Subscription snapshot retrieved from Azure.
 * @returns Whether snapshots differ and how many subscription IDs were added.
 */
function compareSubscriptionLists(
  cached: Subscription[],
  refreshed: Subscription[]
): SubscriptionListChanges {
  const signature = (subscription: Subscription) =>
    JSON.stringify([
      subscription.name,
      subscription.state,
      subscription.tenantId,
      subscription.tenantName ?? '',
    ]);
  const cachedById = new Map(
    cached.map(subscription => [subscription.id, signature(subscription)])
  );
  const refreshedById = new Map(
    refreshed.map(subscription => [subscription.id, signature(subscription)])
  );
  const addedCount = [...refreshedById.keys()].filter(id => !cachedById.has(id)).length;
  const differs =
    cachedById.size !== refreshedById.size ||
    [...refreshedById].some(([id, value]) => cachedById.get(id) !== value);
  return { differs, addedCount };
}

/**
 * Records a cluster-registration lifecycle status without disrupting the dialog.
 *
 * @param status - Registration lifecycle status to record.
 * @returns Nothing.
 */
function safelyTrackAksFeature(status: 'failed' | 'started' | 'succeeded') {
  try {
    trackAksFeature('aksd.cluster-add', status);
  } catch {}
}

/**
 * Records a privacy-safe registration error without disrupting the dialog.
 *
 * @returns Nothing.
 */
function safelyTrackRegistrationError() {
  try {
    trackError({ area: 'cluster-add', errorClass: 'UnknownError', phase: 'failed' });
  } catch {}
}

interface RegisterAKSClusterDialogProps {
  open: boolean;
  onClose: () => void;
  onClusterRegistered?: () => void;
  onRegistrationFinished?: (outcome: 'failed' | 'succeeded') => void;
  onRegistrationStarted?: () => void;
}

/**
 * Clears registration loading state while the dialog is still mounted.
 *
 * @param isMounted - Whether the dialog can still accept state updates.
 * @param setLoading - React state setter for the registration loading state.
 * @returns Nothing.
 */
function finishRegistration(
  isMounted: boolean,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
): void {
  if (isMounted) {
    setLoading(false);
  }
}

export default function RegisterAKSClusterDialog({
  open,
  onClose,
  onClusterRegistered,
  onRegistrationFinished,
  onRegistrationStarted,
}: RegisterAKSClusterDialogProps) {
  const history = useHistory();
  const { t } = useTranslation();
  const authStatus = useAzureAuth();
  const { registeredClusters, isReady: registeredClustersReady } = useRegisteredClusters();
  const [loading, setLoading] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [subscriptionRefresh, setSubscriptionRefresh] = useState<SubscriptionRefreshState>({
    status: 'idle',
    addedCount: 0,
  });
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [success, setSuccess] = useState('');
  const [registrationSucceeded, setRegistrationSucceeded] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [tenantInputValue, setTenantInputValue] = useState('');
  const [clusters, setClusters] = useState<AKSCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<AKSCluster | null>(null);
  const [subscriptionInputValue, setSubscriptionInputValue] = useState('');
  const [clusterInputValue, setClusterInputValue] = useState('');
  const [capabilities, setCapabilities] = useState<ClusterCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const isMountedRef = useRef(true);
  const selectedSubscriptionRef = useRef<Subscription | null>(null);
  const selectedTenantRef = useRef<Tenant | null>(null);
  selectedSubscriptionRef.current = selectedSubscription;
  selectedTenantRef.current = selectedTenant;

  /**
   * Updates the selected tenant and its refresh-safe reference together.
   *
   * @param value - Tenant to select, or `null` to clear the selection.
   * @returns Nothing.
   */
  const updateSelectedTenant = (value: Tenant | null) => {
    selectedTenantRef.current = value;
    setSelectedTenant(value);
  };

  /**
   * Updates the selected subscription and its refresh-safe reference together.
   *
   * @param value - Subscription to select, or `null` to clear the selection.
   * @returns Nothing.
   */
  const updateSelectedSubscription = (value: Subscription | null) => {
    selectedSubscriptionRef.current = value;
    setSelectedSubscription(value);
  };
  /** Identifies the latest cluster-list request so stale responses are ignored. */
  const clusterRequestIdRef = useRef(0);
  /** Identifies the latest capability request so stale responses are ignored. */
  const capabilityRequestIdRef = useRef(0);
  /** Identifies the active registration so closed sessions cannot update state. */
  const registrationRequestIdRef = useRef(0);
  /** Synchronous guard for repeated submissions before loading state renders. */
  const registrationInFlightRef = useRef(false);

  /** Helper function to filter options by name substring match, ranking prefix matches first. */
  function rankNameMatches<T extends { name: string }>(options: T[], inputValue: string): T[] {
    const query = inputValue.trim().toLowerCase();
    if (!query) return options;
    return options
      .filter(o => o.name.toLowerCase().includes(query))
      .sort((a, b) => {
        const ai = a.name.toLowerCase().indexOf(query);
        const bi = b.name.toLowerCase().indexOf(query);
        return ai !== bi ? ai - bi : a.name.localeCompare(b.name);
      });
  }

  /** Extract unique, sorted list of tenants that own the available subscriptions. */
  function extractTenants(subs: Subscription[]): Tenant[] {
    const byId = new Map<string, Tenant>();
    for (const sub of subs) {
      if (sub.tenantId && !byId.has(sub.tenantId)) {
        byId.set(sub.tenantId, { id: sub.tenantId, name: sub.tenantName || sub.tenantId });
      }
    }
    const uniqueTenants = Array.from(byId.values());
    return uniqueTenants.sort((a, b) => a.name.localeCompare(b.name));
  }

  const resetClusterState = () => {
    clusterRequestIdRef.current++;
    capabilityRequestIdRef.current++;
    setLoadingClusters(false);
    setClusters([]);
    setSelectedCluster(null);
    setClusterInputValue('');
    setCapabilities(null);
    setCapabilitiesLoading(false);
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clusterRequestIdRef.current++;
      capabilityRequestIdRef.current++;
      registrationRequestIdRef.current++;
      registrationInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      clusterRequestIdRef.current++;
      capabilityRequestIdRef.current++;
      registrationRequestIdRef.current++;
      setLoading(registrationInFlightRef.current);
      setLoadingSubscriptions(false);
      setSubscriptionRefresh({ status: 'idle', addedCount: 0 });
      setLoadingClusters(false);
      setCapabilitiesLoading(false);
      setError('');
      setSuccess('');
      setSubscriptionRefresh({ status: 'idle', addedCount: 0 });
      setRegistrationSucceeded(false);
      setSubscriptions([]);
      updateSelectedSubscription(null);
      updateSelectedTenant(null);
      setTenantInputValue('');
      setClusters([]);
      setSelectedCluster(null);
      setSubscriptionInputValue('');
      setClusterInputValue('');
      setCapabilities(null);
    }
  }, [open]);

  useEffect(() => {
    let active = true;
    if (open && authStatus.isLoggedIn) {
      clusterRequestIdRef.current++;
      capabilityRequestIdRef.current++;
      registrationRequestIdRef.current++;
      setLoading(registrationInFlightRef.current);
      setError('');
      setSuccess('');
      setSubscriptions([]);
      updateSelectedSubscription(null);
      updateSelectedTenant(null);
      setTenantInputValue('');
      setSubscriptionInputValue('');
      setClusters([]);
      setSelectedCluster(null);
      setClusterInputValue('');
      setCapabilities(null);
      setCapabilitiesLoading(false);
      loadSubscriptions(() => active);
    } else {
      setLoadingSubscriptions(false);
      if (open) {
        clusterRequestIdRef.current++;
        capabilityRequestIdRef.current++;
        registrationRequestIdRef.current++;
        setLoading(registrationInFlightRef.current);
        setError('');
        setSuccess('');
        setSubscriptionRefresh({ status: 'idle', addedCount: 0 });
        setSubscriptions([]);
        updateSelectedSubscription(null);
        updateSelectedTenant(null);
        setTenantInputValue('');
        setSubscriptionInputValue('');
        setClusters([]);
        setSelectedCluster(null);
        setClusterInputValue('');
        setCapabilities(null);
        setCapabilitiesLoading(false);
      }
    }
    return () => {
      active = false;
    };
  }, [
    open,
    authStatus.isLoggedIn,
    authStatus.subscriptionId,
    authStatus.tenantId,
    authStatus.username,
  ]);

  useEffect(() => {
    if (selectedSubscription) {
      loadClusters(selectedSubscription.id);
    } else {
      clusterRequestIdRef.current++;
      setLoadingClusters(false);
      setClusters([]);
      setSelectedCluster(null);
    }
  }, [selectedSubscription]);

  const loadSubscriptions = async (isCurrent: () => boolean) => {
    setLoadingSubscriptions(true);
    setSubscriptionRefresh({ status: 'idle', addedCount: 0 });
    setError('');
    let cached: Subscription[];

    try {
      const result = await getSubscriptions();

      if (!isCurrent()) {
        return;
      }

      if (!result.success) {
        setError(result.message);
        setLoadingSubscriptions(false);
        return;
      }

      cached = result.subscriptions || [];
      setSubscriptions(cached);

      // Auto-select tenant when all subscriptions belong to the same tenant.
      const uniqueTenants = extractTenants(cached);
      if (uniqueTenants.length === 1) {
        updateSelectedTenant(uniqueTenants[0]);
        setTenantInputValue(uniqueTenants[0].name);
      }

      // Auto-select if only one subscription
      if (cached.length === 1) {
        const sub = cached[0];
        updateSelectedSubscription(sub);
        setSubscriptionInputValue(`${sub.name}${sub.state !== 'Enabled' ? ` (${sub.state})` : ''}`);
      }
    } catch (err) {
      if (!isCurrent()) {
        return;
      }
      console.error('Error loading subscriptions:', err);
      setError(t('Failed to load subscriptions'));
      setLoadingSubscriptions(false);
      return;
    }

    if (!isCurrent()) return;
    setLoadingSubscriptions(false);
    setSubscriptionRefresh({ status: 'refreshing', addedCount: 0 });

    try {
      const refreshedResult = await getSubscriptions(true);
      if (!isCurrent()) return;
      if (!refreshedResult.success) {
        setSubscriptionRefresh({ status: 'failed', addedCount: 0 });
        return;
      }

      const refreshed = refreshedResult.subscriptions || [];
      const changes = compareSubscriptionLists(cached, refreshed);
      if (!changes.differs) {
        setSubscriptionRefresh({ status: 'idle', addedCount: 0 });
        return;
      }

      setSubscriptions(refreshed);
      const currentTenant = selectedTenantRef.current;
      if (currentTenant && !refreshed.some(sub => sub.tenantId === currentTenant.id)) {
        updateSelectedTenant(null);
        setTenantInputValue('');
      }
      const currentSubscription = selectedSubscriptionRef.current;
      if (currentSubscription) {
        const replacement = refreshed.find(sub => sub.id === currentSubscription.id) ?? null;
        updateSelectedSubscription(replacement);
        if (!replacement) {
          setSubscriptionInputValue('');
          resetClusterState();
        }
      }
      setSubscriptionRefresh({ status: 'updated', addedCount: changes.addedCount });
    } catch (err) {
      if (!isCurrent()) return;
      console.warn('Failed to refresh Azure subscriptions:', err);
      setSubscriptionRefresh({ status: 'failed', addedCount: 0 });
    }
  };

  const loadClusters = async (subscriptionId: string) => {
    const requestId = ++clusterRequestIdRef.current;
    setLoadingClusters(true);
    setError('');
    setNotice('');
    setClusters([]);
    setSelectedCluster(null);
    setClusterInputValue('');

    try {
      const result = await getAKSClusters(subscriptionId);

      if (requestId !== clusterRequestIdRef.current) {
        return;
      }

      if (!result.success) {
        setError(result.message);
        return;
      }

      setClusters(result.clusters || []);
      // Without saying so, a missing extension looks like a subscription with no
      // Arc clusters, and the install guidance sits behind a cluster that cannot
      // be selected.
      const arcDiscoveryIssue = result.arcDiscoveryUnavailable;
      setNotice(
        arcDiscoveryIssue === 'connectedk8s-extension-missing'
          ? t(
              'AKS Hybrid & Edge clusters are not listed: the Azure CLI "connectedk8s" extension is required. Install it with: az extension add --name connectedk8s'
            )
          : arcDiscoveryIssue || ''
      );
    } catch (err) {
      if (requestId !== clusterRequestIdRef.current) {
        return;
      }
      console.error('Error loading AKS clusters:', err);
      setError(t('Failed to load AKS clusters'));
    } finally {
      if (requestId === clusterRequestIdRef.current) {
        setLoadingClusters(false);
      }
    }
  };

  const tenants = React.useMemo(() => extractTenants(subscriptions), [subscriptions]);

  const tenantScopedSubscriptions = React.useMemo(() => {
    return selectedTenant
      ? subscriptions.filter(sub => sub.tenantId === selectedTenant.id)
      : subscriptions;
  }, [subscriptions, selectedTenant]);

  const filteredSubscriptions = React.useMemo(() => {
    return selectedSubscription
      ? tenantScopedSubscriptions
      : rankNameMatches(tenantScopedSubscriptions, subscriptionInputValue);
  }, [tenantScopedSubscriptions, subscriptionInputValue, selectedSubscription]);

  const filteredClusters = React.useMemo(() => {
    return rankNameMatches(clusters, clusterInputValue);
  }, [clusters, clusterInputValue]);

  const handleTenantChange = (_event: React.SyntheticEvent, value: Tenant | null) => {
    updateSelectedTenant(value);
    setTenantInputValue(value ? value.name : '');
    updateSelectedSubscription(null);
    setSubscriptionInputValue('');
    resetClusterState();
  };

  const handleTenantInputChange = (_event: React.SyntheticEvent, value: string, reason: string) => {
    if (reason === 'input' || reason === 'clear') {
      setTenantInputValue(value);
      if (reason === 'clear') {
        updateSelectedTenant(null);
        updateSelectedSubscription(null);
        setSubscriptionInputValue('');
        resetClusterState();
      }
    }
  };

  const handleSubscriptionChange = (event: React.SyntheticEvent, value: Subscription | null) => {
    updateSelectedSubscription(value);
    setSubscriptionInputValue(
      value ? `${value.name}${value.state !== 'Enabled' ? ` (${value.state})` : ''}` : ''
    );
    resetClusterState();
  };

  const handleSubscriptionInputChange = (
    _event: React.SyntheticEvent,
    value: string,
    reason: string
  ) => {
    if (reason === 'input' || reason === 'clear') {
      setSubscriptionInputValue(value);
      updateSelectedSubscription(null);
      resetClusterState();
    }
  };

  const handleClusterChange = (_event: React.SyntheticEvent, value: AKSCluster | null) => {
    capabilityRequestIdRef.current++;
    setSelectedCluster(value);
    setClusterInputValue(value ? value.name : '');
    setCapabilities(null);
    setCapabilitiesLoading(false);
  };

  const handleClusterInputChange = (
    _event: React.SyntheticEvent,
    value: string,
    reason: string
  ) => {
    if (reason === 'input' || reason === 'clear') {
      capabilityRequestIdRef.current++;
      setClusterInputValue(value);
      setSelectedCluster(null);
      setCapabilities(null);
      setCapabilitiesLoading(false);
    }
  };

  /**
   * Connects an Arc cluster through the shared `az connectedk8s proxy` daemon.
   *
   * @returns Whether the cluster was connected and verified successfully.
   */
  const handleAksHybridEdgeRegister = async (): Promise<boolean> => {
    if (!selectedCluster || !selectedSubscription) {
      return false;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    const target = {
      subscriptionId: selectedSubscription.id,
      resourceGroup: selectedCluster.resourceGroup,
      clusterName: selectedCluster.name,
    };

    try {
      // The proxy is driven by the `connectedk8s` Azure CLI extension.
      const ext = await isExtensionInstalled('connectedk8s');
      if (!ext.installed) {
        // Surface the underlying reason when the check failed for something other
        // than a missing extension (e.g. "Authentication required…"), so a
        // login/CLI failure isn't masked by the generic install message.
        setError(
          ext.error ||
            t(
              'The Azure CLI "connectedk8s" extension is required for AKS Hybrid & Edge clusters. Install it with: az extension add --name connectedk8s'
            )
        );
        finishRegistration(isMountedRef.current, setLoading);
        return false;
      }

      const startResult = await startProxy(target);

      if (!startResult.success) {
        setError(
          t('Failed to connect to the AKS Hybrid & Edge cluster: {{message}}', {
            message: startResult.error || t('Unknown error'),
          })
        );
        finishRegistration(isMountedRef.current, setLoading);
        return false;
      }

      // Confirm the cluster actually answers through the proxy. If it doesn't,
      // the cluster is typically stopped or its Azure Arc agents aren't running
      // — but surface the underlying proxy/probe error so a genuine failure
      // (extension, auth, spawn error) isn't masked as "cluster offline".
      const verify = await verifyAksHybridEdgeCluster(selectedCluster.name, {
        target: {
          subscriptionId: target.subscriptionId,
          resourceGroup: target.resourceGroup,
        },
      });
      if (!verify.success) {
        console.error('[AKS] AKS Hybrid & Edge verify failed:', verify);
        // Proxy left running on purpose — the arcProxy daemon is shared with any
        // other connected cluster. Cleaned up on app quit.
        setError(
          t(
            "Cluster '{{cluster}}' was added, but it did not become reachable. Details: {{message}}",
            { cluster: selectedCluster.name, message: verify.error || t('Unknown error') }
          )
        );
        finishRegistration(isMountedRef.current, setLoading);
        return false;
      }

      // Persist metadata so the cluster is recognised as AKS Hybrid & Edge in the list
      // view and by the proxy actions.
      const existing = getClusterSettings(selectedCluster.name);
      setClusterSettings(selectedCluster.name, {
        ...existing,
        clusterType: 'aksarc',
        subscriptionId: selectedSubscription.id,
        resourceGroup: selectedCluster.resourceGroup,
      });
      // Give the cluster a distinct name badge (server icon + Azure-blue accent)
      // on the Home table, so AKS Hybrid & Edge clusters stand out next to their name.
      markAksHybridEdgeAppearance(selectedCluster.name);

      finishRegistration(isMountedRef.current, setLoading);
      setSuccess(
        t("Cluster '{{cluster}}' successfully connected", {
          cluster: selectedCluster.name,
        })
      );
      onClusterRegistered?.();
      return true;
    } catch (err) {
      console.error('Error connecting AKS Hybrid & Edge cluster:', err);
      setError(
        t('Failed to connect to the AKS Hybrid & Edge cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
      finishRegistration(isMountedRef.current, setLoading);
      return false;
    }
  };

  const handleRegister = async () => {
    if (
      registrationInFlightRef.current ||
      registrationSucceeded ||
      !registeredClustersReady ||
      !selectedCluster ||
      !selectedSubscription
    ) {
      return;
    }
    registrationInFlightRef.current = true;
    const registrationRequestId = ++registrationRequestIdRef.current;

    onRegistrationStarted?.();
    safelyTrackAksFeature('started');
    if (selectedCluster.clusterType === 'aksarc') {
      const succeeded = await handleAksHybridEdgeRegister();
      registrationInFlightRef.current = false;
      safelyTrackAksFeature(succeeded ? 'succeeded' : 'failed');
      if (!succeeded) {
        safelyTrackRegistrationError();
      }
      onRegistrationFinished?.(succeeded ? 'succeeded' : 'failed');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    let result: Awaited<ReturnType<typeof registerAKSCluster>>;
    try {
      // Register the cluster by running az aks get-credentials and setting up kubeconfig
      result = await registerAKSCluster(
        selectedSubscription.id,
        selectedCluster.resourceGroup,
        selectedCluster.name,
        undefined,
        registeredClusters.has(normalizeClusterName(selectedCluster.name))
      );
      if (registrationRequestId !== registrationRequestIdRef.current) {
        return;
      }
    } catch (err) {
      if (registrationRequestId !== registrationRequestIdRef.current) {
        return;
      }
      console.error('Error registering AKS cluster:', err);
      setError(
        t('Failed to register cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
      setLoading(false);
      safelyTrackAksFeature('failed');
      safelyTrackRegistrationError();
      onRegistrationFinished?.('failed');
      return;
    } finally {
      registrationInFlightRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
      }
    }

    if (!result.success) {
      setError(result.message);
      setLoading(false);
      safelyTrackAksFeature('failed');
      safelyTrackRegistrationError();
      onRegistrationFinished?.('failed');
      return;
    }

    safelyTrackAksFeature('succeeded');
    onRegistrationFinished?.('succeeded');
    setLoading(false);
    setRegistrationSucceeded(true);

    // Show success message with cluster name
    setSuccess(
      t("Cluster '{{cluster}}' successfully merged in kubeconfig", {
        cluster: selectedCluster.name,
      })
    );

    onClusterRegistered?.();

    // Check cluster capabilities (non-blocking)
    const capabilityRequestId = ++capabilityRequestIdRef.current;
    setCapabilitiesLoading(true);
    try {
      const caps = await getClusterCapabilities({
        subscriptionId: selectedSubscription.id,
        resourceGroup: selectedCluster.resourceGroup,
        clusterName: selectedCluster.name,
      });
      if (isMountedRef.current && capabilityRequestId === capabilityRequestIdRef.current) {
        setCapabilities(caps);
      }
    } catch {
      // Non-critical — just don't show capabilities
    } finally {
      if (isMountedRef.current && capabilityRequestId === capabilityRequestIdRef.current) {
        setCapabilitiesLoading(false);
      }
    }
  };

  const handleClose = () => {
    if (!loading && !registrationInFlightRef.current && !registrationSucceeded) {
      onClose();
    }
  };

  const handleDone = () => {
    onClose();
    history.replace('/');
    window.location.reload();
  };

  const handleConfigured = () => {
    if (selectedSubscription && selectedCluster) {
      const capabilityRequestId = ++capabilityRequestIdRef.current;
      getClusterCapabilities({
        subscriptionId: selectedSubscription.id,
        resourceGroup: selectedCluster.resourceGroup,
        clusterName: selectedCluster.name,
      })
        .then(caps => {
          if (isMountedRef.current && capabilityRequestId === capabilityRequestIdRef.current) {
            setCapabilities(caps);
          }
        })
        .catch(() => {});
    }
  };

  return (
    <RegisterAKSClusterDialogPure
      open={open}
      isChecking={authStatus.isChecking}
      isLoggedIn={authStatus.isLoggedIn}
      loading={loading}
      loadingSubscriptions={loadingSubscriptions}
      subscriptionRefresh={subscriptionRefresh}
      loadingClusters={loadingClusters}
      capabilitiesLoading={capabilitiesLoading}
      error={error}
      success={success}
      registrationSucceeded={registrationSucceeded}
      clusterConfigReady={registeredClustersReady}
      subscriptions={filteredSubscriptions}
      selectedSubscription={selectedSubscription}
      subscriptionInputValue={subscriptionInputValue}
      tenants={tenants}
      selectedTenant={selectedTenant}
      tenantInputValue={tenantInputValue}
      clusters={clusters}
      filteredClusters={filteredClusters}
      selectedCluster={selectedCluster}
      clusterInputValue={clusterInputValue}
      capabilities={capabilities}
      onClose={handleClose}
      onSubscriptionChange={handleSubscriptionChange}
      onSubscriptionInputChange={handleSubscriptionInputChange}
      onTenantChange={handleTenantChange}
      onTenantInputChange={handleTenantInputChange}
      onClusterChange={handleClusterChange}
      onClusterInputChange={handleClusterInputChange}
      notice={notice}
      onRegister={handleRegister}
      onDone={handleDone}
      onDismissError={() => setError('')}
      onDismissSuccess={() => setSuccess('')}
      onConfigured={handleConfigured}
    />
  );
}
