// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { getAKSClusters, getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';
import {
  startProxy,
  stopProxy,
  verifyAksHybridEdgeCluster,
} from '../../utils/azure/aksHybridEdgeProxy';
import { getClusterCapabilities } from '../../utils/azure/az-clusters';
import { isExtensionInstalled } from '../../utils/azure/az-extensions';
import {
  getClusterSettings,
  markAksHybridEdgeAppearance,
  setClusterSettings,
} from '../../utils/shared/clusterSettings';
import type { AKSCluster, Subscription, Tenant } from './RegisterAKSClusterDialogPure';
import RegisterAKSClusterDialogPure from './RegisterAKSClusterDialogPure';

interface RegisterAKSClusterDialogProps {
  open: boolean;
  onClose: () => void;
  onClusterRegistered?: () => void;
}

export default function RegisterAKSClusterDialog({
  open,
  onClose,
  onClusterRegistered,
}: RegisterAKSClusterDialogProps) {
  const history = useHistory();
  const { t } = useTranslation();
  const authStatus = useAzureAuth();
  const [loading, setLoading] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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
    setClusters([]);
    setSelectedCluster(null);
    setClusterInputValue('');
    setCapabilities(null);
    setCapabilitiesLoading(false);
  };

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (open && authStatus.isLoggedIn) {
      loadSubscriptions();
    }
  }, [open, authStatus.isLoggedIn]);

  useEffect(() => {
    if (selectedSubscription) {
      loadClusters(selectedSubscription.id);
    } else {
      setClusters([]);
      setSelectedCluster(null);
    }
  }, [selectedSubscription]);

  const loadSubscriptions = async () => {
    setLoadingSubscriptions(true);
    setError('');

    try {
      const result = await getSubscriptions();

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
      console.error('Error loading subscriptions:', err);
      setError(t('Failed to load subscriptions'));
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  const loadClusters = async (subscriptionId: string) => {
    setLoadingClusters(true);
    setError('');
    setClusters([]);
    setSelectedCluster(null);
    setClusterInputValue('');

    try {
      const result = await getAKSClusters(subscriptionId);

      if (!result.success) {
        setError(result.message);
        return;
      }

      setClusters(result.clusters || []);
    } catch (err) {
      console.error('Error loading AKS clusters:', err);
      setError(t('Failed to load AKS clusters'));
    } finally {
      setLoadingClusters(false);
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
    setSelectedCluster(value);
    setClusterInputValue(value ? value.name : '');
  };

  const handleClusterInputChange = (
    _event: React.SyntheticEvent,
    value: string,
    reason: string
  ) => {
    if (reason === 'input' || reason === 'clear') {
      setClusterInputValue(value);
      setSelectedCluster(null);
      setCapabilities(null);
    }
  };

  /**
   * Registers an AKS Hybrid & Edge (Arc-connected) cluster by starting `az connectedk8s
   * proxy`, which registers the cluster on the shared local proxy daemon and
   * writes its kubeconfig context. Multiple AKS Hybrid & Edge clusters can be connected
   * at once (they multiplex on the shared daemon).
   */
  const handleAksHybridEdgeRegister = async () => {
    if (!selectedCluster || !selectedSubscription) {
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    const target = {
      subscriptionId: selectedSubscription.id,
      resourceGroup: selectedCluster.resourceGroup,
      clusterName: selectedCluster.name,
    };

    const finish = () => {
      if (isMountedRef.current) {
        setLoading(false);
      }
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
        finish();
        return;
      }

      const startResult = await startProxy(target);

      if (!startResult.success) {
        setError(
          t('Failed to connect to the AKS Hybrid & Edge cluster: {{message}}', {
            message: startResult.error || t('Unknown error'),
          })
        );
        finish();
        return;
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
        await stopProxy(selectedCluster.name);
        setError(
          t(
            "Cluster '{{cluster}}' was added, but it did not become reachable. Details: {{message}}",
            { cluster: selectedCluster.name, message: verify.error || t('Unknown error') }
          )
        );
        finish();
        return;
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

      finish();
      setSuccess(
        t("Cluster '{{cluster}}' successfully connected", {
          cluster: selectedCluster.name,
        })
      );
      onClusterRegistered?.();
    } catch (err) {
      console.error('Error connecting AKS Hybrid & Edge cluster:', err);
      await stopProxy(selectedCluster.name);
      setError(
        t('Failed to connect to the AKS Hybrid & Edge cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
      finish();
    }
  };

  const handleRegister = async () => {
    if (!selectedCluster || !selectedSubscription) {
      return;
    }

    if (selectedCluster.clusterType === 'aksarc') {
      await handleAksHybridEdgeRegister();
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Register the cluster by running az aks get-credentials and setting up kubeconfig
      const result = await registerAKSCluster(
        selectedSubscription.id,
        selectedCluster.resourceGroup,
        selectedCluster.name,
        undefined, // managedNamespace
        selectedSubscription.tenantId
      );

      if (!result.success) {
        setError(result.message);
        setLoading(false);
        return;
      }

      setLoading(false);

      // Show success message with cluster name
      setSuccess(
        t("Cluster '{{cluster}}' successfully merged in kubeconfig", {
          cluster: selectedCluster.name,
        })
      );

      onClusterRegistered?.();

      // Check cluster capabilities (non-blocking)
      setCapabilitiesLoading(true);
      try {
        const caps = await getClusterCapabilities({
          subscriptionId: selectedSubscription.id,
          resourceGroup: selectedCluster.resourceGroup,
          clusterName: selectedCluster.name,
        });
        if (isMountedRef.current) {
          setCapabilities(caps);
        }
      } catch {
        // Non-critical — just don't show capabilities
      } finally {
        if (isMountedRef.current) {
          setCapabilitiesLoading(false);
        }
      }
    } catch (err) {
      console.error('Error registering AKS cluster:', err);
      setError(
        t('Failed to register cluster: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
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
      getClusterCapabilities({
        subscriptionId: selectedSubscription.id,
        resourceGroup: selectedCluster.resourceGroup,
        clusterName: selectedCluster.name,
      })
        .then(caps => {
          if (isMountedRef.current) {
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
