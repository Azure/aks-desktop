// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import { trackError } from '../../telemetry';
import { trackAksFeature } from '../../telemetry/aksFeature';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { getAKSClusters, getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';
import { getClusterCapabilities } from '../../utils/azure/az-clusters';
import type { AKSCluster, Subscription, Tenant } from './RegisterAKSClusterDialogPure';
import RegisterAKSClusterDialogPure from './RegisterAKSClusterDialogPure';

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
  const [loading, setLoading] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [error, setError] = useState('');
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
      setLoadingClusters(false);
      setCapabilitiesLoading(false);
      setError('');
      setSuccess('');
      setRegistrationSucceeded(false);
      setSubscriptions([]);
      setSelectedSubscription(null);
      setSelectedTenant(null);
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
      setRegistrationSucceeded(false);
      setSubscriptions([]);
      setSelectedSubscription(null);
      setSelectedTenant(null);
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
        setRegistrationSucceeded(false);
        setSubscriptions([]);
        setSelectedSubscription(null);
        setSelectedTenant(null);
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
    setError('');

    try {
      const result = await getSubscriptions();

      if (!isCurrent()) {
        return;
      }

      if (!result.success) {
        setError(result.message);
        return;
      }

      const subs = result.subscriptions || [];
      setSubscriptions(subs);

      // Auto-select tenant when all subscriptions belong to the same tenant.
      const uniqueTenants = extractTenants(subs);
      if (uniqueTenants.length === 1) {
        setSelectedTenant(uniqueTenants[0]);
        setTenantInputValue(uniqueTenants[0].name);
      }

      // Auto-select if only one subscription
      if (subs.length === 1) {
        const sub = subs[0];
        setSelectedSubscription(sub);
        setSubscriptionInputValue(`${sub.name}${sub.state !== 'Enabled' ? ` (${sub.state})` : ''}`);
      }
    } catch (err) {
      if (!isCurrent()) {
        return;
      }
      console.error('Error loading subscriptions:', err);
      setError(t('Failed to load subscriptions'));
    } finally {
      if (isCurrent()) {
        setLoadingSubscriptions(false);
      }
    }
  };

  const loadClusters = async (subscriptionId: string) => {
    const requestId = ++clusterRequestIdRef.current;
    setLoadingClusters(true);
    setError('');
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
    setSelectedTenant(value);
    setTenantInputValue(value ? value.name : '');
    setSelectedSubscription(null);
    setSubscriptionInputValue('');
    resetClusterState();
  };

  const handleTenantInputChange = (_event: React.SyntheticEvent, value: string, reason: string) => {
    if (reason === 'input' || reason === 'clear') {
      setTenantInputValue(value);
      if (reason === 'clear') {
        setSelectedTenant(null);
        setSelectedSubscription(null);
        setSubscriptionInputValue('');
        resetClusterState();
      }
    }
  };

  const handleSubscriptionChange = (event: React.SyntheticEvent, value: Subscription | null) => {
    setSelectedSubscription(value);
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
      setSelectedSubscription(null);
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

  const handleRegister = async () => {
    if (
      registrationInFlightRef.current ||
      registrationSucceeded ||
      !selectedCluster ||
      !selectedSubscription
    ) {
      return;
    }
    registrationInFlightRef.current = true;
    const registrationRequestId = ++registrationRequestIdRef.current;

    onRegistrationStarted?.();
    safelyTrackAksFeature('started');
    setLoading(true);
    setError('');
    setSuccess('');

    let result: Awaited<ReturnType<typeof registerAKSCluster>>;
    try {
      // Register the cluster by running az aks get-credentials and setting up kubeconfig
      result = await registerAKSCluster(
        selectedSubscription.id,
        selectedCluster.resourceGroup,
        selectedCluster.name
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
      loadingClusters={loadingClusters}
      capabilitiesLoading={capabilitiesLoading}
      error={error}
      success={success}
      registrationSucceeded={registrationSucceeded}
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
      onRegister={handleRegister}
      onDone={handleDone}
      onDismissError={() => setError('')}
      onDismissSuccess={() => setSuccess('')}
      onConfigured={handleConfigured}
    />
  );
}
