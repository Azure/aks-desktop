// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Interaction tests for {@link DeployWizardPure}.
 *
 * Each test renders the component using the args from the corresponding
 * Storybook story so that the stories act as a single source of truth for
 * both the visual catalogue and the interaction test matrix.
 *
 * Pattern:
 *   1. Import story args.
 *   2. Spy on every callback prop.
 *   3. Render via RTL.
 *   4. Simulate user gestures.
 *   5. Assert the correct callback fired.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: any) => <span data-icon={icon} aria-hidden="true" />,
}));

// ── component + stories ───────────────────────────────────────────────────────
import DeployWizardPure, { DeployWizardPureProps } from './DeployWizardPure';
import {
  DeployStepDeploying,
  DeployStepError,
  DeployStepSuccess,
  NextButtonDisabled,
  SourceStep,
} from './DeployWizardPure.stories';

afterEach(() => cleanup());

function renderStory(
  storyArgs: DeployWizardPureProps,
  overrides: Partial<DeployWizardPureProps> = {}
) {
  const props: DeployWizardPureProps = { ...storyArgs, ...overrides };
  return render(
    <MemoryRouter>
      <DeployWizardPure {...props} />
    </MemoryRouter>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployWizardPure — SourceStep story interactions', () => {
  it('calls handleNext when Next button is clicked', () => {
    const handleNext = vi.fn();
    renderStory(SourceStep.args!, { handleNext, isStepValid: () => true });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(handleNext).toHaveBeenCalledTimes(1);
  });

  it('Back button is absent on the first step', () => {
    renderStory(SourceStep.args!);
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployWizardPure — NextButtonDisabled story interactions', () => {
  it('does not call handleNext when Next is clicked while disabled', () => {
    const handleNext = vi.fn();
    renderStory(NextButtonDisabled.args!, { handleNext });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(handleNext).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployWizardPure — DeployStepSuccess story interactions', () => {
  it('calls onClose when Close button is clicked', () => {
    const onClose = vi.fn();
    renderStory(DeployStepSuccess.args!, { onClose });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployWizardPure — DeployStepError story interactions', () => {
  it('calls onClose when Close is clicked after an error', () => {
    const onClose = vi.fn();
    renderStory(DeployStepError.args!, { onClose });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DeployWizardPure — DeployStepDeploying story interactions', () => {
  it('does not call handleDeploy when Deploy is clicked while deploying', () => {
    const handleDeploy = vi.fn().mockResolvedValue(undefined);
    renderStory(DeployStepDeploying.args!, { handleDeploy });
    fireEvent.click(screen.getByRole('button', { name: /deploying/i }));
    expect(handleDeploy).not.toHaveBeenCalled();
  });
});
