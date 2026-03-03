// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
/**
 * Virtual screen-reader tests for {@link DeployPure}.
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

import DeployPure, { DeployPureProps } from './DeployPure';
import {
  DeployError,
  DeploySuccess,
  EmptyResourceList,
  Idle,
  ManyResourceTypes,
  SingleResource,
  YamlWithObjects,
} from './DeployPure.stories';

afterEach(() => cleanup());
function renderStory(storyArgs: DeployPureProps, overrides: Partial<DeployPureProps> = {}) {
  const props: DeployPureProps = { ...storyArgs, ...overrides };
  return render(
    <MemoryRouter>
      <DeployPure {...props} />
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

describe('DeployPure — Idle (guidepup)', () => {
  it('announces the Review & Deploy heading', async () => {
    renderStory(Idle.args!);
    const phrases = await collect();

    expect(phrases).toContain('heading, Review & Deploy, level 6');
  });

  it('announces the resource count', async () => {
    renderStory(Idle.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('2 object'))).toBe(true);
  });

  it('announces resource kinds', async () => {
    renderStory(Idle.args!);
    const phrases = await collect();

    expect(phrases).toContain('Deployment');
    expect(phrases).toContain('Service');
  });

  it('announces resource names', async () => {
    renderStory(Idle.args!);
    const phrases = await collect();

    expect(phrases).toContain('my-app');
    expect(phrases).toContain('my-app-svc');
  });

  it('announces namespace chips', async () => {
    renderStory(Idle.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('namespace: default'))).toBe(true);
  });

  it('does not announce any status or alert region', async () => {
    renderStory(Idle.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.startsWith('status'))).toBe(false);
    expect(phrases.some(p => p.startsWith('alert'))).toBe(false);
  });
});

describe('DeployPure — DeploySuccess (guidepup)', () => {
  it('announces a polite status live region', async () => {
    renderStory(DeploySuccess.args!);
    const phrases = await collect();

    expect(phrases).toContain('status');
    expect(phrases).toContain('end of status');
  });

  it('announces the success message', async () => {
    renderStory(DeploySuccess.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('Applied 5 resources successfully'))).toBe(true);
  });

  it('does not announce an alert region', async () => {
    renderStory(DeploySuccess.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.startsWith('alert'))).toBe(false);
  });
});

describe('DeployPure — DeployError (guidepup)', () => {
  it('announces an assertive alert live region', async () => {
    renderStory(DeployError.args!);
    const phrases = await collect();

    expect(phrases).toContain('alert');
    expect(phrases).toContain('end of alert');
  });

  it('announces the error message', async () => {
    renderStory(DeployError.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('ECONNREFUSED'))).toBe(true);
  });

  it('does not announce a status region', async () => {
    renderStory(DeployError.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.startsWith('status'))).toBe(false);
  });
});

describe('DeployPure — YamlWithObjects (guidepup)', () => {
  it('announces all three resource kinds', async () => {
    renderStory(YamlWithObjects.args!);
    const phrases = await collect();

    expect(phrases).toContain('Deployment');
    expect(phrases).toContain('Service');
    expect(phrases).toContain('Ingress');
  });

  it('announces all three resource names', async () => {
    renderStory(YamlWithObjects.args!);
    const phrases = await collect();

    expect(phrases).toContain('api-server');
    expect(phrases).toContain('api-server-svc');
    expect(phrases).toContain('api-ingress');
  });

  it('announces the 3-object resource count', async () => {
    renderStory(YamlWithObjects.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('3 object'))).toBe(true);
  });
});

describe('DeployPure — EmptyResourceList (guidepup)', () => {
  it('announces the heading with zero-object count', async () => {
    renderStory(EmptyResourceList.args!);
    const phrases = await collect();

    expect(phrases).toContain('heading, Review & Deploy, level 6');
    expect(phrases.some(p => p.includes('0 object'))).toBe(true);
  });

  it('does not announce any resource kinds', async () => {
    renderStory(EmptyResourceList.args!);
    const phrases = await collect();

    expect(phrases).not.toContain('Deployment');
    expect(phrases).not.toContain('Service');
  });
});

describe('DeployPure — SingleResource (guidepup)', () => {
  it('announces the singular object count', async () => {
    renderStory(SingleResource.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('1 object'))).toBe(true);
  });

  it('announces the single resource name and kind', async () => {
    renderStory(SingleResource.args!);
    const phrases = await collect();

    expect(phrases).toContain('Deployment');
    expect(phrases).toContain('web-frontend');
  });

  it('announces the namespace chip', async () => {
    renderStory(SingleResource.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('namespace: production'))).toBe(true);
  });
});

describe('DeployPure — ManyResourceTypes (guidepup)', () => {
  it('announces the 5-object count', async () => {
    renderStory(ManyResourceTypes.args!);
    const phrases = await collect();

    expect(phrases.some(p => p.includes('5 object'))).toBe(true);
  });

  it('announces all five resource kinds', async () => {
    renderStory(ManyResourceTypes.args!);
    const phrases = await collect();

    expect(phrases).toContain('Deployment');
    expect(phrases).toContain('Service');
    expect(phrases).toContain('ConfigMap');
    expect(phrases).toContain('HorizontalPodAutoscaler');
    expect(phrases).toContain('ServiceAccount');
  });

  it('announces all five resource names', async () => {
    renderStory(ManyResourceTypes.args!);
    const phrases = await collect();

    expect(phrases).toContain('web-frontend');
    expect(phrases).toContain('web-frontend-svc');
    expect(phrases).toContain('app-config');
    expect(phrases).toContain('web-frontend-hpa');
    expect(phrases).toContain('web-frontend-sa');
  });
});

describe('DeployPure — container sourceType (guidepup)', () => {
  it('announces the Monaco editor region', async () => {
    renderStory(Idle.args!, {
      sourceType: 'container',
      containerPreviewYaml: 'apiVersion: apps/v1\nkind: Deployment',
    });
    const phrases = await collect();

    expect(phrases).toContain('region, YAML editor');
  });

  it('announces the generated manifests subtitle with namespace', async () => {
    renderStory(Idle.args!, {
      sourceType: 'container',
      containerPreviewYaml: 'apiVersion: apps/v1',
      namespace: 'production',
    });
    const phrases = await collect();

    expect(
      phrases.some(p => p.includes('Generated Kubernetes manifests') && p.includes('production'))
    ).toBe(true);
  });

  it('does not announce YAML resource cards', async () => {
    renderStory(Idle.args!, {
      sourceType: 'container',
      containerPreviewYaml: 'apiVersion: apps/v1',
    });
    const phrases = await collect();

    expect(phrases).not.toContain('Deployment');
    expect(phrases).not.toContain('my-app');
  });
});
