// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
/**
 * Interaction tests for {@link DeployPure}.
 *
 * Each test renders the component using the args from the corresponding
 * Storybook story so that the stories act as the single source of truth for
 * both the visual catalogue and the interaction test matrix.
 *
 * Pattern:
 *   1. Import story args.
 *   2. Spy on every callback prop (DeployPure is purely presentational with no
 *      callbacks, so tests focus on rendered output and ARIA attributes).
 *   3. Render via RTL.
 *   4. Assert the correct elements are visible and accessible.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ── module mocks ─────────────────────────────────────────────────────────────
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

// ── component + stories ───────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — Idle story', () => {
  it('renders the Review & Deploy heading', () => {
    renderStory(Idle.args!);
    expect(screen.getByRole('heading', { name: /review & deploy/i })).toBeInTheDocument();
  });

  it('shows no status banner when deployResult is null', () => {
    renderStory(Idle.args!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the resource cards from story yamlObjects', () => {
    renderStory(Idle.args!);
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.getByText('my-app-svc')).toBeInTheDocument();
  });

  it('renders namespace chips for resources that have a namespace', () => {
    renderStory(Idle.args!);
    // Both sample objects have namespace "default"
    const nsChips = screen.getAllByText(/namespace: default/i);
    expect(nsChips.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — DeploySuccess story', () => {
  it('renders a polite status live region on success', () => {
    renderStory(DeploySuccess.args!);
    const statusBox = screen.getByRole('status');
    expect(statusBox).toBeInTheDocument();
  });

  it('shows the success message from the story', () => {
    renderStory(DeploySuccess.args!);
    expect(screen.getByText(/applied 5 resources successfully/i)).toBeInTheDocument();
  });

  it('does not render an alert role on success', () => {
    renderStory(DeploySuccess.args!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — DeployError story', () => {
  it('renders an assertive alert live region on error', () => {
    renderStory(DeployError.args!);
    const alertBox = screen.getByRole('alert');
    expect(alertBox).toBeInTheDocument();
  });

  it('shows the error message from the story', () => {
    renderStory(DeployError.args!);
    expect(screen.getByText(/failed to apply resources/i)).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/i)).toBeInTheDocument();
  });

  it('does not render a status role on error', () => {
    renderStory(DeployError.args!);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — YamlWithObjects story', () => {
  it('renders all three resources from the story', () => {
    renderStory(YamlWithObjects.args!);
    expect(screen.getByText('api-server')).toBeInTheDocument();
    expect(screen.getByText('api-server-svc')).toBeInTheDocument();
    expect(screen.getByText('api-ingress')).toBeInTheDocument();
  });

  it('renders kind chips for each resource', () => {
    renderStory(YamlWithObjects.args!);
    expect(screen.getByText('Deployment')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Ingress')).toBeInTheDocument();
  });

  it('only renders namespace chips for resources that have a namespace', () => {
    renderStory(YamlWithObjects.args!);
    // api-server-svc has no namespace in the story so no chip for it
    const nsChips = screen.getAllByText(/namespace: production/i);
    expect(nsChips.length).toBe(2); // api-server and api-ingress have namespace
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — EmptyResourceList story', () => {
  it('renders the heading with empty list', () => {
    renderStory(EmptyResourceList.args!);
    expect(screen.getByRole('heading', { name: /review & deploy/i })).toBeInTheDocument();
  });

  it('renders no resource cards when yamlObjects is empty', () => {
    renderStory(EmptyResourceList.args!);
    // No Paper cards for resources — only the heading and resource-count text should appear
    expect(screen.queryByText(/deployment/i)).not.toBeInTheDocument();
  });

  it('shows 0 in the resource count label', () => {
    renderStory(EmptyResourceList.args!);
    expect(screen.getByText(/0 object/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — SingleResource story', () => {
  it('shows 1 in the resource count label', () => {
    renderStory(SingleResource.args!);
    expect(screen.getByText(/1 object/i)).toBeInTheDocument();
  });

  it('renders the single resource card', () => {
    renderStory(SingleResource.args!);
    expect(screen.getByText('web-frontend')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — ManyResourceTypes story', () => {
  it('renders all five resource cards', () => {
    renderStory(ManyResourceTypes.args!);
    expect(screen.getByText('web-frontend')).toBeInTheDocument();
    expect(screen.getByText('web-frontend-svc')).toBeInTheDocument();
    expect(screen.getByText('app-config')).toBeInTheDocument();
    expect(screen.getByText('web-frontend-hpa')).toBeInTheDocument();
    expect(screen.getByText('web-frontend-sa')).toBeInTheDocument();
  });

  it('renders all five kind chips', () => {
    renderStory(ManyResourceTypes.args!);
    expect(screen.getByText('ConfigMap')).toBeInTheDocument();
    expect(screen.getByText('HorizontalPodAutoscaler')).toBeInTheDocument();
    expect(screen.getByText('ServiceAccount')).toBeInTheDocument();
  });

  it('renders 5 in the resource count label', () => {
    renderStory(ManyResourceTypes.args!);
    expect(screen.getByText(/5 object/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — container sourceType', () => {
  it('renders the Monaco editor for container source type', () => {
    renderStory(Idle.args!, {
      sourceType: 'container',
      containerPreviewYaml: 'apiVersion: apps/v1\nkind: Deployment\n',
    });
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('shows the generated manifests subtitle for container source', () => {
    renderStory(Idle.args!, {
      sourceType: 'container',
      containerPreviewYaml: 'apiVersion: apps/v1',
      namespace: 'production',
    });
    expect(screen.getByText(/generated kubernetes manifests/i)).toBeInTheDocument();
    expect(screen.getByText(/namespace: production/i)).toBeInTheDocument();
  });
});
