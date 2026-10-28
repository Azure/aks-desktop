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

/** Route configuration shared by the Home and selected-context entry points. */
export interface UpgradeInsightsPageProps {
  /** Enable registered-context candidate scoping and explicit ARM-resource disambiguation guidance. */
  requireClusterSelection?: boolean;
}

/**
 * Apply the desktop and preview gates before mounting any Azure account or inventory workflow.
 * @param props Route configuration; Home inventory is the default and needs no Kubernetes context.
 * @returns A disabled-feature notice or the Azure-authenticated readiness workflow.
 */
export default function UpgradeInsightsPage({
  requireClusterSelection = false,
}: UpgradeInsightsPageProps) {
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

/** Context-scoping policy carried through the Azure authentication boundary. */
interface AuthenticatedPageProps {
  /** Whether the route should narrow ARM candidates using registered Kubernetes-context metadata. */
  requireClusterSelection: boolean;
}

/**
 * Reset subscription/provider state on auth updates, including updates to the same Azure account.
 * @param props Route policy retained while account status is checked or login is required.
 * @returns Account-check progress, the native login link, or a fresh authenticated subscription session.
 */
function AuthenticatedPage({ requireClusterSelection }: AuthenticatedPageProps) {
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

/** Selection policy for one authenticated page session; no readiness data is persisted. */
interface SubscriptionSessionProps {
  /** Enable registered-context candidate scoping rather than unrestricted Home inventory browsing. */
  requireClusterSelection: boolean;
  /** Optional registration-settings key, never a substitute for an explicitly selected ARM ID. */
  contextName?: string;
}

/**
 * Discover subscriptions and create a provider only after the user explicitly applies a selection.
 * @param props Context policy scoped to the current account and route lifetime.
 * @returns Subscription selection, actionable discovery errors, and the selected provider's workspace.
 */
function SubscriptionSession({ requireClusterSelection, contextName }: SubscriptionSessionProps) {
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
