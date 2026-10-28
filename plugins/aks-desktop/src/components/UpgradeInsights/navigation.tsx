// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  Headlamp,
  registerAppBarAction,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
  useTranslation,
} from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect } from 'react';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
import { previewFeaturesStore } from '../PluginSettings/previewFeaturesStore';
import { TelemetryErrorBoundary } from '../TelemetryErrorBoundary';
import UpgradeInsightsPage from './UpgradeInsightsPage';

function NavigationSync() {
  const { t } = useTranslation();
  const { upgradeInsights } = usePreviewFeatures();
  useEffect(() => {
    // Re-registering the same names updates the sidebar store on a live config change.
    registerSidebarEntry({
      name: 'upgrade-insights-home',
      label: t('Upgrade Insights'),
      url: '/azure/upgrade-insights',
      icon: 'mdi:shield-check-outline',
      parent: null,
      sidebar: 'HOME',
      useClusterURL: false,
    });
    registerSidebarEntry({
      name: 'upgrade-insights-cluster',
      label: t('Upgrade Insights'),
      url: '/upgrade-insights',
      icon: 'mdi:shield-check-outline',
      parent: null,
    });
  }, [upgradeInsights, t]);
  return null;
}

export function registerUpgradeInsights() {
  if (!Headlamp.isRunningAsApp()) return;
  registerSidebarEntryFilter(entry =>
    entry.name.startsWith('upgrade-insights-') && !previewFeaturesStore.get()?.upgradeInsights
      ? null
      : entry
  );
  registerAppBarAction(() => <NavigationSync />);
  registerRoute({
    path: '/azure/upgrade-insights',
    name: 'Upgrade Insights',
    component: () => (
      <TelemetryErrorBoundary>
        <UpgradeInsightsPage />
      </TelemetryErrorBoundary>
    ),
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
    sidebar: { sidebar: 'HOME', item: 'upgrade-insights-home' },
  });
  registerRoute({
    path: '/upgrade-insights',
    name: 'Cluster Upgrade Insights',
    component: () => (
      <TelemetryErrorBoundary>
        <UpgradeInsightsPage requireClusterSelection />
      </TelemetryErrorBoundary>
    ),
    exact: true,
    noAuthRequired: true,
    sidebar: 'upgrade-insights-cluster',
  });
}
