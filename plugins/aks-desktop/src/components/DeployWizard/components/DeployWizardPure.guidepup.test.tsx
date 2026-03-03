// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
/**
 * Virtual screen-reader tests for {@link DeployWizardPure}.
 *
 * Each test renders the component using the args from the corresponding
 * Storybook story so that the stories act as a single source of truth for
 * both the visual catalogue, the interaction tests, and the screen-reader
 * announcement matrix.
 *
 * Uses `@guidepup/virtual-screen-reader` to walk the accessibility tree and
 * assert on the spoken phrases that a screen reader would announce.
 */
import { virtual } from '@guidepup/virtual-screen-reader';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  Icon: ({ icon, ...props }: any) => (
    <span role="img" aria-label={icon} data-icon={icon} {...props} />
  ),
}));

import DeployWizardPure, { DeployWizardPureProps } from './DeployWizardPure';
import {
  ContainerSourceSelected,
  DeployStepDeploying,
  DeployStepError,
  DeployStepSuccess,
  NextButtonDisabled,
  SourceStep,
  SourceStepYamlSelected,
} from './DeployWizardPure.stories';

afterEach(() => cleanup());
function renderStory(storyArgs: DeployWizardPureProps) {
  return render(
    <MemoryRouter>
      <DeployWizardPure {...storyArgs} />
    </MemoryRouter>
  );
}

/**
 * Walk the virtual screen-reader through the full accessibility tree and
 * return the collected phrase log. Navigates a generous number of steps to
 * ensure all content is visited (the SR wraps around, which is fine — we
 * just need every element to appear at least once).
 */
async function collect(): Promise<string[]> {
  await virtual.start({ container: document.body });

  for (let i = 0; i < 60; i++) {
    await virtual.next();
  }

  const log = await virtual.spokenPhraseLog();
  await virtual.stop();
  return log;
}

describe('DeployWizardPure — SourceStep (guidepup)', () => {
  it('announces the heading, breadcrumb navigation, step content, and Next button', async () => {
    renderStory(SourceStep.args!);
    const phrases = await collect();

    expect(phrases).toContain('heading, Deploy Application, level 4');
    expect(phrases).toContain('navigation, Wizard steps');
    expect(phrases).toContain('button, Source, current step');
    expect(phrases).toContain('button, Configure');
    expect(phrases).toContain('button, Deploy');
    expect(phrases).toContain('Source step content');
    expect(phrases).toContain('button, Next');
  });

  it('marks the Source breadcrumb as current step', async () => {
    renderStory(SourceStep.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Source, current step');
    // Configure and Deploy are not current
    expect(phrases).not.toContain('button, Configure, current step');
    expect(phrases).not.toContain('button, Deploy, current step');
  });

  it('does not announce decorative icon names (aria-hidden regression)', async () => {
    renderStory(SourceStep.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('mdi:'))).toBe(false);
  });
});

describe('DeployWizardPure — SourceStepYamlSelected (guidepup)', () => {
  it('announces YAML selected step content and an enabled Next button', async () => {
    renderStory(SourceStepYamlSelected.args!);
    const phrases = await collect();

    expect(phrases).toContain('Source step — YAML selected');
    expect(phrases).toContain('button, Next');
    // Next should NOT be announced as disabled
    expect(phrases).not.toContain('button, Next, disabled');
  });
});

describe('DeployWizardPure — ContainerSourceSelected (guidepup)', () => {
  it('announces container selected step content', async () => {
    renderStory(ContainerSourceSelected.args!);
    const phrases = await collect();

    expect(phrases).toContain('Source step — Container selected');
    expect(phrases).toContain('button, Next');
  });
});

describe('DeployWizardPure — NextButtonDisabled (guidepup)', () => {
  it('announces the Next button as disabled', async () => {
    renderStory(NextButtonDisabled.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Next, disabled');
  });

  it('announces the step content for no source selected', async () => {
    renderStory(NextButtonDisabled.args!);
    const phrases = await collect();

    expect(phrases).toContain('Source step — no source selected');
  });
});

describe('DeployWizardPure — DeployStepSuccess (guidepup)', () => {
  it('announces the Close button (replaces Deploy footer action)', async () => {
    renderStory(DeployStepSuccess.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Close');
    // The breadcrumb still has a "Deploy" step button, but the footer action
    // should be Close — not a separate "button, Deploy" without "current step".
    expect(phrases.some(p => p === 'button, Deploy')).toBe(false);
  });

  it('marks the Deploy breadcrumb as current step', async () => {
    renderStory(DeployStepSuccess.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Deploy, current step');
  });

  it('does not announce decorative icon names (aria-hidden regression)', async () => {
    renderStory(DeployStepSuccess.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('mdi:'))).toBe(false);
  });
});

describe('DeployWizardPure — DeployStepError (guidepup)', () => {
  it('announces the Close button after an error result', async () => {
    renderStory(DeployStepError.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Close');
  });

  it('marks the Deploy breadcrumb as current step', async () => {
    renderStory(DeployStepError.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Deploy, current step');
  });
});

describe('DeployWizardPure — DeployStepDeploying (guidepup)', () => {
  it('announces the Deploying button as busy and disabled', async () => {
    renderStory(DeployStepDeploying.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Deploying..., busy, disabled');
  });

  it('marks the Deploy breadcrumb as current step', async () => {
    renderStory(DeployStepDeploying.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Deploy, current step');
  });
});
