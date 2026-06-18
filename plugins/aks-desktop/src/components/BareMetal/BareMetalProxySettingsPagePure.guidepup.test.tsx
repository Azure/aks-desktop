// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Virtual screen-reader and axe-core tests for {@link BareMetalProxySettingsPagePure}.
 *
 * Coverage:
 *  BareMetalProxySettingsPagePure
 *  ├── Default             — page heading; subscription dropdown; cluster dropdown
 *  ├── LoadingSubscriptions — loading spinner in subscription field
 *  ├── LoadingClusters     — loading spinner in cluster field
 *  ├── NoClustersFound     — info alert when no clusters
 *  ├── ClusterSelected     — proxy panel rendered with stopped status
 *  ├── ProxyRunning        — proxy panel with running status and PID
 *  ├── ProxyError          — proxy panel with error alert
 *  ├── ProxyActionLoading  — proxy panel buttons disabled
 *  ├── ProxyDropped        — dropped proxy warning with recovery actions
 *  ├── WithError           — error alert for subscription/cluster failures
 *  ├── WithProxyUiError    — proxy-specific UI error
 *  └── NoSubscription      — empty subscription list; cluster disabled
 */

import '@testing-library/jest-dom/vitest';
import { virtual } from '@guidepup/virtual-screen-reader';
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('@kinvolk/headlamp-plugin/lib', async () => {
  const i18n = (await import('i18next')).default;
  const { initReactI18next, useTranslation } = await import('react-i18next');
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: {} } },
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
  }
  return { useTranslation };
});

vi.mock('@iconify/react', () => ({
  Icon: ({ icon, ...props }: any) => <span data-icon={icon} {...props} />,
}));

import type { BareMetalProxySettingsPagePureProps } from './BareMetalProxySettingsPagePure';
import BareMetalProxySettingsPagePure from './BareMetalProxySettingsPagePure';
import {
  ClusterSelected,
  Default,
  LoadingClusters,
  LoadingSubscriptions,
  NoClustersFound,
  NoSubscription,
  ProxyActionLoading,
  ProxyDropped,
  ProxyError,
  ProxyRunning,
  WithError,
  WithProxyUiError,
} from './BareMetalProxySettingsPagePure.stories';

// ── Helpers ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  await virtual.stop();
  cleanup();
});

async function mount(overrides: Partial<BareMetalProxySettingsPagePureProps> = {}) {
  const args = { ...(Default.args as BareMetalProxySettingsPagePureProps), ...overrides };
  render(<BareMetalProxySettingsPagePure {...args} />);
  await virtual.start({ container: document.body });
}

function renderStory(storyArgs: BareMetalProxySettingsPagePureProps) {
  render(<BareMetalProxySettingsPagePure {...storyArgs} />);
}

async function phrases(maxSteps = 300): Promise<string[]> {
  const log: string[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const p = await virtual.lastSpokenPhrase();
    log.push(p);
    if (p === 'end of document') break;
    await virtual.next();
  }
  return log;
}

async function runAxe() {
  const results = await axe.run(document.body, {
    rules: {
      region: { enabled: false },
    },
  });
  return results.violations;
}

// ══════════════════════════════════════════════════════════════════════════════
// Axe WCAG validation
// ══════════════════════════════════════════════════════════════════════════════

describe('Axe: BareMetalProxySettingsPagePure', () => {
  const stories = {
    Default,
    LoadingSubscriptions,
    LoadingClusters,
    NoClustersFound,
    ClusterSelected,
    ProxyRunning,
    ProxyError,
    ProxyActionLoading,
    ProxyDropped,
    WithError,
    WithProxyUiError,
    NoSubscription,
  };

  for (const [name, story] of Object.entries(stories)) {
    it(`${name} has no axe violations`, async () => {
      renderStory(story.args as BareMetalProxySettingsPagePureProps);
      const violations = await runAxe();
      expect(violations).toEqual([]);
      cleanup();
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Screen reader tests
// ══════════════════════════════════════════════════════════════════════════════

describe('SR: Default — page structure', () => {
  it('announces the page heading', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('BareMetal Proxy'))).toBe(true);
  });

  it('announces the Back button', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Back'))).toBe(true);
  });

  it('announces the subscription combobox', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('Subscription'))).toBe(true);
  });

  it('announces the cluster combobox', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('BareMetal cluster'))).toBe(true);
  });
});

describe('SR: NoClustersFound — info alert', () => {
  it('announces the no-clusters info alert', async () => {
    await mount(NoClustersFound.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('No BareMetal clusters found'))).toBe(true);
  });
});

describe('SR: ClusterSelected — proxy panel visible', () => {
  it('announces the proxy status region', async () => {
    await mount(ClusterSelected.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('STOPPED'))).toBe(true);
  });

  it('announces Start Proxy button', async () => {
    await mount(ClusterSelected.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Start Proxy'))).toBe(true);
  });
});

describe('SR: ProxyRunning — running status', () => {
  it('announces running status with PID', async () => {
    await mount(ProxyRunning.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('RUNNING'))).toBe(true);
    expect(ps.some(p => p.includes('PID 4242'))).toBe(true);
  });
});

describe('SR: ProxyDropped — recovery warning', () => {
  it('announces the proxy disconnected warning', async () => {
    await mount(ProxyDropped.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('BareMetal proxy disconnected'))).toBe(true);
  });

  it('announces recovery action buttons', async () => {
    await mount(ProxyDropped.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Restart Proxy'))).toBe(true);
    expect(ps.some(p => p.includes('Open Proxy Controls'))).toBe(true);
  });
});

describe('SR: WithError — error alert', () => {
  it('announces the error message', async () => {
    await mount(WithError.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('Network timeout'))).toBe(true);
  });
});

describe('SR: NoSubscription — disabled cluster dropdown', () => {
  it('does not show cluster options when no subscription is selected', async () => {
    await mount(NoSubscription.args as Partial<BareMetalProxySettingsPagePureProps>);
    const ps = await phrases();
    // Cluster combobox should be present but no proxy panel
    expect(ps.some(p => p.includes('Start Proxy'))).toBe(false);
  });
});
