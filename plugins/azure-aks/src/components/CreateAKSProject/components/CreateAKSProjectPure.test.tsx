// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Interaction tests for {@link CreateAKSProjectPure}.
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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// have to mock before importing more below the mocks.
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

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  PageGrid: ({ children }: any) => <div>{children}</div>,
  SectionBox: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon, ...props }: any) => <span data-icon={icon} {...props} />,
}));

import CreateAKSProjectPure, { CreateAKSProjectPureProps } from './CreateAKSProjectPure';
import {
  BasicsStepDefault,
  ErrorOverlay,
  LoadingOverlay,
  NextButtonLoading,
  SuccessDialog,
  SuccessDialogWithAppName,
  ValidationError,
} from './CreateAKSProjectPure.stories';

afterEach(() => cleanup());

/** Render a story using its args, overriding callbacks with Vitest (`vi.fn()`) spies. */
function renderStory(
  storyArgs: CreateAKSProjectPureProps,
  overrides: Partial<CreateAKSProjectPureProps> = {}
) {
  const props: CreateAKSProjectPureProps = { ...storyArgs, ...overrides };
  return render(
    <MemoryRouter>
      <CreateAKSProjectPure {...props} />
    </MemoryRouter>
  );
}

describe('CreateAKSProjectPure — BasicsStepDefault story interactions', () => {
  it('renders the step content provided by the story', () => {
    renderStory(BasicsStepDefault.args!);
    expect(screen.getByText('Basics step content')).toBeInTheDocument();
  });

  it('calls onBack when Cancel button is clicked on step 0', () => {
    const onBack = vi.fn();
    renderStory(BasicsStepDefault.args!, { onBack });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls handleNext when Next button is clicked', () => {
    const handleNext = vi.fn();
    renderStory(BasicsStepDefault.args!, { handleNext });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(handleNext).toHaveBeenCalledTimes(1);
  });
});

describe('CreateAKSProjectPure — ValidationError story interactions', () => {
  it('does not call handleNext when Next is clicked while disabled', () => {
    const handleNext = vi.fn();
    renderStory(ValidationError.args!, { handleNext });
    // fireEvent.click still fires the DOM event; the button's disabled attribute
    // prevents the onClick handler from being called by React.
    const btn = screen.getByRole('button', { name: /next/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(handleNext).not.toHaveBeenCalled();
  });
});

describe('CreateAKSProjectPure — NextButtonLoading story interactions', () => {
  it('does not call handleNext while loading', () => {
    const handleNext = vi.fn();
    renderStory(NextButtonLoading.args!, { handleNext });
    const btn = screen.getByRole('button', { name: /loading/i });
    fireEvent.click(btn);
    expect(handleNext).not.toHaveBeenCalled();
  });
});

describe('CreateAKSProjectPure — LoadingOverlay story interactions', () => {
  it('has a persistent role="status" live region with progress text', () => {
    renderStory(LoadingOverlay.args!);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/creating namespace/i);
  });

  it('Create Project button is absent during loading (last step not rendered in overlay)', () => {
    // During loading the overlay replaces step content; LoadingOverlay uses
    // activeStep 0, so the Create Project button (only on the last step) is not rendered.
    renderStory(LoadingOverlay.args!);
    expect(screen.queryByRole('button', { name: /create project/i })).toBeNull();
  });
});

describe('CreateAKSProjectPure — ErrorOverlay story interactions', () => {
  it('calls onDismissError when Cancel in the error dialog is clicked', () => {
    const onDismissError = vi.fn();
    renderStory(ErrorOverlay.args!, { onDismissError });
    // The alertdialog has a Cancel button; there may be other Cancel buttons too.
    const dialog = screen.getByRole('alertdialog');
    const cancelBtn = within(dialog).getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancelSuccess when error dialog Cancel is clicked', () => {
    const onCancelSuccess = vi.fn();
    const onDismissError = vi.fn();
    renderStory(ErrorOverlay.args!, { onCancelSuccess, onDismissError });
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(onCancelSuccess).not.toHaveBeenCalled();
  });
});

describe('CreateAKSProjectPure — SuccessDialog story interactions', () => {
  it('calls onCancelSuccess when Cancel button is clicked in success dialog', () => {
    const onCancelSuccess = vi.fn();
    renderStory(SuccessDialog.args!, { onCancelSuccess });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(onCancelSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss success dialog on Escape key', () => {
    const onCancelSuccess = vi.fn();
    renderStory(SuccessDialog.args!, { onCancelSuccess });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancelSuccess).not.toHaveBeenCalled();
  });

  it('does not dismiss success dialog on backdrop click', () => {
    const onCancelSuccess = vi.fn();
    renderStory(SuccessDialog.args!, { onCancelSuccess });
    const backdrop = document.querySelector('.MuiBackdrop-root');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onCancelSuccess).not.toHaveBeenCalled();
  });

  it('calls onNavigateToProject with encoded URL when Create Application is clicked', () => {
    const onNavigateToProject = vi.fn();
    renderStory(SuccessDialog.args!, {
      applicationName: 'my-app',
      projectName: 'my-project',
      onNavigateToProject,
    });
    fireEvent.click(screen.getByRole('button', { name: /create application/i }));
    expect(onNavigateToProject).toHaveBeenCalledTimes(1);
    const [url] = onNavigateToProject.mock.calls[0];
    expect(url).toContain('/project/my-project');
    expect(url).toContain('openDeploy=true');
    expect(url).toContain('applicationName=my-app');
  });

  it('updates application name when typed into the text field', () => {
    const setApplicationName = vi.fn();
    renderStory(SuccessDialog.args!, { setApplicationName });
    const input = screen.getByRole('textbox', { name: /application name/i });
    fireEvent.change(input, { target: { value: 'new-service' } });
    expect(setApplicationName).toHaveBeenCalled();
  });
});

