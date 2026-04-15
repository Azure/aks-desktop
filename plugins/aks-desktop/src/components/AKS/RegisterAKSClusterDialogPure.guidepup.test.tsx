// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Virtual screen-reader tests for {@link RegisterAKSClusterDialogPure}.
 *
 * Each test renders the component using the args from the corresponding
 * Storybook story so that the stories act as a single source of truth for
 * both the visual catalogue and the screen-reader announcement matrix.
 *
 * Uses `@guidepup/virtual-screen-reader` to walk the accessibility tree and
 * assert on the spoken phrases that a screen reader would announce.
 *
 * Also uses axe-core to validate WCAG compliance for each story state.
 *
 * Coverage:
 *  RegisterAKSClusterDialogPure
 *  ├── Default            — dialog landmark; heading; Subscription combobox; Cancel/Register buttons
 *  ├── NotLoggedIn        — warning alert; Register button disabled
 *  ├── CheckingAuth       — spinner + "Checking authentication status"; no combobox; no warning
 *  ├── LoadingSubscriptions — disabled combobox; loading status region
 *  ├── LoadingClusters    — loading status region with cluster loading text
 *  ├── NoClusters         — info alert "No AKS clusters found"
 *  ├── WithClusters       — Subscription + AKS Cluster comboboxes
 *  ├── ClusterSelected    — cluster details region; Register button enabled
 *  ├── Registering        — Register button busy + disabled; "Registering..."
 *  ├── Success            — success alert; Done button replaces Cancel/Register
 *  ├── Error              — error alert with message
 *  ├── CheckingCapabilities — loading status for capabilities
 *  ├── AllCapabilitiesEnabled — success alert for capabilities
 *  ├── RbacNotEnabled     — error alert for RBAC
 *  └── NoNetworkPolicy    — warning alert for network policy
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

vi.mock('../CreateAKSProject/components/ClusterConfigurePanel', () => ({
  ClusterConfigurePanel: () => <div data-testid="cluster-configure-panel">Configure Panel</div>,
}));

import type { RegisterAKSClusterDialogPureProps } from './RegisterAKSClusterDialogPure';
import RegisterAKSClusterDialogPure from './RegisterAKSClusterDialogPure';
import {
  AllCapabilitiesEnabled,
  CheckingAuth,
  CheckingCapabilities,
  ClusterSelected,
  Default,
  Error as ErrorStory,
  LoadingClusters,
  LoadingSubscriptions,
  NoClusters,
  NoNetworkPolicy,
  NotLoggedIn,
  RbacNotEnabled,
  Registering,
  Success,
  WithClusters,
} from './RegisterAKSClusterDialogPure.stories';

// ── Helpers ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  await virtual.stop();
  cleanup();
});

/**
 * Mount the dialog and start the virtual screen reader on document.body.
 * We use document.body because MUI Dialog renders into a portal.
 */
async function mount(overrides: Partial<RegisterAKSClusterDialogPureProps> = {}) {
  const args = { ...(Default.args as RegisterAKSClusterDialogPureProps), ...overrides };
  render(<RegisterAKSClusterDialogPure {...args} />);
  await virtual.start({ container: document.body });
}

/** Render story args without starting the screen reader (for axe tests). */
function renderStory(storyArgs: RegisterAKSClusterDialogPureProps) {
  render(<RegisterAKSClusterDialogPure {...storyArgs} />);
}

/** Collect all spoken phrases to "end of document". */
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
    rules: {
      // MUI Dialog uses aria-hidden on the backdrop; region rule can conflict with portals
      region: { enabled: false },
    },
  });
  return results.violations;
}

