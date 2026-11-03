// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Headlamp, K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Stack, Typography } from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
import {
  createUpgradeInsightsProvider,
  getUpgradeInsightSubscriptions,
  type UpgradeInsightSubscription,
} from '../../utils/azure/upgrade-insights';
import { errorMessage } from './domain';
import ReadinessWorkspace from './ReadinessWorkspace';
import SessionNotice from './SessionNotice';
import SubscriptionSelection from './SubscriptionSelection';

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
  const { upgradeInsights } = usePreviewFeatures();
  if (!Headlamp.isRunningAsApp() || !upgradeInsights) {
    return <SessionNotice state="disabled" />;
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
  const auth = useAzureAuth();
  const contextName = K8s.useCluster();
  const { pathname } = useLocation();
  const [authChanging, setAuthChanging] = useState(false);
  const previousAuth = useRef(auth);

  useEffect(() => {
    // Hide and unmount the provider immediately, before the asynchronous auth check finishes.
    const invalidate = () => setAuthChanging(true);
    window.addEventListener('azure-auth-update', invalidate);
    window.addEventListener('azure-account-change', invalidate);
    return () => {
      window.removeEventListener('azure-auth-update', invalidate);
      window.removeEventListener('azure-account-change', invalidate);
    };
  }, []);
  useEffect(() => {
    if (previousAuth.current !== auth) {
      previousAuth.current = auth;
      setAuthChanging(false);
    }
  }, [auth]);

  if (auth.isChecking || authChanging) {
    return <SessionNotice state="checking" />;
  }
  if (!auth.isLoggedIn) {
    return <SessionNotice state="signedOut" error={auth.error} />;
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
        <SubscriptionSelection
          subscriptions={subscriptions}
          selectedIds={selectedIds}
          loading={loading}
          error={error}
          busy={busy}
          selectionChanged={selectionChanged}
          onSelectionChange={setSelectedIds}
          onRetry={() => setRetry(n => n + 1)}
          onApply={() => setApplied(subscriptions.filter(s => selectedIds.includes(s.id)))}
        />
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
