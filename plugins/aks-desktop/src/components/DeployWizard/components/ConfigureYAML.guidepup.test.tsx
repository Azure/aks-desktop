// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
/**
 * Virtual screen-reader tests for {@link ConfigureYAML}.
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

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" role="region" aria-label="YAML editor" />,
}));

import ConfigureYAML, { ConfigureYAMLProps } from './ConfigureYAML';
import { Empty, WithContent, WithError } from './ConfigureYAML.stories';

afterEach(() => cleanup());
function renderStory(storyArgs: ConfigureYAMLProps) {
  return render(
    <MemoryRouter>
      <ConfigureYAML {...storyArgs} />
    </MemoryRouter>
  );
}

/**
 * Walk the virtual screen-reader through the full accessibility tree and
 * return the collected phrase log.
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

describe('ConfigureYAML — Empty (guidepup)', () => {
  it('announces the Kubernetes YAML heading', async () => {
    renderStory(Empty.args!);
    const phrases = await collect();

    expect(phrases).toContain('heading, Kubernetes YAML, level 2');
  });

  it('announces the instruction text', async () => {
    renderStory(Empty.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('Add one or more Kubernetes manifests'))).toBe(true);
  });

  it('announces Upload files and Clear editor buttons', async () => {
    renderStory(Empty.args!);
    const phrases = await collect();

    expect(phrases).toContain('button, Upload files');
    expect(phrases).toContain('button, Clear editor');
  });

  it('announces the Monaco editor as a YAML editor region', async () => {
    renderStory(Empty.args!);
    const phrases = await collect();

    expect(phrases).toContain('region, YAML editor');
  });

  it('does not announce any error alert', async () => {
    renderStory(Empty.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.startsWith('alert'))).toBe(false);
  });
});

describe('ConfigureYAML — WithContent (guidepup)', () => {
  it('announces the same structure as Empty (no error)', async () => {
    renderStory(WithContent.args!);
    const phrases = await collect();

    expect(phrases).toContain('heading, Kubernetes YAML, level 2');
    expect(phrases).toContain('button, Upload files');
    expect(phrases).toContain('button, Clear editor');
    expect(phrases).toContain('region, YAML editor');
    expect(phrases.some(p => p.startsWith('alert'))).toBe(false);
  });
});

describe('ConfigureYAML — WithError (guidepup)', () => {
  it('announces an error alert live region', async () => {
    renderStory(WithError.args!);
    const phrases = await collect();

    expect(phrases).toContain('alert');
    expect(phrases).toContain('end of alert');
  });

  it('announces the error message text', async () => {
    renderStory(WithError.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('Invalid YAML'))).toBe(true);
  });

  it('still announces the YAML editor region', async () => {
    renderStory(WithError.args!);
    const phrases = await collect();

    expect(phrases).toContain('region, YAML editor');
  });
});
