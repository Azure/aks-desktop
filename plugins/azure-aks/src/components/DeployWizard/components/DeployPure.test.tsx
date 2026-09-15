// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

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
import { Idle, YamlWithObjects } from './DeployPure.stories';

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
describe('DeployPure — YamlWithObjects story', () => {
  it('only renders namespace chips for resources that have a namespace', () => {
    renderStory(YamlWithObjects.args!);
    // api-server-svc has no namespace in the story so no chip for it
    const nsChips = screen.getAllByText(/namespace: production/i);
    expect(nsChips.length).toBe(2); // api-server and api-ingress have namespace
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployPure — quota warnings', () => {
  const quotaWarnings = [
    {
      resource: 'requests.memory' as const,
      requested: '384Mi',
      remaining: '256Mi',
      limit: '512Mi',
    },
    {
      resource: 'limits.cpu' as const,
      requested: '3',
      remaining: '1',
      limit: '2',
    },
  ];

  it('renders quota warning banner when quotaWarnings is non-empty and deployResult is null', () => {
    renderStory(Idle.args!, { quotaWarnings });
    expect(screen.getByText(/resource quota warning/i)).toBeInTheDocument();
    expect(screen.getByText(/requests\.memory/)).toBeInTheDocument();
    expect(screen.getByText(/384Mi/)).toBeInTheDocument();
    expect(screen.getByText(/limits\.cpu/)).toBeInTheDocument();
  });

  it('hides quota warning banner when deployResult is set', () => {
    renderStory(Idle.args!, {
      quotaWarnings,
      deployResult: 'success',
      deployMessage: 'Applied 1 resource(s) successfully.',
    });
    expect(screen.queryByText(/resource quota warning/i)).not.toBeInTheDocument();
  });

  it('does not render quota warning banner when quotaWarnings is empty', () => {
    renderStory(Idle.args!, { quotaWarnings: [] });
    expect(screen.queryByText(/resource quota warning/i)).not.toBeInTheDocument();
  });
});
