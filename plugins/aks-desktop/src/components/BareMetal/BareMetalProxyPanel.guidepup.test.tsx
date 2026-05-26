// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Virtual screen-reader and axe-core tests for {@link BareMetalProxyPanel}.
 *
 * Coverage:
 *  BareMetalProxyPanel
 *  ├── Unknown        — unknown status; buttons enabled
 *  ├── Stopped        — STOPPED status; buttons enabled
 *  ├── Running        — RUNNING status with PID
 *  ├── ErrorState     — error alert with message
 *  ├── ActionLoading  — buttons disabled during action
 *  └── Disabled       — all buttons disabled
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

import type { BareMetalProxyPanelProps } from './BareMetalProxyPanel';
import BareMetalProxyPanel from './BareMetalProxyPanel';
import {
  ActionLoading,
  Disabled,
  ErrorState,
  Running,
  Stopped,
  Unknown,
} from './BareMetalProxyPanel.stories';

// ── Helpers ──────────────────────────────────────────────────────────────────

afterEach(async () => {
  await virtual.stop();
  cleanup();
});

async function mount(overrides: Partial<BareMetalProxyPanelProps> = {}) {
  const args = { ...(Unknown.args as BareMetalProxyPanelProps), ...overrides };
  render(<BareMetalProxyPanel {...args} />);
  await virtual.start({ container: document.body });
}

function renderStory(storyArgs: BareMetalProxyPanelProps) {
  render(<BareMetalProxyPanel {...storyArgs} />);
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

describe('Axe: BareMetalProxyPanel', () => {
  const stories = { Unknown, Stopped, Running, ErrorState, ActionLoading, Disabled };

  for (const [name, story] of Object.entries(stories)) {
    it(`${name} has no axe violations`, async () => {
      renderStory(story.args as BareMetalProxyPanelProps);
      const violations = await runAxe();
      expect(violations).toEqual([]);
      cleanup();
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Screen reader tests
// ══════════════════════════════════════════════════════════════════════════════

describe('SR: Unknown — default state', () => {
  it('announces the Proxy label', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('Proxy'))).toBe(true);
  });

  it('announces Unknown status', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('Unknown'))).toBe(true);
  });

  it('announces all proxy action buttons', async () => {
    await mount();
    const ps = await phrases();
    expect(ps.some(p => p.includes('button') && p.includes('Start Proxy'))).toBe(true);
    expect(ps.some(p => p.includes('button') && p.includes('Stop Proxy'))).toBe(true);
    expect(ps.some(p => p.includes('button') && p.includes('Restart Proxy'))).toBe(true);
    expect(ps.some(p => p.includes('button') && p.includes('Refresh Status'))).toBe(true);
  });
});

describe('SR: Stopped — stopped status', () => {
  it('announces STOPPED status', async () => {
    await mount(Stopped.args as Partial<BareMetalProxyPanelProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('STOPPED'))).toBe(true);
  });
});

describe('SR: Running — running status with PID', () => {
  it('announces RUNNING status and PID', async () => {
    await mount(Running.args as Partial<BareMetalProxyPanelProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('RUNNING'))).toBe(true);
    expect(ps.some(p => p.includes('PID 4242'))).toBe(true);
  });
});

describe('SR: ErrorState — error alert', () => {
  it('announces the error alert', async () => {
    await mount(ErrorState.args as Partial<BareMetalProxyPanelProps>);
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => p.includes('Unable to reach BareMetal proxy endpoint'))).toBe(true);
  });
});

describe('SR: ActionLoading — disabled buttons', () => {
  it('announces buttons as disabled while loading', async () => {
    await mount(ActionLoading.args as Partial<BareMetalProxyPanelProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Start Proxy') && p.includes('disabled'))).toBe(true);
    expect(ps.some(p => p.includes('Stop Proxy') && p.includes('disabled'))).toBe(true);
  });
});

describe('SR: Disabled — all buttons disabled', () => {
  it('announces buttons as disabled', async () => {
    await mount(Disabled.args as Partial<BareMetalProxyPanelProps>);
    const ps = await phrases();
    expect(ps.some(p => p.includes('Start Proxy') && p.includes('disabled'))).toBe(true);
    expect(ps.some(p => p.includes('Restart Proxy') && p.includes('disabled'))).toBe(true);
  });
});
