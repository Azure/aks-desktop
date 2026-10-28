// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUpgradeInsights } from './navigation';

const mocks = vi.hoisted(() => ({
  app: true,
  enabled: false,
  route: vi.fn(),
  sidebar: vi.fn(),
  filter: vi.fn(),
  appbar: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  Headlamp: { isRunningAsApp: () => mocks.app },
  registerRoute: mocks.route,
  registerSidebarEntry: mocks.sidebar,
  registerSidebarEntryFilter: mocks.filter,
  registerAppBarAction: mocks.appbar,
  useTranslation: () => ({ t: (text: string) => text }),
}));
vi.mock('../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ upgradeInsights: mocks.enabled }),
}));
vi.mock('../PluginSettings/previewFeaturesStore', () => ({
  previewFeaturesStore: { get: () => ({ upgradeInsights: mocks.enabled }) },
}));
vi.mock('../TelemetryErrorBoundary', () => ({
  TelemetryErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./UpgradeInsightsPage', () => ({ default: () => <div /> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.app = true;
  mocks.enabled = false;
});
afterEach(cleanup);

describe('native route registration', () => {
  it('does not register Azure UI in the browser build', () => {
    mocks.app = false;
    registerUpgradeInsights();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.appbar).not.toHaveBeenCalled();
  });
  it('registers global HOME without a Kubernetes context and a cluster route', () => {
    registerUpgradeInsights();
    expect(mocks.route).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/azure/upgrade-insights',
        useClusterURL: false,
        noAuthRequired: true,
        sidebar: { sidebar: 'HOME', item: 'upgrade-insights-home' },
      })
    );
    expect(mocks.route).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/upgrade-insights',
        sidebar: 'upgrade-insights-cluster',
      })
    );
  });
  it('hides both sidebar entries while disabled and re-evaluates live preview changes', () => {
    registerUpgradeInsights();
    const filter = mocks.filter.mock.calls[0][0];
    expect(filter({ name: 'upgrade-insights-home' })).toBeNull();
    expect(filter({ name: 'upgrade-insights-cluster' })).toBeNull();
    expect(filter({ name: 'azure-profile' })).toEqual({ name: 'azure-profile' });
    const Navigation = mocks.appbar.mock.calls[0][0];
    const view = render(<Navigation />);
    const before = mocks.sidebar.mock.calls.length;
    mocks.enabled = true;
    view.rerender(<Navigation />);
    expect(mocks.sidebar.mock.calls.length).toBeGreaterThan(before);
    expect(filter({ name: 'upgrade-insights-home' })).toEqual({ name: 'upgrade-insights-home' });
  });
});
