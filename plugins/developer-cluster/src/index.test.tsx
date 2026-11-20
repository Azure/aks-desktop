// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Plugin registration (src/index.tsx). The plugin registers while its module loads, so this file
// loads it once with Headlamp's library mocked and keeps the calls it made before any test runs.
// The mock has no Add Cluster provider registration, so the plugin would fail to load here if it
// added one.

import './index';
import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './components/Overview/OverviewPage';
import { ConfigureStep } from './components/Setup/ConfigureStep';
import { CreateStep } from './components/Setup/CreateStep';
import { EnvironmentStep } from './components/Setup/EnvironmentStep';
import { ReviewStep } from './components/Setup/ReviewStep';
import type { PluginRouteKey } from './contract/routes';
import {
  PLUGIN_ROOT_ROUTE,
  PLUGIN_ROUTE_NAMES,
  PLUGIN_ROUTES,
  PLUGIN_SIDEBAR_ENTRY,
} from './contract/routes';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  registerRoute: vi.fn(),
  registerSidebarEntry: vi.fn(),
  registerClusterProviderDialog: vi.fn(),
  registerClusterProviderDeleteHandler: vi.fn(),
}));
// The pages are imported but never rendered, so Headlamp's components are not loaded.
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({}));

/** The sidebar entries the plugin registered while it loaded. */
const SIDEBAR_CALLS = vi.mocked(registerSidebarEntry).mock.calls.slice();

/** The routes the plugin registered while it loaded. */
const ROUTE_CALLS = vi.mocked(registerRoute).mock.calls.slice();

/** Every registered route, in registration order. */
const ROUTES = ROUTE_CALLS.map(([route]) => route);

/** The path of every registered route, in registration order. */
const ROUTE_PATHS: string[] = ROUTES.map(route => route.path);

/** The key of every plugin route in the contract. */
const ROUTE_KEYS = Object.keys(PLUGIN_ROUTES) as PluginRouteKey[];

/** Every lifecycle page with its route path and name, in registration order. */
const EXPECTED_ROUTES: readonly [string, string, unknown][] = [
  ['/developer-cluster/overview', 'developer-cluster-overview', OverviewPage],
  ['/developer-cluster/setup/environment', 'developer-cluster-setup-environment', EnvironmentStep],
  ['/developer-cluster/setup/configure', 'developer-cluster-setup-configure', ConfigureStep],
  ['/developer-cluster/setup/review', 'developer-cluster-setup-review', ReviewStep],
  ['/developer-cluster/setup/create', 'developer-cluster-setup-create', CreateStep],
];

describe('plugin registration', () => {
  it('adds one top-level entry to the home sidebar', () => {
    expect(SIDEBAR_CALLS).toStrictEqual([
      [
        {
          name: 'developer-cluster-overview',
          label: 'Developer Cluster',
          url: '/developer-cluster/overview',
          useClusterURL: false,
          icon: 'mdi:desktop-tower',
          sidebar: 'HOME',
        },
      ],
    ]);
  });

  it('registers each lifecycle page on its exact route, outside any cluster', () => {
    expect(ROUTE_CALLS).toStrictEqual(
      EXPECTED_ROUTES.map(([path, name, component]) => [
        {
          path,
          name,
          sidebar: { item: 'developer-cluster-overview', sidebar: 'HOME' },
          exact: true,
          useClusterURL: false,
          noAuthRequired: true,
          component,
        },
      ])
    );
  });

  it('registers every plugin route once, not the bare prefix, and no cluster route', () => {
    expect([...ROUTE_PATHS].sort()).toStrictEqual(Object.values(PLUGIN_ROUTES).sort());
    expect(new Set(ROUTE_PATHS).size).toBe(ROUTE_PATHS.length);
    expect(ROUTE_PATHS).not.toContain(PLUGIN_ROOT_ROUTE);
    for (const path of ROUTE_PATHS) {
      expect(path.startsWith(`${PLUGIN_ROOT_ROUTE}/`)).toBe(true);
      expect(path.startsWith('/c/')).toBe(false);
    }
  });

  it.each(ROUTE_KEYS)('names the %s route from the contract', key => {
    const matches = ROUTES.filter(route => route.path === PLUGIN_ROUTES[key]);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe(PLUGIN_ROUTE_NAMES[key]);
    expect(matches[0].sidebar).toStrictEqual({ item: PLUGIN_SIDEBAR_ENTRY, sidebar: 'HOME' });
  });

  it('opens Overview from a sidebar entry that needs no Desktop parent', () => {
    const [[entry]] = SIDEBAR_CALLS;
    expect(entry).not.toHaveProperty('parent');
    expect(entry).toMatchObject({ name: PLUGIN_SIDEBAR_ENTRY, url: PLUGIN_ROUTES.overview });
    expect(ROUTE_PATHS).toContain(entry.url);
  });
});
