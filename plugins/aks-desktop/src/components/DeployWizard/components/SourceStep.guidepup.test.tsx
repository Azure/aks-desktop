// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
/**
 * Virtual screen-reader tests for {@link SourceStep}.
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

import SourceStep, { SourceStepProps } from './SourceStep';
import { ContainerSelected, NoSelection, YamlSelected } from './SourceStep.stories';

afterEach(() => cleanup());
function renderStory(storyArgs: SourceStepProps) {
  return render(
    <MemoryRouter>
      <SourceStep {...storyArgs} />
    </MemoryRouter>
  );
}

/**
 * Walk the virtual screen-reader through the full accessibility tree and
 * return the collected phrase log.
 */
async function collect(): Promise<string[]> {
  await virtual.start({ container: document.body });

  for (let i = 0; i < 80; i++) {
    await virtual.next();
  }

  const log = await virtual.spokenPhraseLog();
  await virtual.stop();
  return log;
}

describe('SourceStep — NoSelection (guidepup)', () => {
  it('announces the Select Source heading', async () => {
    renderStory(NoSelection.args!);
    const phrases = await collect();

    expect(phrases).toContain('heading, Select Source, level 5');
  });

  it('announces the Deployment source group', async () => {
    renderStory(NoSelection.args!);
    const phrases = await collect();

    expect(phrases).toContain('group, Deployment source');
    expect(phrases).toContain('end of group, Deployment source');
  });

  it('announces both source buttons as not pressed', async () => {
    renderStory(NoSelection.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Container Image, not pressed');
    expect(phrases).toContain('button, Kubernetes YAML, not pressed');
  });

  it('announces the descriptive text for each source', async () => {
    renderStory(NoSelection.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('Deploy from Azure Container Registry'))).toBe(true);
    expect(phrases.some(p => p.includes('Bring your own Kubernetes manifests'))).toBe(true);
  });

  it('announces feature lists', async () => {
    renderStory(NoSelection.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('list'))).toBe(true);
    expect(phrases.some(p => p.includes('listitem'))).toBe(true);
  });

  it('does not announce decorative icon names (aria-hidden regression)', async () => {
    renderStory(NoSelection.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('mdi:'))).toBe(false);
  });
});

describe('SourceStep — ContainerSelected (guidepup)', () => {
  it('announces Container Image button as pressed', async () => {
    renderStory(ContainerSelected.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Container Image, pressed');
  });

  it('announces Kubernetes YAML button as not pressed', async () => {
    renderStory(ContainerSelected.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Kubernetes YAML, not pressed');
  });

  it('does not announce decorative icon names (aria-hidden regression)', async () => {
    renderStory(ContainerSelected.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('mdi:'))).toBe(false);
  });
});

describe('SourceStep — YamlSelected (guidepup)', () => {
  it('announces Kubernetes YAML button as pressed', async () => {
    renderStory(YamlSelected.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Kubernetes YAML, pressed');
  });

  it('announces Container Image button as not pressed', async () => {
    renderStory(YamlSelected.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Container Image, not pressed');
  });

  it('does not announce decorative icon names (aria-hidden regression)', async () => {
    renderStory(YamlSelected.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('mdi:'))).toBe(false);
  });
});
