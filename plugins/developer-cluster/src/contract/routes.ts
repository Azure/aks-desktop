// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Plugin registration: the product name and the route contract. The plugin owns every route under
// `/developer-cluster` and registers exactly the pages below; the bare prefix is not a page. AKS
// Desktop owns the cluster and resource routes. Before installation, the plugin catalog is the
// discovery point.

/** Customer-facing product name; the sidebar label and the Overview heading. */
export const PRODUCT_DISPLAY_NAME = 'Developer Cluster';

/** The prefix of every plugin route; not itself registered. */
export const PLUGIN_ROOT_ROUTE = '/developer-cluster';

export const PLUGIN_ROUTES = {
  overview: `${PLUGIN_ROOT_ROUTE}/overview`,
  environment: `${PLUGIN_ROOT_ROUTE}/setup/environment`,
  configure: `${PLUGIN_ROOT_ROUTE}/setup/configure`,
  review: `${PLUGIN_ROOT_ROUTE}/setup/review`,
  create: `${PLUGIN_ROOT_ROUTE}/setup/create`,
} as const;

/** A page the plugin registers: Overview or one of the Setup steps. */
export type PluginRouteKey = keyof typeof PLUGIN_ROUTES;

export const PLUGIN_ROUTE_NAMES: Record<PluginRouteKey, string> = {
  overview: 'developer-cluster-overview',
  environment: 'developer-cluster-setup-environment',
  configure: 'developer-cluster-setup-configure',
  review: 'developer-cluster-setup-review',
  create: 'developer-cluster-setup-create',
};

/** The plugin's single top-level entry in the home sidebar. */
export const PLUGIN_SIDEBAR_ENTRY = 'developer-cluster-overview';

/**
 * AKS Desktop's standard cluster route, which View opens, by the cluster's list name.
 *
 * @param listName - The name AKS Desktop lists the cluster under.
 * @returns The route `/c/<listName>`, with the name URI-encoded.
 */
export function clusterRoute(listName: string): string {
  return `/c/${encodeURIComponent(listName)}`;
}
