// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Headlamp, K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
import {
  createUpgradeInsightsProvider,
  getUpgradeInsightSubscriptions,
  type UpgradeInsightSubscription,
} from '../../utils/azure/upgrade-insights';
import { errorMessage } from './domain';
import ReadinessWorkspace from './ReadinessWorkspace';

export default function UpgradeInsightsPage({
  requireClusterSelection = false,
}: {
  requireClusterSelection?: boolean;
}) {
  const { t } = useTranslation();
  const { upgradeInsights } = usePreviewFeatures();
  if (!Headlamp.isRunningAsApp() || !upgradeInsights) {
    return (
      <Alert severity="info">
        {t('Upgrade Insights is disabled. Enable it in AKS Desktop Preview Features settings.')}
      </Alert>
    );
  }
  return <AuthenticatedPage requireClusterSelection={requireClusterSelection} />;
}

function AuthenticatedPage({ requireClusterSelection }: { requireClusterSelection: boolean }) {
  const { t } = useTranslation();
  const auth = useAzureAuth();
  const contextName = K8s.useCluster();
  const { pathname } = useLocation();
  const [authChanging, setAuthChanging] = useState(false);
  const previousAuth = useRef(auth);

  useEffect(() => {
    // Hide and unmount the provider immediately, before the asynchronous auth check finishes.
    const invalidate = () => setAuthChanging(true);
    window.addEventListener('azure-auth-update', invalidate);
    return () => window.removeEventListener('azure-auth-update', invalidate);
  }, []);
  useEffect(() => {
    if (previousAuth.current !== auth) {
      previousAuth.current = auth;
      setAuthChanging(false);
    }
  }, [auth]);

  if (auth.isChecking || authChanging) {
    return <CircularProgress aria-label={t('Checking Azure account')} />;
  }
  if (!auth.isLoggedIn) {
    return (
      <Stack spacing={2}>
        <Alert severity="info">{t('Sign in to Azure to view Upgrade Insights.')}</Alert>
        {auth.error && <Alert severity="error">{auth.error}</Alert>}
        <Button component={RouterLink} to="/azure/login">
          {t('Sign in to Azure')}
        </Button>
      </Stack>
    );
  }
  return (
    <SubscriptionSession
      key={`${auth.username}/${auth.tenantId}/${auth.subscriptionId}/${pathname}/${
        requireClusterSelection ? contextName : ''
      }`}
      requireClusterSelection={requireClusterSelection}
      contextName={requireClusterSelection ? contextName ?? undefined : undefined}
    />
  );
}

function SubscriptionSession({
  requireClusterSelection,
  contextName,
}: {
  requireClusterSelection: boolean;
  contextName?: string;
}) {
  const { t } = useTranslation();
  const [subscriptions, setSubscriptions] = useState<UpgradeInsightSubscription[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [applied, setApplied] = useState<UpgradeInsightSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const provider = useMemo(
    () => (applied.length ? createUpgradeInsightsProvider(applied) : undefined),
    [applied]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getUpgradeInsightSubscriptions()
      .then(items => {
        if (active) setSubscriptions(items);
      })
      .catch(error => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);

  const selectionChanged =
    [...selectedIds].sort().join(',') !==
    applied
      .map(s => s.id)
      .sort()
      .join(',');

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h4">{t('Upgrade Insights (Preview)')}</Typography>
        <Alert severity="info">
          {t(
            'Live Azure data. Stored evaluations are snapshots, not a guarantee of upgrade success. Generating an insight stores an evaluation; it never upgrades a cluster.'
          )}
        </Alert>
        <Typography variant="h6">{t('Choose subscriptions')}</Typography>
        <Typography variant="body2">
          {t(
            'Only explicitly selected subscriptions are queried. No Kubernetes context is required.'
          )}
        </Typography>
        {loading && <CircularProgress aria-label={t('Loading subscriptions')} />}
        {error && (
          <Alert
            severity="error"
            action={<Button onClick={() => setRetry(n => n + 1)}>{t('Retry')}</Button>}
          >
            {t('Could not load subscriptions: {{error}}', { error })}
          </Alert>
        )}
        {!loading && !error && !subscriptions.length && (
          <Alert severity="warning">{t('No enabled Azure subscriptions are available.')}</Alert>
        )}
        <Stack direction="row" flexWrap="wrap">
          {subscriptions.map(subscription => (
            <FormControlLabel
              key={subscription.id}
              control={
                <Checkbox
                  disabled={busy}
                  checked={selectedIds.includes(subscription.id)}
                  onChange={(_, checked) =>
                    setSelectedIds(ids =>
                      checked ? [...ids, subscription.id] : ids.filter(id => id !== subscription.id)
                    )
                  }
                />
              }
              label={`${subscription.name} (${subscription.id})`}
            />
          ))}
        </Stack>
        <Button
          variant="contained"
          disabled={busy || loading || !selectedIds.length || !selectionChanged}
          onClick={() => setApplied(subscriptions.filter(s => selectedIds.includes(s.id)))}
        >
          {t('Load selected subscriptions')}
        </Button>
        {provider && (
          <ReadinessWorkspace
            key={applied.map(s => s.id).join(',')}
            provider={provider}
            requireClusterSelection={requireClusterSelection}
            contextName={contextName}
            onBusyChange={setBusy}
          />
        )}
      </Stack>
    </Box>
  );
}