describe('Axe: RegisterAKSClusterDialogPure', () => {
  it('Default has no axe violations', async () => {
    renderStory(Default.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('NotLoggedIn has no axe violations', async () => {
    renderStory(NotLoggedIn.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('LoadingSubscriptions has no axe violations', async () => {
    renderStory(LoadingSubscriptions.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('ClusterSelected has no axe violations', async () => {
    renderStory(ClusterSelected.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('Registering has no axe violations', async () => {
    renderStory(Registering.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('Success has no axe violations', async () => {
    renderStory(Success.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('Error has no axe violations', async () => {
    renderStory(ErrorStory.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('AllCapabilitiesEnabled has no axe violations', async () => {
    renderStory(AllCapabilitiesEnabled.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('RbacNotEnabled has no axe violations', async () => {
    renderStory(RbacNotEnabled.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('NoNetworkPolicy has no axe violations', async () => {
    renderStory(NoNetworkPolicy.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });

  it('CheckingAuth has no axe violations', async () => {
    renderStory(CheckingAuth.args as RegisterAKSClusterDialogPureProps);
    const violations = await runAxe();
    expect(violations).toEqual([]);
  });
});

describe('SR: Default — dialog structure', () => {
  it('announces the dialog landmark', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('dialog') && p.includes('Register AKS Cluster'))).toBe(true);
  });

  it('announces the dialog heading "Register AKS Cluster"', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('heading') && p.includes('Register AKS Cluster'))).toBe(true);
  });

  it('announces the Subscription combobox', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('combobox') && p.includes('Subscription'))).toBe(true);
  });

  it('announces Cancel and Register Cluster buttons', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Cancel'))).toBe(true);
    expect(ps.some(p => p.includes('button') && p.includes('Register Cluster'))).toBe(true);
  });

  it('announces Register Cluster button as disabled (no cluster selected)', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('Register Cluster') && p.includes('disabled'))).toBe(true);
  });

  it('announces a polite status region', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p === 'status')).toBe(true);
  });

  it('does NOT announce decorative icons', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => /logos:microsoft-azure|mdi:cloud-check/.test(p))).toBe(false);
  });
});

describe('SR: NotLoggedIn — warning alert', () => {
  it('announces an alert region', async () => {
    await mount(NotLoggedIn.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps).toContain('end of alert');
  });

  it('announces the Azure login warning text', async () => {
    await mount(NotLoggedIn.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('logged in to Azure'))).toBe(true);
  });

  it('does not announce the Subscription combobox', async () => {
    await mount(NotLoggedIn.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('combobox') && p.includes('Subscription'))).toBe(false);
  });
});

describe('SR: CheckingAuth — checking authentication', () => {
  it('announces the status region with checking auth text', async () => {
    await mount(CheckingAuth.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Checking authentication status'))).toBe(true);
  });

  it('does not announce the not-logged-in warning', async () => {
    await mount(CheckingAuth.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('logged in to Azure'))).toBe(false);
  });

  it('does not announce the Subscription combobox', async () => {
    await mount(CheckingAuth.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('combobox') && p.includes('Subscription'))).toBe(false);
  });
});

describe('SR: LoadingSubscriptions — loading status', () => {
  it('announces the status region with loading subscriptions text', async () => {
    await mount(LoadingSubscriptions.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Loading subscriptions'))).toBe(true);
  });

  it('announces the Subscription combobox as disabled', async () => {
    await mount(LoadingSubscriptions.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(
      ps.some(p => p.includes('combobox') && p.includes('Subscription') && p.includes('disabled'))
    ).toBe(true);
  });
});

describe('SR: LoadingClusters — loading status', () => {
  it('announces the status region with loading clusters text', async () => {
    await mount(LoadingClusters.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Loading AKS clusters'))).toBe(true);
  });
});

describe('SR: NoClusters — info alert', () => {
  it('announces an alert region for no clusters found', async () => {
    await mount(NoClusters.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('No AKS clusters found'))).toBe(true);
  });
});

describe('SR: WithClusters — both comboboxes', () => {
  it('announces both Subscription and AKS Cluster comboboxes', async () => {
    await mount(WithClusters.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('combobox') && p.includes('Subscription'))).toBe(true);
    expect(ps.some(p => p.includes('combobox') && p.includes('AKS Cluster'))).toBe(true);
  });
});

describe('SR: ClusterSelected — cluster details region', () => {
  it('announces the Selected Cluster Details region', async () => {
    await mount(ClusterSelected.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('region') && p.includes('Selected Cluster Details'))).toBe(true);
  });

  it('announces cluster name within the details', async () => {
    await mount(ClusterSelected.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('prod-aks-cluster'))).toBe(true);
  });

  it('announces Register Cluster button as enabled', async () => {
    await mount(ClusterSelected.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    const registerBtn = ps.find(p => p.includes('Register Cluster') && p.includes('button'));
    expect(registerBtn).toBeDefined();
    expect(registerBtn).not.toMatch(/disabled/);
  });
});

describe('SR: Registering — busy register button', () => {
  it('announces the register button as busy and disabled', async () => {
    await mount(Registering.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Registering') && p.includes('busy'))).toBe(true);
  });

  it('announces "Registering..." text on the button', async () => {
    await mount(Registering.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Registering...'))).toBe(true);
  });

  it('announces Cancel button as disabled during registration', async () => {
    await mount(Registering.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Cancel') && p.includes('disabled'))).toBe(true);
  });
});

describe('SR: Success — success state', () => {
  it('announces an alert region with the success message', async () => {
    await mount(Success.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('successfully merged'))).toBe(true);
  });

  it('announces the Done button', async () => {
    await mount(Success.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Done'))).toBe(true);
  });

  it('does NOT announce Cancel or Register buttons in success state', async () => {
    await mount(Success.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Cancel'))).toBe(false);
    expect(ps.some(p => p.includes('button') && p.includes('Register Cluster'))).toBe(false);
  });
});

describe('SR: Error — error alert', () => {
  it('announces an alert region with the error message', async () => {
    await mount(ErrorStory.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('ECONNREFUSED'))).toBe(true);
  });
});

describe('SR: CheckingCapabilities — loading status', () => {
  it('announces the status region with capabilities loading text', async () => {
    await mount(CheckingCapabilities.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Checking cluster capabilities'))).toBe(true);
  });
});

describe('SR: AllCapabilitiesEnabled — success alert', () => {
  it('announces an alert with cluster configurations message', async () => {
    await mount(AllCapabilitiesEnabled.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('All recommended cluster configurations'))).toBe(true);
  });
});

describe('SR: RbacNotEnabled — error alert', () => {
  it('announces an alert with Azure RBAC warning text', async () => {
    await mount(RbacNotEnabled.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('Azure RBAC'))).toBe(true);
  });
});

describe('SR: NoNetworkPolicy — warning alert', () => {
  it('announces an alert with network policy warning text', async () => {
    await mount(NoNetworkPolicy.args as Partial<RegisterAKSClusterDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('No network policy engine'))).toBe(true);
  });
});
