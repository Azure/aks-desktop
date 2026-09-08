// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Screen reader tests for the **CreateAKSProjectPure** wizard shell:
 * breadcrumb navigation, validation, loading, error/success overlays, and
 * step navigation (Back / Next / Create Project).
 */

import { render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// ── Mocks (must be in the test file for Vitest hoisting) ─────────────────────
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

import { virtual } from '@guidepup/virtual-screen-reader';
import type { CreateAKSProjectPureProps } from '../CreateAKSProjectPure';
import CreateAKSProjectPure from '../CreateAKSProjectPure';
import { BASE_PROPS, phrases } from './guidepup-setup';

/**
 * Mount CreateAKSProjectPure and start the virtual SR on document.body.
 * We use document.body (not the render container) because MUI Dialogs render
 * into a portal at document.body and would be invisible otherwise.
 */
async function mountWizard(overrides: Partial<CreateAKSProjectPureProps> = {}) {
  render(
    <MemoryRouter>
      <CreateAKSProjectPure {...BASE_PROPS} {...overrides} />
    </MemoryRouter>
  );
  await virtual.start({ container: document.body });
}

// ═══════════════════════════════════════════════════════════════════════════
// BasicsStepDefault — breadcrumb navigation
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: BasicsStepDefault — breadcrumb navigation', () => {
  it('announces the breadcrumb as a navigation landmark labelled "Wizard steps"', async () => {
    await mountWizard();
    expect(await phrases()).toContain('navigation, Wizard steps');
  });

  it('announces all 5 step buttons within the navigation landmark', async () => {
    await mountWizard();
    const ps = await phrases();
    expect(ps).toContain('button, Basics, current step');
    expect(ps).toContain('button, Networking Policies');
    expect(ps).toContain('button, Compute Quota');
    expect(ps).toContain('button, Access');
    expect(ps).toContain('button, Review');
  });

  it('closes the navigation landmark after the last step', async () => {
    await mountWizard();
    expect(await phrases()).toContain('end of navigation, Wizard steps');
  });

  it('does NOT announce decorative step-number icons', async () => {
    await mountWizard();
    const ps = await phrases();
    expect(ps.some(p => /mdi:numeric|numeric-\d-circle/i.test(p))).toBe(false);
  });

  it('announces Cancel and Next buttons after step content', async () => {
    await mountWizard();
    const ps = await phrases();
    expect(ps).toContain('button, Cancel');
    expect(ps).toContain('button, Next');
  });

  it('does NOT announce Next as disabled when validation passes', async () => {
    await mountWizard({ validation: { isValid: true } });
    const ps = await phrases();
    expect(ps).not.toContain('button, Next, disabled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ValidationError
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ValidationError — Next button disabled', () => {
  it('announces the Next button as disabled when validation fails', async () => {
    await mountWizard({ validation: { isValid: false } });
    expect(await phrases()).toContain('button, Next, disabled');
  });

  it('still announces Cancel as enabled when validation fails', async () => {
    await mountWizard({ validation: { isValid: false } });
    const ps = await phrases();
    expect(ps).toContain('button, Cancel');
    expect(ps).not.toContain('button, Cancel, disabled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NextButtonLoading
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: NextButtonLoading — aria-busy on Next while Azure resources load', () => {
  it('announces the loading button as busy and disabled', async () => {
    await mountWizard({ azureResourcesLoading: true, validation: { isValid: false } });
    expect(await phrases()).toContain('button, Loading..., busy, disabled');
  });

  it('does NOT announce a plain "Next" button while loading', async () => {
    await mountWizard({ azureResourcesLoading: true });
    const ps = await phrases();
    expect(ps).not.toContain('button, Next');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step navigation
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: Step navigation — Back button and aria-current', () => {
  it('announces Back + Next on step 1 (Networking Policies)', async () => {
    await mountWizard({ activeStep: 1 });
    const ps = await phrases();
    expect(ps).toContain('button, Back');
    expect(ps).toContain('button, Next');
  });

  it('marks Networking Policies as aria-current="step" at step 1', async () => {
    await mountWizard({ activeStep: 1 });
    expect(await phrases()).toContain('button, Networking Policies, current step');
  });

  it('marks Access as aria-current="step" at step 3', async () => {
    await mountWizard({ activeStep: 3 });
    expect(await phrases()).toContain('button, Access, current step');
  });

  it('announces Back + "Create Project" (not Next) on the last step', async () => {
    await mountWizard({ activeStep: 4 });
    const ps = await phrases();
    expect(ps).toContain('button, Back');
    expect(ps).toContain('button, Create Project');
    expect(ps).not.toContain('button, Next');
  });

  it('marks Review as aria-current="step" on the last step', async () => {
    await mountWizard({ activeStep: 4 });
    expect(await phrases()).toContain('button, Review, current step');
  });

  it('does NOT announce Back on the first step (step 0)', async () => {
    await mountWizard({ activeStep: 0 });
    expect(await phrases()).not.toContain('button, Back');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LoadingOverlay
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: LoadingOverlay — aria-busy card, progressbar, progress text', () => {
  it('announces the region as busy via the aria-busy "busy" token', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    expect(await phrases()).toContain('busy');
  });

  it('announces the progressbar with the "Creating Project" accessible name', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    expect(await phrases()).toContain('progressbar, Creating Project, max value 100, min value 0');
  });

  it('announces the current progress step text', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    const ps = await phrases();
    expect(ps.some(p => /creating namespace/i.test(p))).toBe(true);
  });

  it('closes the busy region with an "end, busy" token', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    expect(await phrases()).toContain('end, busy');
  });

  it('with correct inert="": Cancel behind overlay is absent from AT (jsdom 24+ supports inert)', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    const ps = await phrases();
    const cancelPhrase = ps.find(p => /cancel/i.test(p) && /button/i.test(p));
    expect(cancelPhrase).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ErrorOverlay
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ErrorOverlay — alertdialog + role=alert', () => {
  const ERROR = 'Namespace creation failed: ResourceQuotaExceeded.';

  it('includes the dialog title in the alertdialog announcement', async () => {
    await mountWizard({ creationError: ERROR });
    const ps = await phrases();
    const dlg = ps.find(p => /alertdialog/i.test(p));
    expect(dlg).toMatch(/project creation failed/i);
  });

  it('includes the error description in the alertdialog announcement via aria-describedby', async () => {
    await mountWizard({ creationError: ERROR });
    const ps = await phrases();
    const dlg = ps.find(p => /alertdialog/i.test(p));
    expect(dlg).toMatch(/quota|namespace creation failed/i);
  });

  it('announces the dialog title as a heading', async () => {
    await mountWizard({ creationError: ERROR });
    expect(await phrases()).toContain('heading, Project Creation Failed, level 2');
  });

  it('announces the error text inside a role=alert assertive live region', async () => {
    await mountWizard({ creationError: ERROR });
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps.some(p => /quota|namespace creation failed/i.test(p))).toBe(true);
  });

  it('announces the "alert" open and close boundary tokens', async () => {
    await mountWizard({ creationError: ERROR });
    const ps = await phrases();
    expect(ps).toContain('alert');
    expect(ps).toContain('end of alert');
  });

  it('announces the Cancel button as enabled so the user can dismiss', async () => {
    await mountWizard({ creationError: ERROR });
    const ps = await phrases();
    expect(ps).toContain('button, Cancel');
    expect(ps).not.toContain('button, Cancel, disabled');
  });

  it('closes the alertdialog boundary', async () => {
    await mountWizard({ creationError: ERROR });
    const ps = await phrases();
    expect(ps.some(p => /^end of alertdialog/i.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LongErrorMessage
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: LongErrorMessage — alertdialog with multi-line error', () => {
  const LONG_ERROR =
    'Error: Namespace creation failed: ResourceQuotaExceeded — Exceeded quota: ' +
    'compute-resources. Additional context: node pools at capacity.';

  it('announces as alertdialog with "Project Creation Failed" title', async () => {
    await mountWizard({ creationError: LONG_ERROR });
    const ps = await phrases();
    const dlg = ps.find(p => /alertdialog/i.test(p));
    expect(dlg).toMatch(/project creation failed/i);
  });

  it('includes the full long error text inside the role=alert region', async () => {
    await mountWizard({ creationError: LONG_ERROR });
    const ps = await phrases();
    expect(ps).toContain('alert');
    const errorText = ps.find(p => /quota|namespace creation failed/i.test(p));
    expect(errorText).toBeTruthy();
  });

  it('Cancel button is reachable and enabled even with a long error', async () => {
    await mountWizard({ creationError: LONG_ERROR });
    const ps = await phrases();
    expect(ps).toContain('button, Cancel');
    expect(ps).not.toContain('button, Cancel, disabled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SuccessDialog
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: SuccessDialog — dialog + role=status', () => {
  it('announces as role=dialog with "Project Created Successfully!" title', async () => {
    await mountWizard({ showSuccessDialog: true, projectName: 'my-project' });
    const ps = await phrases();
    const dlg = ps.find(p => /^dialog,/i.test(p));
    expect(dlg).toMatch(/project created successfully/i);
  });

  it('includes the success description in the dialog announcement via aria-describedby', async () => {
    await mountWizard({ showSuccessDialog: true, projectName: 'my-project' });
    const ps = await phrases();
    const dlg = ps.find(p => /^dialog,/i.test(p));
    expect(dlg).toMatch(/has been created|ready to use/i);
  });

  it('interpolates the project name into the aria-describedby description', async () => {
    await mountWizard({ showSuccessDialog: true, projectName: 'azure-microservices-demo' });
    const ps = await phrases();
    const dlg = ps.find(p => /^dialog,/i.test(p));
    expect(dlg).toMatch(/azure-microservices-demo/);
  });

  it('announces the dialog title as a heading', async () => {
    await mountWizard({ showSuccessDialog: true });
    expect(await phrases()).toContain('heading, Project Created Successfully!, level 2');
  });

  it('announces the success message via the role=status polite live region', async () => {
    await mountWizard({ showSuccessDialog: true, projectName: 'my-project' });
    const ps = await phrases();
    expect(ps).toContain('status');
    expect(ps.some(p => /has been created|ready to use/i.test(p))).toBe(true);
  });

  it('contains exactly one status region — the success description (not the creation-progress live region)', async () => {
    await mountWizard({ showSuccessDialog: true });
    const ps = await phrases();
    const statusTokens = ps.filter(p => p === 'status');
    expect(statusTokens).toHaveLength(1);
    expect(ps).toContain('end of status');
  });

  it('announces the Application name textbox', async () => {
    await mountWizard({ showSuccessDialog: true });
    const ps = await phrases();
    expect(ps.some(p => /textbox/i.test(p) && /application name/i.test(p))).toBe(true);
  });

  it('announces Create Application as disabled when application name is empty', async () => {
    await mountWizard({ showSuccessDialog: true, applicationName: '' });
    expect(await phrases()).toContain('button, Create Application, disabled');
  });

  it('closes the dialog boundary', async () => {
    await mountWizard({ showSuccessDialog: true });
    const ps = await phrases();
    expect(ps.some(p => /^end of dialog,/i.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SuccessDialogWithAppName
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: SuccessDialogWithAppName — enabled Create Application', () => {
  it('announces the textbox with the pre-filled application name as its value', async () => {
    await mountWizard({
      showSuccessDialog: true,
      applicationName: 'frontend-service',
      projectName: 'azure-microservices-demo',
    });
    const ps = await phrases();
    const input = ps.find(p => /textbox/i.test(p) && /application name/i.test(p));
    expect(input).toMatch(/frontend-service/i);
  });

  it('announces Create Application as enabled when app name is provided', async () => {
    await mountWizard({ showSuccessDialog: true, applicationName: 'frontend-service' });
    const ps = await phrases();
    expect(ps).toContain('button, Create Application');
    expect(ps).not.toContain('button, Create Application, disabled');
  });

  it('includes the project name in the dialog description', async () => {
    await mountWizard({
      showSuccessDialog: true,
      applicationName: 'frontend-service',
      projectName: 'azure-microservices-demo',
    });
    const ps = await phrases();
    const statusText = ps.find(p => /azure-microservices-demo/i.test(p));
    expect(statusText).toBeTruthy();
  });
});
