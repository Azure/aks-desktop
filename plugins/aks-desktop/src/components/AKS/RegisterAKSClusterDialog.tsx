// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { getAKSClusters, getSubscriptions, registerAKSCluster } from '../../utils/azure/aks';
import { getClusterCapabilities } from '../../utils/azure/az-clusters';
import { getClusterSettings, setClusterSettings } from '../../utils/shared/clusterSettings';
import { useBareMetalProxy } from '../BareMetal/useBareMetalProxy';
import type { AKSCluster, Subscription } from './RegisterAKSClusterDialogPure';
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
  const location = useLocation();
  const { t } = useTranslation();
  const authStatus = useAzureAuth();
  const [loading, setLoading] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [clusters, setClusters] = useState<AKSCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<AKSCluster | null>(null);
  const [subscriptionInputValue, setSubscriptionInputValue] = useState('');
  const [clusterInputValue, setClusterInputValue] = useState('');
  const [capabilities, setCapabilities] = useState<ClusterCapabilities | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const isMountedRef = useRef(true);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const proxyFocusRequested = searchParams.get('focus') === 'baremetal-proxy';
  const proxySubscriptionId = searchParams.get('subscription');
  const proxyClusterName = searchParams.get('cluster');
  const proxyClusterResourceGroup = searchParams.get('resourceGroup');

  // Derive the BareMetal proxy target from the selected cluster, if it is a BareMetal cluster.
  const bareMetalProxyTarget = useMemo(() => {
    if (
      !selectedSubscription ||
      !selectedCluster ||
      (selectedCluster.clusterType || 'aks') !== 'aksarc'
    ) {
      return null;
    }
    return {
      subscriptionId: selectedSubscription.id,
      resourceGroup: selectedCluster.resourceGroup,
      clusterName: selectedCluster.name,
    };
  }, [selectedSubscription, selectedCluster]);

  const {
    proxyStatus,
    proxyActionLoading,
    proxyUiError,
    proxyDropped,
    refreshProxyStatus,
    handleProxyStart,
    handleProxyStop,
    handleProxyRestart,
    resetProxyState,
    dismissProxyDropped,
  } = useBareMetalProxy(open, bareMetalProxyTarget);

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

  const resetClusterState = () => {
    setClusters([]);
    setSelectedCluster(null);
    setClusterInputValue('');
    setCapabilities(null);
    setCapabilitiesLoading(false);
    resetProxyState();
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

  useEffect(() => {
    if (!open || !proxyFocusRequested || !proxySubscriptionId) {
      return;
    }
    if (selectedSubscription && selectedSubscription.id === proxySubscriptionId) {
      return;
    }
    const preselected = subscriptions.find(sub => sub.id === proxySubscriptionId);
    if (!preselected) {
      return;
    }
    setSelectedSubscription(preselected);
    setSubscriptionInputValue(
      `${preselected.name}${preselected.state !== 'Enabled' ? ` (${preselected.state})` : ''}`
    );
  }, [open, proxyFocusRequested, proxySubscriptionId, selectedSubscription, subscriptions]);

  useEffect(() => {
    if (!open || !proxyFocusRequested || !selectedSubscription || selectedCluster) {
      return;
    }

    const matchesTargetSubscription =
      !proxySubscriptionId || selectedSubscription.id === proxySubscriptionId;

    if (!matchesTargetSubscription) {
      return;
    }

    if (proxyClusterName) {
      const matchingCluster = clusters.find(
        cluster =>
          (cluster.clusterType || 'aks') === 'aksarc' &&
          cluster.name === proxyClusterName &&
          (!proxyClusterResourceGroup || cluster.resourceGroup === proxyClusterResourceGroup) &&
          clusterInputValue !== cluster.name
      );
      if (matchingCluster) {
        setSelectedCluster(matchingCluster);
        setClusterInputValue(matchingCluster.name);
        return;
      }
    }

    const firstBareMetalCluster = clusters.find(
      cluster => (cluster.clusterType || 'aks') === 'aksarc'
    );
    if (firstBareMetalCluster && clusterInputValue !== firstBareMetalCluster.name) {
      setSelectedCluster(firstBareMetalCluster);
      setClusterInputValue(firstBareMetalCluster.name);
    }
  }, [
    open,
    proxyFocusRequested,
    selectedSubscription,
    selectedCluster,
    proxySubscriptionId,
    proxyClusterName,
    proxyClusterResourceGroup,
    clusters,
    clusterInputValue,
  ]);

  const loadSubscriptions = async () => {
    setLoadingSubscriptions(true);
    setError('');

    try {
      const result = await getSubscriptions();

      if (!result.success) {
        setError(result.message);
        return;
      }

      setSubscriptions(result.subscriptions || []);

      // Auto-select if only one subscription
      if (result.subscriptions && result.subscriptions.length === 1) {
        const sub = result.subscriptions[0];
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

  const filteredSubscriptions = React.useMemo(() => {
    return selectedSubscription
      ? subscriptions
      : rankNameMatches(subscriptions, subscriptionInputValue);
  }, [subscriptions, subscriptionInputValue, selectedSubscription]);

  const filteredClusters = React.useMemo(() => {
    return rankNameMatches(clusters, clusterInputValue);
  }, [clusters, clusterInputValue]);

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

  const handleRegister = async () => {
    if (!selectedCluster || !selectedSubscription) {
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
        selectedCluster.clusterType || 'aks'
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

      // Persist Azure metadata so cluster provider menu items can identify BareMetal clusters
      // and retrieve the subscription / resource group for proxy management.
      setClusterSettings(selectedCluster.name, {
        ...getClusterSettings(
          selectedCluster.name,
          selectedSubscription.id,
          selectedCluster.resourceGroup
        ),
        clusterType: selectedCluster.clusterType || 'aks',
        subscriptionId: selectedSubscription.id,
        resourceGroup: selectedCluster.resourceGroup,
      });

      if ((selectedCluster.clusterType || 'aks') === 'aksarc') {
        await refreshProxyStatus();
      }

      // Cluster capabilities are only available for AKS managed clusters.
      if ((selectedCluster.clusterType || 'aks') === 'aks') {
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
    if (
      selectedSubscription &&
      selectedCluster &&
      (selectedCluster.clusterType || 'aks') === 'aks'
    ) {
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
      clusters={clusters}
      filteredClusters={filteredClusters}
      selectedCluster={selectedCluster}
      clusterInputValue={clusterInputValue}
      capabilities={capabilities}
      onClose={handleClose}
      onSubscriptionChange={handleSubscriptionChange}
      onSubscriptionInputChange={handleSubscriptionInputChange}
      onClusterChange={handleClusterChange}
      onClusterInputChange={handleClusterInputChange}
      onRegister={handleRegister}
      onDone={handleDone}
      onDismissError={() => setError('')}
      onDismissSuccess={() => setSuccess('')}
      onConfigured={handleConfigured}
      proxyStatus={proxyStatus}
      proxyActionLoading={proxyActionLoading}
      proxyUiError={proxyUiError}
      onProxyRefresh={refreshProxyStatus}
      onProxyStart={handleProxyStart}
      onProxyStop={handleProxyStop}
      onProxyRestart={handleProxyRestart}
      proxyDropped={proxyDropped}
      onDismissProxyDropped={dismissProxyDropped}
    />
  );
}
