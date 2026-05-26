// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import type { AKSCluster, Subscription } from '../../utils/azure/aks';
import { getAKSClusters, getSubscriptions } from '../../utils/azure/aks';
import BareMetalProxySettingsPagePure from './BareMetalProxySettingsPagePure';
import { useBareMetalProxy } from './useBareMetalProxy';

export default function BareMetalProxySettingsPage() {
  const { t } = useTranslation();
  const history = useHistory();
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [error, setError] = useState('');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [clusters, setClusters] = useState<AKSCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<AKSCluster | null>(null);
  const isMountedRef = useRef(true);

  const bareMetalProxyTarget = useMemo(() => {
    if (!selectedSubscription || !selectedCluster) {
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
    dismissProxyDropped,
    resetProxyState,
  } = useBareMetalProxy(true, bareMetalProxyTarget);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const loadSubscriptions = async () => {
      setLoadingSubscriptions(true);
      setError('');
      try {
        const result = await getSubscriptions();
        if (!isMountedRef.current) {
          return;
        }
        if (!result.success) {
          setError(result.message);
          return;
        }
        const list = result.subscriptions || [];
        setSubscriptions(list);
        if (list.length > 0) {
          setSelectedSubscription(list[0]);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(
            t('Failed to load subscriptions: {{message}}', {
              message: err instanceof Error ? err.message : t('Unknown error'),
            })
          );
        }
      } finally {
        if (isMountedRef.current) {
          setLoadingSubscriptions(false);
        }
      }
    };

    loadSubscriptions();
    // t is intentionally excluded: it is only used in error-path strings, and
    // the headlamp plugin i18n implementation returns a new t reference on every
    // render, which would turn this effect into an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadClusters = async () => {
      if (!selectedSubscription) {
        return;
      }
      setLoadingClusters(true);
      setError('');
      setSelectedCluster(null);
      setClusters([]);
      resetProxyState();

      try {
        const result = await getAKSClusters(selectedSubscription.id);
        if (!isMountedRef.current) {
          return;
        }
        if (!result.success) {
          setError(result.message);
          return;
        }
        const bareMetalClusters = (result.clusters || []).filter(
          cluster => (cluster.clusterType || 'aks') === 'aksarc'
        );
        setClusters(bareMetalClusters);
        if (bareMetalClusters.length > 0) {
          setSelectedCluster(bareMetalClusters[0]);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(
            t('Failed to load clusters: {{message}}', {
              message: err instanceof Error ? err.message : t('Unknown error'),
            })
          );
        }
      } finally {
        if (isMountedRef.current) {
          setLoadingClusters(false);
        }
      }
    };

    loadClusters();
    // t is intentionally excluded — see loadSubscriptions above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubscription, resetProxyState]);

  const handleOpenRegisterControls = () => {
    const params = new URLSearchParams({ focus: 'baremetal-proxy' });
    if (selectedSubscription) {
      params.set('subscription', selectedSubscription.id);
    }
    if (selectedCluster) {
      params.set('cluster', selectedCluster.name);
      params.set('resourceGroup', selectedCluster.resourceGroup);
    }
    history.push(`/add-cluster-aks?${params.toString()}`);
  };

  return (
    <BareMetalProxySettingsPagePure
      loadingSubscriptions={loadingSubscriptions}
      loadingClusters={loadingClusters}
      error={error}
      proxyUiError={proxyUiError}
      proxyDropped={proxyDropped}
      subscriptions={subscriptions}
      selectedSubscription={selectedSubscription}
      clusters={clusters}
      selectedCluster={selectedCluster}
      proxyStatus={proxyStatus}
      proxyActionLoading={proxyActionLoading}
      onSubscriptionChange={setSelectedSubscription}
      onClusterChange={value => {
        resetProxyState();
        setSelectedCluster(value);
      }}
      onProxyStart={handleProxyStart}
      onProxyStop={handleProxyStop}
      onProxyRestart={handleProxyRestart}
      onProxyRefresh={refreshProxyStatus}
      onDismissProxyDropped={dismissProxyDropped}
      onOpenRegisterControls={handleOpenRegisterControls}
      onBack={() => history.push('/azure/profile')}
    />
  );
}