describe('CreateAKSProjectPure — SuccessDialogWithAppName story interactions', () => {
  it('calls onNavigateToProject with the story application name', () => {
    const onNavigateToProject = vi.fn();
    renderStory(SuccessDialogWithAppName.args!, { onNavigateToProject });
    fireEvent.click(screen.getByRole('button', { name: /create application/i }));
    expect(onNavigateToProject).toHaveBeenCalledTimes(1);
    const [url] = onNavigateToProject.mock.calls[0];
    expect(url).toContain('applicationName=frontend-service');
  });
});

describe('CreateAKSProjectPure — Breadcrumb keyboard navigation a11y', () => {
  it('breadcrumb step buttons are keyboard-reachable (tabIndex is not -1)', () => {
    renderStory(BasicsStepDefault.args!);
    // All step labels have role="button" and tabIndex={0} — keyboard users must
    // be able to reach and activate them.
    const stepButtons = screen.getAllByRole('button', {
      name: /basics|networking|compute|access|review/i,
    });
    // Verify each step is reachable via keyboard (tabIndex not -1).
    stepButtons.forEach(btn => {
      expect(btn).not.toHaveAttribute('tabindex', '-1');
    });
  });

  it('activates the correct step when Enter is pressed on a breadcrumb item', () => {
    const handleStepClick = vi.fn();
    renderStory(BasicsStepDefault.args!, { handleStepClick });
    const stepButtons = screen.getAllByRole('button', {
      name: /networking/i,
    });
    // Press Enter on the Networking Policies step (index 1).
    fireEvent.keyDown(stepButtons[0], { key: 'Enter' });
    expect(handleStepClick).toHaveBeenCalledWith(1);
  });

  it('activates the correct step when Space is pressed on a breadcrumb item', () => {
    const handleStepClick = vi.fn();
    renderStory(BasicsStepDefault.args!, { handleStepClick });
    const accessStepButtons = screen.getAllByRole('button', {
      name: /access/i,
    });
    // Press Space on the Access step (index 3).
    fireEvent.keyDown(accessStepButtons[0], { key: ' ' });
    expect(handleStepClick).toHaveBeenCalledWith(3);
  });
});
