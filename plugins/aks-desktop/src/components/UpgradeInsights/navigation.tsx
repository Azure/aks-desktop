// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  Headlamp,
  registerAppBarAction,
  registerHomeSidebarEntryFilter,
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

/**
 * Synchronize translated sidebar entries when preview configuration changes during a session.
 * @returns Null; this app-bar registration supplies no visible app-bar control.
 */
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

/**
 * Register desktop-only Home/context routes and their separate live preview-aware sidebar filters.
 * @returns No value; browser deployments receive no registrations.
 */
export function registerUpgradeInsights() {
  if (!Headlamp.isRunningAsApp()) return;
  const filter: Parameters<typeof registerSidebarEntryFilter>[0] = entry =>
    entry.name.startsWith('upgrade-insights-') && !previewFeaturesStore.get()?.upgradeInsights
      ? null
      : entry;
  registerSidebarEntryFilter(filter);
  registerHomeSidebarEntryFilter(filter);
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
