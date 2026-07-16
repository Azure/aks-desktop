// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Virtual screen-reader + axe-core a11y tests for the AKS Hybrid & Edge proxy
 * controls: {@link AksHybridEdgeProxyMenuItem} (the cluster action-menu item) and
 * {@link AksHybridEdgeProxyStartDialog} (the connect dialog).
 *
 * Components are rendered directly with props (their reachability/start
 * side-effects are mocked) — mirroring the direct-render a11y tests under
 * `CreateAKSProject/__a11y__`.
 *
 * Coverage:
 *  AksHybridEdgeProxyMenuItem
 *  ├── probing   — disabled "Checking AKS Hybrid & Edge proxy…" menuitem
 *  ├── reachable — "Stop AKS Hybrid & Edge proxy" menuitem
 *  ├── offline   — "Start AKS Hybrid & Edge proxy" menuitem
 *  └── non-aksarc — renders nothing (no menuitem announced)
 *  AksHybridEdgeProxyStartDialog
 *  ├── error phase — labelled dialog; error alert; Close/Retry buttons
 *  └── done phase  — success alert; Reload button
 */

import '@testing-library/jest-dom/vitest';
import { virtual } from '@guidepup/virtual-screen-reader';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must live in the test file so Vitest can hoist them) ───────────────
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

const mockCheckClusterReachable = vi.hoisted(() => vi.fn());
const mockStartProxy = vi.hoisted(() => vi.fn());
const mockStopProxy = vi.hoisted(() => vi.fn());
const mockVerify = vi.hoisted(() => vi.fn());
const mockGetClusterSettings = vi.hoisted(() => vi.fn());
const mockMarkAppearance = vi.hoisted(() => vi.fn());

vi.mock('../../utils/azure/aksHybridEdgeProxy', () => ({
  azurePortalClusterUrl: () => 'https://portal.azure.com/#@/resource/x/overview',
  checkClusterReachable: mockCheckClusterReachable,
  startProxy: mockStartProxy,
  stopProxy: mockStopProxy,
  verifyAksHybridEdgeCluster: mockVerify,
}));

vi.mock('../../utils/shared/clusterSettings', () => ({
  getClusterSettings: mockGetClusterSettings,
  markAksHybridEdgeAppearance: mockMarkAppearance,
}));

vi.mock('../../utils/shared/openExternalUrl', () => ({
  openExternalUrl: vi.fn(),
}));

import {
  AksHybridEdgeProxyMenuItem,
  AksHybridEdgeProxyStartDialog,
} from './AksHybridEdgeProxyControls';

const START_DIALOG_ID = 'aks-hybrid-edge-proxy-start';
const AKSARC_SETTINGS = { clusterType: 'aksarc', subscriptionId: 'sub-a', resourceGroup: 'rg-a' };
const CLUSTER = { name: 'edge-1' };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect all spoken phrases to "end of document" (bounded to avoid loops). */
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

/** Run axe-core on the rendered document and return violations. */
async function runAxe() {
  const results = await axe.run(document.body, {
    // MUI Dialog uses aria-hidden on the backdrop; the region rule conflicts with portals.
    rules: { region: { enabled: false } },
  });
  return results.violations;
}

/** Render the menu item inside a menu (its real context) and wait for its label. */
function renderMenuItem() {
  return render(
    <ul role="menu">
      <AksHybridEdgeProxyMenuItem
        cluster={CLUSTER}
        handleMenuClose={() => {}}
        setOpenConfirmDialog={() => {}}
      />
    </ul>
  );
}

function renderDialog() {
  return render(
    <AksHybridEdgeProxyStartDialog
      cluster={CLUSTER}
      openConfirmDialog={START_DIALOG_ID}
      setOpenConfirmDialog={() => {}}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks(); // reset call history between tests (implementations set per test)
});

