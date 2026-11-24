// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Plugin registration. The plugin adds one top-level home sidebar entry, so Overview appears
// whenever the plugin is installed, and owns every route under `/developer-cluster`. Its entry and
// lifecycle routes live outside any cluster URL and need no cluster authentication. Headlamp
// evaluates plugin routes before its own, in registration order; every route here is exact.
// Headlamp shows a route's name as the window title, so the names stay stable identifiers. There is
// no Add Cluster provider yet. For AKS Desktop's local context the plugin takes over Delete in the
// cluster menu and opens its confirmation dialog.
//

import {
  registerClusterProviderDeleteHandler,
  registerClusterProviderDialog,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { ReactNode } from 'react';
import {
  ClusterMenuDeleteDialog,
  LOCAL_DELETE_HANDLER,
} from './components/Cluster/ClusterMenuDelete';
import { OverviewPage } from './components/Overview/OverviewPage';
import { ConfigureStep } from './components/Setup/ConfigureStep';
import { CreateStep } from './components/Setup/CreateStep';
import { EnvironmentStep } from './components/Setup/EnvironmentStep';
import { ReviewStep } from './components/Setup/ReviewStep';
import {
  PLUGIN_ROUTE_NAMES,
  PLUGIN_ROUTES,
  PLUGIN_SIDEBAR_ENTRY,
  PluginRouteKey,
  PRODUCT_DISPLAY_NAME,
} from './contract/routes';

// Headlamp's top-level sidebar, which holds the plugin's entry.
const HOME_SIDEBAR = 'HOME';

const PAGES: Record<PluginRouteKey, () => ReactNode> = {
  overview: OverviewPage,
  environment: EnvironmentStep,
  configure: ConfigureStep,
  review: ReviewStep,
  create: CreateStep,
};

registerSidebarEntry({
  name: PLUGIN_SIDEBAR_ENTRY,
  label: PRODUCT_DISPLAY_NAME,
  url: PLUGIN_ROUTES.overview,
  useClusterURL: false,
  icon: 'mdi:desktop-tower',
  sidebar: HOME_SIDEBAR,
});

for (const key of Object.keys(PAGES) as PluginRouteKey[]) {
  registerRoute({
    path: PLUGIN_ROUTES[key],
    name: PLUGIN_ROUTE_NAMES[key],
    sidebar: { item: PLUGIN_SIDEBAR_ENTRY, sidebar: HOME_SIDEBAR },
    exact: true,
    useClusterURL: false,
    noAuthRequired: true,
    component: PAGES[key],
  });
}

registerClusterProviderDialog(ClusterMenuDeleteDialog);
// AKS Desktop patch 8519 adds the handler API. Without it, Headlamp's Delete only removes the
// kubeconfig entry, so the plugin still loads and its Overview keeps the CLI Delete.
if (typeof registerClusterProviderDeleteHandler === 'function') {
  registerClusterProviderDeleteHandler(LOCAL_DELETE_HANDLER);
}
