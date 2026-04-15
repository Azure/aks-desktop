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

  it('Next button is enabled when validation.isValid is true', () => {
    renderStory(BasicsStepDefault.args!, { validation: { isValid: true } });
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });
});

describe('CreateAKSProjectPure — ValidationError story interactions', () => {
  it('Next button is disabled when validation.isValid is false', () => {
    renderStory(ValidationError.args!);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

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
  it('Next button is disabled while Azure resources are loading', () => {
    renderStory(NextButtonLoading.args!);
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });

  it('Next button shows loading text while azureResourcesLoading', () => {
    renderStory(NextButtonLoading.args!);
    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument();
  });

  it('does not call handleNext while loading', () => {
    const handleNext = vi.fn();
    renderStory(NextButtonLoading.args!, { handleNext });
    const btn = screen.getByRole('button', { name: /loading/i });
    fireEvent.click(btn);
    expect(handleNext).not.toHaveBeenCalled();
  });
});

describe('CreateAKSProjectPure — LoadingOverlay story interactions', () => {
  it('renders the loading progress text', () => {
    renderStory(LoadingOverlay.args!);
    // The progress text appears both in the visual overlay (aria-hidden) and in the
    // persistent role="status" live region, so multiple elements match.
    const matches = screen.getAllByText(/creating namespace/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

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
  it('renders the error message from the story', () => {
    renderStory(ErrorOverlay.args!);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/namespace creation failed/i)).toBeInTheDocument();
  });

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

  it('error dialog has the correct accessible title', () => {
    renderStory(ErrorOverlay.args!);
    expect(screen.getByRole('heading', { name: /project creation failed/i })).toBeInTheDocument();
  });
});

describe('CreateAKSProjectPure — SuccessDialog story interactions', () => {
  it('renders the success dialog', () => {
    renderStory(SuccessDialog.args!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('success message has role="status" for Narrator and is the only status region when dialog is open', () => {
    renderStory(SuccessDialog.args!);
    // role="status" ensures Windows Narrator announces the success text even after
    // autoFocus moves to the Application name input (Narrator skips aria-describedby
    // once focus has moved: https://github.com/microsoft/fluentui/issues/7150).
    // isCreating is false when the success dialog is shown, so the persistent
    // creation-progress live region has no role="status" — exactly one status element.
    const statusEls = document.querySelectorAll('[role="status"]');
    expect(statusEls).toHaveLength(1);
    expect(statusEls[0]).toHaveTextContent(/has been created and is ready to use/i);
  });

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

  it('Create Application button is disabled when application name is empty', () => {
    renderStory(SuccessDialog.args!, { applicationName: '' });
    expect(screen.getByRole('button', { name: /create application/i })).toBeDisabled();
  });

  it('Create Application button is enabled when application name is provided', () => {
    renderStory(SuccessDialog.args!, { applicationName: 'my-app' });
    expect(screen.getByRole('button', { name: /create application/i })).not.toBeDisabled();
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
  it('Create Application button is enabled when story provides an application name', () => {
    renderStory(SuccessDialogWithAppName.args!);
    expect(screen.getByRole('button', { name: /create application/i })).not.toBeDisabled();
  });

  it('calls onNavigateToProject with the story application name', () => {
    const onNavigateToProject = vi.fn();
    renderStory(SuccessDialogWithAppName.args!, { onNavigateToProject });
    fireEvent.click(screen.getByRole('button', { name: /create application/i }));
    expect(onNavigateToProject).toHaveBeenCalledTimes(1);
    const [url] = onNavigateToProject.mock.calls[0];
    expect(url).toContain('applicationName=frontend-service');
  });
});

describe('CreateAKSProjectPure — error dialog a11y: error message announced', () => {
  it('error message has role="alert" so screen readers announce it on dialog open', () => {
    renderStory(ErrorOverlay.args!);
    // The error text must be in a live region (role="alert") so it is announced
    // even when autoFocus has already moved to the Cancel button.
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeInTheDocument();
    expect(alertEl).toHaveTextContent(/namespace creation failed/i);
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

  it('breadcrumb step icons are aria-hidden so they are not announced separately', () => {
    renderStory(BasicsStepDefault.args!);
    // The icons inside the breadcrumb use aria-hidden="true"; in the test the
    // Icon mock renders <span data-icon="..." aria-hidden="true"> so we confirm
    // no visible text-alternative is exposed for them.
    // Scope to the breadcrumb nav so the assertion doesn't false-pass from other
    // aria-hidden icons elsewhere in the tree.
    const wizardNav = screen.getByRole('navigation', { name: /wizard steps/i });
    const hiddenIcons = wizardNav.querySelectorAll('[data-icon][aria-hidden="true"]');
    // Breadcrumb renders one icon per step (5 steps).
    expect(hiddenIcons.length).toBeGreaterThanOrEqual(5);
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