afterEach(async () => {
  try {
    await virtual.stop();
  } catch {
    // virtual may not have been started (axe-only tests) — ignore.
  }
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════
// AksHybridEdgeProxyMenuItem — screen reader
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: AksHybridEdgeProxyMenuItem', () => {
  it('announces a disabled "Checking…" item while probing reachability', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockCheckClusterReachable.mockReturnValue(new Promise(() => {})); // never resolves

    renderMenuItem();
    await screen.findByText('Checking AKS Hybrid & Edge proxy…');
    await virtual.start({ container: document.body });
    const ps = await phrases();

    expect(ps.some(p => /Checking AKS Hybrid & Edge proxy/i.test(p))).toBe(true);
    expect(ps.some(p => /disabled/i.test(p))).toBe(true);
  });

  it('announces "Stop AKS Hybrid & Edge proxy" when the cluster is reachable', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockCheckClusterReachable.mockResolvedValue({ success: true });

    renderMenuItem();
    await screen.findByText('Stop AKS Hybrid & Edge proxy');
    await virtual.start({ container: document.body });
    const ps = await phrases();

    expect(ps.some(p => /Stop AKS Hybrid & Edge proxy/i.test(p))).toBe(true);
    expect(ps.some(p => /disabled/i.test(p))).toBe(false);
  });

  it('announces "Start AKS Hybrid & Edge proxy" when the cluster is not reachable', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockCheckClusterReachable.mockResolvedValue({ success: false });

    renderMenuItem();
    await screen.findByText('Start AKS Hybrid & Edge proxy');
    await virtual.start({ container: document.body });
    const ps = await phrases();

    expect(ps.some(p => /Start AKS Hybrid & Edge proxy/i.test(p))).toBe(true);
  });

  it('renders nothing (no menuitem) for a non-AKS-Hybrid-&-Edge cluster', async () => {
    mockGetClusterSettings.mockReturnValue({}); // no clusterType
    renderMenuItem();
    await virtual.start({ container: document.body });
    const ps = await phrases();

    expect(ps.every(p => !/AKS Hybrid & Edge proxy/i.test(p))).toBe(true);
    expect(mockCheckClusterReachable).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AksHybridEdgeProxyStartDialog — screen reader
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: AksHybridEdgeProxyStartDialog', () => {
  it('labels the dialog and announces the error alert + Retry on start failure', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockStartProxy.mockResolvedValue({ success: false, error: 'Proxy failed to start' });

    renderDialog();
    await screen.findByText('Proxy failed to start');
    await virtual.start({ container: document.body });
    const ps = await phrases();

    // Dialog is a labelled landmark carrying its title.
    expect(ps.some(p => /dialog/i.test(p))).toBe(true);
    expect(ps.some(p => /Connect AKS Hybrid & Edge cluster/i.test(p))).toBe(true);
    // Error is exposed via an alert and the Retry affordance is reachable.
    expect(ps.some(p => /Proxy failed to start/i.test(p))).toBe(true);
    expect(ps.some(p => /button, Retry/i.test(p))).toBe(true);
  });

  it('announces the success alert + Reload button once connected', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockStartProxy.mockResolvedValue({ success: true });
    mockVerify.mockResolvedValue({ success: true, inKubeconfig: true, reachable: true });

    renderDialog();
    await screen.findByText(/Connected to/);
    await virtual.start({ container: document.body });
    const ps = await phrases();

    expect(ps.some(p => /Connected to/i.test(p))).toBe(true);
    expect(ps.some(p => /button, Reload/i.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Axe (WCAG) — key states
// ═══════════════════════════════════════════════════════════════════════════
describe('Axe: AKS Hybrid & Edge proxy controls', () => {
  it('Start menu item has no axe violations', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockCheckClusterReachable.mockResolvedValue({ success: false });
    renderMenuItem();
    await screen.findByText('Start AKS Hybrid & Edge proxy');
    expect(await runAxe()).toEqual([]);
  });

  it('dialog error phase has no axe violations', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockStartProxy.mockResolvedValue({ success: false, error: 'Proxy failed to start' });
    renderDialog();
    await screen.findByText('Proxy failed to start');
    expect(await runAxe()).toEqual([]);
  });

  it('dialog success phase has no axe violations', async () => {
    mockGetClusterSettings.mockReturnValue(AKSARC_SETTINGS);
    mockStartProxy.mockResolvedValue({ success: true });
    mockVerify.mockResolvedValue({ success: true, inKubeconfig: true, reachable: true });
    renderDialog();
    await screen.findByText(/Connected to/);
    expect(await runAxe()).toEqual([]);
  });
});
