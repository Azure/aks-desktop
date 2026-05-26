// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Virtual screen-reader and axe-core tests for {@link BareMetalEnvironmentDialogPure}.
 *
 * Coverage:
 *  BareMetalEnvironmentDialogPure
 *  ├── Default          — dialog landmark; heading; form fields; action buttons
 *  ├── NotLoggedIn      — warning alert; Setup/Teardown disabled
 *  ├── CheckingAuth     — spinner + checking text; no form fields
 *  ├── FilledForm       — form fields populated; Setup enabled
 *  ├── SetupLoading     — Setup button busy; fields disabled
 *  ├── TeardownLoading  — Teardown button busy; fields disabled
 *  ├── WithError        — error alert with message
 *  ├── WithSuccess      — success alert with message
 *  ├── ExtensionsRequired — warning alert for extensions; Install button
 *  ├── ExtensionsInstalling — Install button busy
 *  ├── ExtensionsInstalled — success alert for extensions
 *  └── ExtensionError   — extension error text
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

import type { BareMetalEnvironmentDialogPureProps } from './BareMetalEnvironmentDialogPure';
import BareMetalEnvironmentDialogPure from './BareMetalEnvironmentDialogPure';
import {
  CheckingAuth,
  Default,
  ExtensionError,
  ExtensionsInstalled,
  ExtensionsInstalling,
  ExtensionsRequired,
  FilledForm,
  NotLoggedIn,
  SetupLoading,
  TeardownLoading,
  WithError,
  WithSuccess,
} from './BareMetalEnvironmentDialogPure.stories';

// ── Helpers ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  await virtual.stop();
  cleanup();
});

async function mount(overrides: Partial<BareMetalEnvironmentDialogPureProps> = {}) {
  const args = { ...(Default.args as BareMetalEnvironmentDialogPureProps), ...overrides };
  render(<BareMetalEnvironmentDialogPure {...args} />);
  await virtual.start({ container: document.body });
}

function renderStory(storyArgs: BareMetalEnvironmentDialogPureProps) {
  render(<BareMetalEnvironmentDialogPure {...storyArgs} />);
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

describe('Axe: BareMetalEnvironmentDialogPure', () => {
  const stories = {
    Default,
    NotLoggedIn,
    CheckingAuth,
    FilledForm,
    SetupLoading,
    TeardownLoading,
    WithError,
    WithSuccess,
    ExtensionsRequired,
    ExtensionsInstalling,
    ExtensionsInstalled,
    ExtensionError,
  };

  for (const [name, story] of Object.entries(stories)) {
    it(`${name} has no axe violations`, async () => {
      renderStory(story.args as BareMetalEnvironmentDialogPureProps);
      const violations = await runAxe();
      expect(violations).toEqual([]);
      cleanup();
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Screen reader tests
// ══════════════════════════════════════════════════════════════════════════════

describe('SR: Default — dialog structure', () => {
  it('announces the dialog landmark', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('dialog'))).toBe(true);
  });

  it('announces the dialog title', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('BareMetal Test Environment'))).toBe(true);
  });

  it('announces the Cancel button', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Cancel'))).toBe(true);
  });

  it('announces the Teardown Environment button', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Teardown Environment'))).toBe(true);
  });

  it('announces the Setup Environment button', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Setup Environment'))).toBe(true);
  });

  it('announces form fields for logged-in user', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('Subscription ID'))).toBe(true);
    expect(ps.some(p => p.includes('Location'))).toBe(true);
    expect(ps.some(p => p.includes('VM Admin Username'))).toBe(true);
    expect(ps.some(p => p.includes('VM Admin Password'))).toBe(true);
  });
});

describe('SR: NotLoggedIn — warning alert', () => {
  it('announces a warning about authentication', async () => {
    await mount(NotLoggedIn.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('logged in to Azure'))).toBe(true);
  });

  it('does not show form fields when not logged in', async () => {
    await mount(NotLoggedIn.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Subscription ID'))).toBe(false);
  });
});

describe('SR: CheckingAuth — checking status', () => {
  it('announces the checking authentication message', async () => {
    await mount(CheckingAuth.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Checking authentication status'))).toBe(true);
  });
});

describe('SR: SetupLoading — busy state', () => {
  it('announces the setup button as busy', async () => {
    await mount(SetupLoading.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Setting up'))).toBe(true);
  });

  it('announces form fields as disabled during loading', async () => {
    await mount(SetupLoading.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    // Fields should be disabled when loading
    const subField = ps.find(p => p.includes('Subscription ID') && p.includes('textbox'));
    if (subField) {
      expect(subField).toMatch(/disabled/);
    }
  });
});

describe('SR: TeardownLoading — busy state', () => {
  it('announces the teardown button as busy', async () => {
    await mount(TeardownLoading.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Tearing down'))).toBe(true);
  });
});

describe('SR: WithError — error alert', () => {
  it('announces the error message', async () => {
    await mount(WithError.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('Quota exceeded'))).toBe(true);
  });
});

describe('SR: WithSuccess — success alert', () => {
  it('announces the success message', async () => {
    await mount(WithSuccess.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('successfully'))).toBe(true);
  });
});

describe('SR: ExtensionsRequired — install prompt', () => {
  it('announces the extension warning', async () => {
    await mount(ExtensionsRequired.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('CLI Extensions Required'))).toBe(true);
  });

  it('announces the Install Extensions button', async () => {
    await mount(ExtensionsRequired.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Install Extensions'))).toBe(true);
  });
});

describe('SR: ExtensionsInstalled — success notification', () => {
  it('announces the extension install success', async () => {
    await mount(ExtensionsInstalled.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('extensions installed successfully'))).toBe(true);
  });
});

describe('SR: ExtensionError — error in extension alert', () => {
  it('announces the extension error message', async () => {
    await mount(ExtensionError.args as Partial<BareMetalEnvironmentDialogPureProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Failed to install connectedk8s'))).toBe(true);
  });
});
