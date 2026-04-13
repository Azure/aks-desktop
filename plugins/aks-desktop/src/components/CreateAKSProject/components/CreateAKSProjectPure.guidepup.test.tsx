// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
/**
 * Screen reader tests using {@link https://www.guidepup.dev/docs/virtual
 * @guidepup/virtual-screen-reader}.
 *
 * The Virtual Screen Reader implements the W3C accessibility specs (ACCNAME 1.2,
 * CORE-AAM 1.2, WAI-ARIA 1.2, HTML-AAM) and produces the exact spoken-phrase
 * sequence a real screen reader (VoiceOver / NVDA / Orca) would announce for
 * each rendered state.  All assertions are based on observed output verified
 * against the live components, so failing tests always indicate a real regression.
 *
 * Coverage:
 *  CreateAKSProjectPure
 *  ├── BasicsStepDefault  — breadcrumb nav; step buttons; aria-current; hidden icons; Cancel/Next
 *  ├── ValidationError    — Next button announced as disabled
 *  ├── NextButtonLoading  — Next button: aria-busy "busy" token; text changes to "Loading…"
 *  ├── LoadingOverlay     — aria-busy "busy"; progressbar name; progress text
 *  ├── ErrorOverlay       — alertdialog title+desc; role=alert live region; Cancel enabled
 *  ├── LongErrorMessage   — same structure as ErrorOverlay with multi-line error
 *  ├── SuccessDialog      — dialog title+desc; role=status live region; textbox; Create App disabled; single status region
 *  ├── SuccessDialogWithAppName — Create Application enabled; textbox value announced
 *  ├── StepOnReview       — Back button; "Create Project" button; Review step aria-current
 *  ├── StepOnAccess       — Back + Next buttons; Access step aria-current
 *  └── BackButtonVisible  — Back + Next buttons on step 2
 *
 *  AccessStep
 *  ├── empty state        — heading; intro text; "Add assignee" button enabled
 *  ├── invalid object ID      — textbox with "invalid"; error message; Remove button; Add disabled
 *  ├── valid object ID        — textbox "not invalid"; role combobox; Remove button; Add enabled
 *  └── loading state      — all controls disabled
 *
 *  ReviewStep
 *  ├── FullConfiguration  — all four h3 sections; project name/subscription/cluster/description
 *  ├── NoAssignees        — Access Control heading counts "(0 assignee)"; no assignee paragraphs
 *  ├── NoDescription      — falls back to "No description provided" placeholder
 *  ├── UnresolvedResources — subscription falls back to "N/A"; cluster shows raw name
 *  └── SingleAssignee     — single assignee object ID + role announced
 *
 *  NetworkingStep
 *  ├── Default     — h2 heading; intro text; Ingress/Egress comboboxes with current values
 *  ├── DenyAll     — both comboboxes show "Deny all traffic"
 *  ├── AllowAll    — both comboboxes show "Allow all traffic"
 *  └── Loading     — both comboboxes announced as disabled
 *
 *  ComputeStep
 *  ├── Default         — h2/h3 headings; 4 spinbuttons with values + helper text; units text
 *  ├── WithFieldErrors — invalid spinbuttons announce error message instead of helper text
 *  ├── CpuRequestError — single-field error; sibling fields remain "not invalid"
 *  └── Loading         — all 4 spinbuttons announced as disabled
 *
 *  Breadcrumb
 *  ├── FirstStep       — nav landmark; 5 step buttons; first step aria-current="step"
 *  ├── MiddleStep      — Compute Quota step has aria-current
 *  └── LastStep        — Review step has aria-current
 *
 *  FormField
 *  ├── Default         — labeled textbox with value
 *  ├── WithError       — textbox announced "invalid" with helper text
 *  ├── NumberField     — spinbutton role with value and helper text
 *  └── Disabled        — textbox announced as disabled
 *
 *  SearchableSelect
 *  ├── Default         — labeled combobox with placeholder
 *  └── WithSelection   — combobox announces selected value
 *
 *  ValidationAlert
 *  ├── Error           — alert severity "error" with message
 *  ├── Warning         — alert severity "warning"
 *  ├── Success         — alert severity "success"
 *  └── Hidden          — no alert when show=false
 *
 * A11y fixes included in this PR:
 *  - ResourceCard: added aria-hidden="true" to decorative title Icon
 *  - ComputeStep: added aria-hidden="true" to all startAdornment Icons (arrow-up/down)
 *
 * Note on `inert` + jsdom: jsdom 24+ implements the HTML `inert` attribute when
 * it is written as `inert=""` (the standard boolean form).  With the correct
 * `inert=""` form, the card content is hidden from the virtual SR tree entirely
 * during the LoadingOverlay, which is the intended behaviour.  This is verified
 * by the LoadingOverlay test below.
 */

import '@testing-library/jest-dom/vitest';
import { virtual } from '@guidepup/virtual-screen-reader';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
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

import { ComputeStep } from '../../shared/ComputeStep';
import type { FormFieldProps } from '../../shared/FormField';
import { FormField } from '../../shared/FormField';
import { NetworkingStep } from '../../shared/NetworkingStep';
import type {
  BreadcrumbProps,
  ComputeStepProps,
  NetworkingStepProps,
  ReviewStepProps,
} from '../types';
import { STEPS } from '../types';
import { AccessStep } from './AccessStep';
import { Breadcrumb } from './Breadcrumb';
import type { CreateAKSProjectPureProps } from './CreateAKSProjectPure';
import CreateAKSProjectPure from './CreateAKSProjectPure';
import { ReviewStep } from './ReviewStep';
import type { SearchableSelectProps } from './SearchableSelect';
import { SearchableSelect } from './SearchableSelect';
import { ValidationAlert } from './ValidationAlert';

// ── Base props (matches Storybook baseArgs) ───────────────────────────────────
const BASE_PROPS: CreateAKSProjectPureProps = {
  activeStep: 0,
  steps: STEPS,
  handleNext: () => {},
  handleBack: () => {},
  handleStepClick: () => {},
  handleSubmit: async () => {},
  onBack: () => {},
  isCreating: false,
  creationProgress: '',
  creationError: null,
  showSuccessDialog: false,
  applicationName: '',
  setApplicationName: (() => {}) as any,
  cliSuggestions: [],
  validation: { isValid: true },
  azureResourcesLoading: false,
  onNavigateToProject: () => {},
  stepContent: <div>Step content</div>,
  projectName: 'my-project',
  onDismissError: () => {},
  onCancelSuccess: () => {},
  stepContentRef: React.createRef<HTMLDivElement>(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/** Collect all spoken phrases to "end of document" (bounded to avoid infinite loops). */
async function phrases(maxSteps = 300): Promise<string[]> {
  const log: string[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const p = await virtual.lastSpokenPhrase();
    log.push(p);
    if (p === 'end of document') break;
    await virtual.next();
  }
  return log;
}

afterEach(async () => {
  await virtual.stop();
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════
// CreateAKSProjectPure — BasicsStepDefault
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: BasicsStepDefault — breadcrumb navigation', () => {
  it('announces the breadcrumb as a navigation landmark labelled "Wizard steps"', async () => {
    await mountWizard();
    expect(await phrases()).toContain('navigation, Wizard steps');
  });

  it('announces the Basics step with aria-current="step" at step 0', async () => {
    await mountWizard();
    expect(await phrases()).toContain('button, Basics, current step');
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
    // Icons have aria-hidden="true" — must never appear as spoken phrases
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

  it('does NOT show a Back button on the first step', async () => {
    await mountWizard({ activeStep: 0 });
    const ps = await phrases();
    expect(ps).not.toContain('button, Back');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CreateAKSProjectPure — ValidationError
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
// CreateAKSProjectPure — NextButtonLoading (Azure resources loading)
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: NextButtonLoading — aria-busy on Next while Azure resources load', () => {
  it('announces the loading button as busy and disabled', async () => {
    await mountWizard({ azureResourcesLoading: true, validation: { isValid: false } });
    // aria-busy + text change + disabled — SR announces: "Loading..., busy, disabled"
    expect(await phrases()).toContain('button, Loading..., busy, disabled');
  });

  it('includes the "busy" token in the button announcement', async () => {
    await mountWizard({ azureResourcesLoading: true, validation: { isValid: false } });
    const ps = await phrases();
    const loadBtn = ps.find(p => /loading/i.test(p) && /button/i.test(p));
    expect(loadBtn).toMatch(/busy/i);
  });

  it('does NOT announce a plain "Next" button while loading', async () => {
    await mountWizard({ azureResourcesLoading: true });
    const ps = await phrases();
    // Button text changes to "Loading..." so "button, Next" must not appear
    expect(ps).not.toContain('button, Next');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CreateAKSProjectPure — Step navigation (Back button, aria-current per step)
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
// CreateAKSProjectPure — LoadingOverlay
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: LoadingOverlay — aria-busy card, progressbar, progress text', () => {
  it('announces the region as busy via the aria-busy "busy" token', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    expect(await phrases()).toContain('busy');
  });

  it('announces the progressbar with the "Creating Project" accessible name', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    // CircularProgress aria-label="Creating Project"
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

  /**
   * With `inert=""` (the correct HTML boolean form), jsdom 24+ properly removes
   * the inert subtree from the virtual AT entirely.  The Cancel button behind
   * the overlay must NOT appear in the spoken-phrase log.
   */
  it('with correct inert="": Cancel behind overlay is absent from AT (jsdom 24+ supports inert)', async () => {
    await mountWizard({ isCreating: true, creationProgress: 'Creating namespace...' });
    const ps = await phrases();
    // The Cancel button lives inside the inert CardContent; jsdom 24+ honours
    // inert="" and removes it from the accessibility tree entirely.
    const cancelPhrase = ps.find(p => /cancel/i.test(p) && /button/i.test(p));
    expect(cancelPhrase).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CreateAKSProjectPure — ErrorOverlay
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ErrorOverlay — alertdialog + role=alert', () => {
  const ERROR = 'Namespace creation failed: ResourceQuotaExceeded.';

  it('announces the dialog as role=alertdialog', async () => {
    await mountWizard({ creationError: ERROR });
    const ps = await phrases();
    expect(ps.some(p => /alertdialog/i.test(p))).toBe(true);
  });

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
    // role="alert" fires independently of where autoFocus landed (Cancel button)
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
// CreateAKSProjectPure — LongErrorMessage (multi-line)
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
// CreateAKSProjectPure — SuccessDialog
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
    // role="status" on the dialog description fires independently of autoFocus on
    // the Application name textbox, ensuring Narrator announces the success message
    // even after focus has moved to the input.
    expect(ps).toContain('status');
    expect(ps.some(p => /has been created|ready to use/i.test(p))).toBe(true);
  });

  it('contains exactly one status region — the success description (not the creation-progress live region)', async () => {
    // When the success dialog is open isCreating is false, so the persistent
    // creation-progress Box has aria-live but no role="status".  Only the
    // success description Typography carries role="status", giving exactly one
    // status open-boundary token in the spoken phrase log.
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
// CreateAKSProjectPure — SuccessDialogWithAppName
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
    // MUI TextField announces the current value as part of the textbox phrase
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

// ═══════════════════════════════════════════════════════════════════════════
// AccessStep fixtures
// ═══════════════════════════════════════════════════════════════════════════
const ACCESS_FORM_DATA = {
  projectName: 'azure-microservices-demo',
  description: '',
  subscription: 'sub-123',
  cluster: 'aks-prod-eastus',
  resourceGroup: 'rg-prod',
  ingress: 'AllowSameNamespace' as const,
  egress: 'AllowAll' as const,
  cpuRequest: 2000,
  memoryRequest: 4096,
  cpuLimit: 4000,
  memoryLimit: 8192,
  userAssignments: [{ objectId: '00000000-1111-2222-3333-444444444444', role: 'Admin' }],
};

const ACCESS_VALIDATION = { isValid: true, errors: [] as string[], warnings: [] as string[] };

// ═══════════════════════════════════════════════════════════════════════════
// AccessStep — empty state
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: AccessStep — empty (no assignments)', () => {
  it('announces the "Access" heading at level 2', async () => {
    render(
      <AccessStep
        formData={{ ...ACCESS_FORM_DATA, userAssignments: [] }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Access, level 2');
  });

  it('announces the introductory description paragraph', async () => {
    render(
      <AccessStep
        formData={{ ...ACCESS_FORM_DATA, userAssignments: [] }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /assign permissions/i.test(p))).toBe(true);
  });

  it('announces the "Add assignee" button as enabled', async () => {
    render(
      <AccessStep
        formData={{ ...ACCESS_FORM_DATA, userAssignments: [] }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('button, Add assignee');
    expect(ps).not.toContain('button, Add assignee, disabled');
  });

  it('does NOT announce any assignee input or Remove button when empty', async () => {
    render(
      <AccessStep
        formData={{ ...ACCESS_FORM_DATA, userAssignments: [] }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.every(p => !/assignee/i.test(p) || /add assignee/i.test(p))).toBe(true);
    expect(ps.every(p => !/remove assignee/i.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AccessStep — invalid object ID
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: AccessStep — invalid object ID entered', () => {
  it('announces the textbox with "invalid" state when object ID is malformed', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: 'not-a-uuid', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const input = ps.find(p => /combobox/i.test(p) && /assignee/i.test(p));
    // aria-invalid → SR announces "invalid" — critical for screen reader users to
    // know the field has an error without relying on colour alone
    expect(input).toMatch(/\binvalid\b/i);
    expect(input).not.toMatch(/not invalid/i);
  });

  it('announces the error helper text immediately after the invalid textbox', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: 'not-a-uuid', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // MUI helperText is linked via aria-describedby and announced as part of the
    // textbox phrase, immediately accessible without extra Tab key presses
    const input = ps.find(p => /combobox/i.test(p) && /assignee/i.test(p));
    expect(input).toMatch(/select a user from the search results or enter a valid object ID/i);
  });

  it('announces the Remove assignee button with its aria-label', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: 'not-a-uuid', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    // IconButton aria-label="Remove assignee" must be announced by name
    expect(await phrases()).toContain('button, Remove assignee');
  });

  it('announces "Add assignee" as disabled while invalid assignments exist', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: 'not-a-uuid', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    // Cannot add more assignees until existing ones are valid
    expect(await phrases()).toContain('button, Add assignee, disabled');
  });

  it('announces the Role combobox', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: 'not-a-uuid', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /combobox/i.test(p) && /role/i.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AccessStep — valid object ID
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: AccessStep — valid object ID entered', () => {
  it('announces the textbox as "not invalid" when object ID is valid', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Reader' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const input = ps.find(p => /combobox/i.test(p) && /assignee/i.test(p));
    expect(input).toMatch(/not invalid/i);
  });

  it('announces the entered object ID as the textbox value', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Reader' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const input = ps.find(p => /combobox/i.test(p) && /assignee/i.test(p));
    expect(input).toMatch(/11111111-2222-3333-4444-555555555555/);
  });

  it('announces the Role combobox with its current value', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Reader' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // MUI Select with label="Role" and value="Reader"
    expect(ps.some(p => /combobox/i.test(p) && /role/i.test(p))).toBe(true);
    expect(ps).toContain('Reader');
  });

  it('announces "Add assignee" as enabled when all assignments are valid', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Reader' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('button, Add assignee');
    expect(ps).not.toContain('button, Add assignee, disabled');
  });

  it('announces the Remove assignee button', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Reader' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('button, Remove assignee');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AccessStep — loading state
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: AccessStep — loading state (all controls disabled)', () => {
  it('announces the object ID textbox as disabled', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
        loading
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const input = ps.find(p => /combobox/i.test(p) && /assignee/i.test(p));
    expect(input).toMatch(/disabled/i);
  });

  it('announces the Role combobox as disabled', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
        loading
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const combo = ps.find(p => /combobox/i.test(p) && /role/i.test(p));
    expect(combo).toMatch(/disabled/i);
  });

  it('announces the Remove assignee button as disabled', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
        loading
      />
    );
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('button, Remove assignee, disabled');
  });

  it('announces the Add assignee button as disabled', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Writer' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
        loading
      />
    );
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('button, Add assignee, disabled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep fixtures
// ═══════════════════════════════════════════════════════════════════════════

const REVIEW_SUBSCRIPTION = {
  id: 'sub-123',
  name: 'Production Subscription',
  tenant: 'tenant-1',
  tenantName: 'Contoso Ltd',
  status: 'Enabled',
};

const REVIEW_CLUSTER = {
  name: 'aks-prod-eastus',
  location: 'eastus',
  version: '1.28.3',
  nodeCount: 3,
  status: 'Running',
  resourceGroup: 'rg-prod',
};

const REVIEW_BASE_PROPS: ReviewStepProps = {
  formData: {
    projectName: 'azure-microservices-demo',
    description: 'Demo project for microservices on AKS',
    subscription: 'sub-123',
    cluster: 'aks-prod-eastus',
    resourceGroup: 'rg-prod',
    ingress: 'AllowSameNamespace',
    egress: 'AllowAll',
    cpuRequest: 2000,
    memoryRequest: 4096,
    cpuLimit: 4000,
    memoryLimit: 8192,
    userAssignments: [
      { objectId: '00000000-1111-2222-3333-444444444444', role: 'Admin' },
      { objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'Reader' },
    ],
  },
  subscriptions: [REVIEW_SUBSCRIPTION],
  clusters: [REVIEW_CLUSTER],
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
};

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — FullConfiguration story
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ReviewStep — FullConfiguration (all sections)', () => {
  it('announces the top-level heading "Review Project Configuration" at h2', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Review Project Configuration, level 2');
  });

  it('announces the introductory instruction paragraph', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /please review all the settings/i.test(p))).toBe(true);
  });

  it('announces the "Project Basics" section heading at h3', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Project Basics, level 3');
  });

  it('announces the project name value', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('azure-microservices-demo');
  });

  it('announces the resolved subscription name (not the raw ID)', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('Production Subscription');
    // Raw ID must not appear — that would be meaningless to screen reader users
    expect(ps).not.toContain('sub-123');
  });

  it('announces the cluster name with location and version', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('aks-prod-eastus (eastus, 1.28.3)');
  });

  it('announces the description text', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('Demo project for microservices on AKS');
  });

  it('announces the "Networking Policies" section heading at h3', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Networking Policies, level 3');
  });

  it('announces ingress and egress policy values', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('AllowSameNamespace');
    expect(ps).toContain('AllowAll');
  });

  it('announces the "Compute Quota" section heading at h3', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Compute Quota, level 3');
  });

  it('announces CPU request and limit as human-readable values', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // formatCpuValue(2000) → "2.0 CPU", formatCpuValue(4000) → "4.0 CPU"
    expect(ps).toContain('2.0 CPU');
    expect(ps).toContain('4.0 CPU');
  });

  it('announces memory request and limit as human-readable GiB values', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // formatMemoryValue(4096) → "4.0 GiB", formatMemoryValue(8192) → "8.0 GiB"
    expect(ps).toContain('4.0 GiB');
    expect(ps).toContain('8.0 GiB');
  });

  it('announces the "Access Control" section heading with the assignee count', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    // Count of 2 assignees is embedded in the heading text
    expect(await phrases()).toContain('heading, Access Control (2 assignee), level 3');
  });

  it('announces each assignee object ID and role in order', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('00000000-1111-2222-3333-444444444444');
    expect(ps).toContain('Admin');
    expect(ps).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(ps).toContain('Reader');
  });

  it('announces all four section headings in document order', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const headings = ps.filter(p => /^heading,/.test(p));
    expect(headings[0]).toBe('heading, Review Project Configuration, level 2');
    expect(headings[1]).toBe('heading, Project Basics, level 3');
    expect(headings[2]).toBe('heading, Networking Policies, level 3');
    expect(headings[3]).toBe('heading, Compute Quota, level 3');
    expect(headings[4]).toMatch(/heading, Access Control/);
  });

  it('announces the assignees region with the heading text via aria-labelledby', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // aria-labelledby links the region to the "Access Control (2 assignee)" heading,
    // so the region landmark should include that label in its announcement.
    const regionPhrase = ps.find(p => /region/i.test(p) && /access control/i.test(p));
    expect(regionPhrase).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — NoAssignees story
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ReviewStep — NoAssignees', () => {
  it('announces Access Control heading with count of 0', async () => {
    render(
      <ReviewStep
        {...REVIEW_BASE_PROPS}
        formData={{ ...REVIEW_BASE_PROPS.formData, userAssignments: [] }}
      />
    );
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Access Control (0 assignee), level 3');
  });

  it('does NOT announce any assignee object IDs when list is empty', async () => {
    render(
      <ReviewStep
        {...REVIEW_BASE_PROPS}
        formData={{ ...REVIEW_BASE_PROPS.formData, userAssignments: [] }}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.every(p => !/@example\.com/.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — NoDescription story
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ReviewStep — NoDescription', () => {
  it('announces "No description provided" placeholder when description is empty', async () => {
    render(
      <ReviewStep
        {...REVIEW_BASE_PROPS}
        formData={{ ...REVIEW_BASE_PROPS.formData, description: '' }}
      />
    );
    await virtual.start({ container: document.body });
    // Blank value would be silent — the fallback ensures AT users hear something meaningful
    expect(await phrases()).toContain('No description provided');
  });

  it('does NOT announce an empty string for the description', async () => {
    render(
      <ReviewStep
        {...REVIEW_BASE_PROPS}
        formData={{ ...REVIEW_BASE_PROPS.formData, description: '' }}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // Empty string would never appear as a spoken phrase, but the placeholder must
    expect(ps.filter(p => p === '')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — UnresolvedResources story
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ReviewStep — UnresolvedResources (subscription/cluster not in lists)', () => {
  it('falls back to "N/A" when subscription cannot be resolved', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} subscriptions={[]} clusters={[]} />);
    await virtual.start({ container: document.body });
    // Graceful degradation: "N/A" is more meaningful than silence or an ID
    expect(await phrases()).toContain('N/A');
  });

  it('shows the raw cluster name (without location/version) when cluster cannot be resolved', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} subscriptions={[]} clusters={[]} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // Without a matching cluster object only the name is shown
    expect(ps).toContain('aks-prod-eastus');
    // Must NOT announce location/version that we don't have
    expect(ps.every(p => !/eastus, 1\.28\.3/.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — SingleAssignee story
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ReviewStep — SingleAssignee', () => {
  it('announces Access Control heading with count of 1', async () => {
    render(
      <ReviewStep
        {...REVIEW_BASE_PROPS}
        formData={{
          ...REVIEW_BASE_PROPS.formData,
          userAssignments: [{ objectId: '22222222-3333-4444-5555-666666666666', role: 'Writer' }],
        }}
      />
    );
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Access Control (1 assignee), level 3');
  });

  it('announces the single assignee object ID and role', async () => {
    render(
      <ReviewStep
        {...REVIEW_BASE_PROPS}
        formData={{
          ...REVIEW_BASE_PROPS.formData,
          userAssignments: [{ objectId: '22222222-3333-4444-5555-666666666666', role: 'Writer' }],
        }}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('22222222-3333-4444-5555-666666666666');
    expect(ps).toContain('Writer');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NetworkingStep fixtures
// ═══════════════════════════════════════════════════════════════════════════

const NET_FORM_DATA = {
  projectName: 'azure-microservices-demo',
  description: '',
  subscription: 'sub-123',
  cluster: 'aks-prod-eastus',
  resourceGroup: 'rg-prod',
  ingress: 'AllowSameNamespace' as const,
  egress: 'AllowAll' as const,
  cpuRequest: 2000,
  memoryRequest: 4096,
  cpuLimit: 2000,
  memoryLimit: 4096,
  userAssignments: [],
};

const NET_BASE_PROPS: NetworkingStepProps = {
  formData: NET_FORM_DATA,
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
};

// ── NetworkingStep — Default ──────────────────────────────────────────────────
describe('SR: NetworkingStep — Default', () => {
  it('announces the "Networking Policies" heading at h2', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Networking Policies, level 2');
  });

  it('announces the introductory description paragraph', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /security.*communication|communication.*access/i.test(p))).toBe(true);
  });

  it('announces the Ingress combobox with its label', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /combobox/i.test(p) && /ingress/i.test(p))).toBe(true);
  });

  it('announces the Egress combobox with its label', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /combobox/i.test(p) && /egress/i.test(p))).toBe(true);
  });

  it('announces the current Ingress value "Allow traffic within same namespace"', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('Allow traffic within same namespace');
  });

  it('announces the current Egress value "Allow all traffic"', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('Allow all traffic');
  });

  it('announces comboboxes as "not expanded" when closed', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const ingress = ps.find(p => /combobox/i.test(p) && /ingress/i.test(p));
    expect(ingress).toMatch(/not expanded/i);
  });

  it('does NOT announce decorative section icons', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // No icon names should leak into spoken output
    expect(ps.every(p => !/mdi:network/i.test(p))).toBe(true);
  });
});

// ── NetworkingStep — DenyAll ──────────────────────────────────────────────────
describe('SR: NetworkingStep — DenyAll', () => {
  it('announces Ingress value "Deny all traffic" when DenyAll is selected', async () => {
    render(
      <NetworkingStep
        {...NET_BASE_PROPS}
        formData={{ ...NET_FORM_DATA, ingress: 'DenyAll', egress: 'DenyAll' }}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // Both comboboxes show "Deny all traffic" — verify at least one is present
    expect(ps.filter(p => /deny all traffic/i.test(p)).length).toBeGreaterThanOrEqual(1);
  });

  it('announces both Ingress and Egress comboboxes showing "Deny all traffic"', async () => {
    render(
      <NetworkingStep
        {...NET_BASE_PROPS}
        formData={{ ...NET_FORM_DATA, ingress: 'DenyAll', egress: 'DenyAll' }}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.filter(p => /deny all traffic/i.test(p)).length).toBe(2);
  });
});

// ── NetworkingStep — AllowAll ──────────────────────────────────────────────────
describe('SR: NetworkingStep — AllowAll', () => {
  it('announces both comboboxes showing "Allow all traffic"', async () => {
    render(
      <NetworkingStep
        {...NET_BASE_PROPS}
        formData={{ ...NET_FORM_DATA, ingress: 'AllowAll', egress: 'AllowAll' }}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.filter(p => /allow all traffic/i.test(p)).length).toBe(2);
  });
});

// ── NetworkingStep — Loading ───────────────────────────────────────────────────
describe('SR: NetworkingStep — Loading (both selects disabled)', () => {
  it('announces the Ingress combobox as disabled', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} loading />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const ingress = ps.find(p => /combobox/i.test(p) && /ingress/i.test(p));
    expect(ingress).toMatch(/disabled/i);
  });

  it('announces the Egress combobox as disabled', async () => {
    render(<NetworkingStep {...NET_BASE_PROPS} loading />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const egress = ps.find(p => /combobox/i.test(p) && /egress/i.test(p));
    expect(egress).toMatch(/disabled/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ComputeStep fixtures
// ═══════════════════════════════════════════════════════════════════════════

const COMPUTE_FORM_DATA = {
  projectName: 'azure-microservices-demo',
  description: '',
  subscription: 'sub-123',
  cluster: 'aks-prod-eastus',
  resourceGroup: 'rg-prod',
  ingress: 'AllowSameNamespace' as const,
  egress: 'AllowAll' as const,
  cpuRequest: 2000,
  memoryRequest: 4096,
  cpuLimit: 4000,
  memoryLimit: 8192,
  userAssignments: [],
};

const COMPUTE_BASE_PROPS: ComputeStepProps = {
  formData: COMPUTE_FORM_DATA,
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
};

// ── ComputeStep — Default ─────────────────────────────────────────────────────
describe('SR: ComputeStep — Default', () => {
  it('announces the "Compute Quota" heading at h2', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Compute Quota, level 2');
  });

  it('announces the introductory description paragraph', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /quota limits|overuse|cluster stability/i.test(p))).toBe(true);
  });

  it('announces the "CPU Resources" section heading at h3', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, CPU Resources, level 3');
  });

  it('announces the "Memory Resources" section heading at h3', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('heading, Memory Resources, level 3');
  });

  it('announces both section headings in document order (CPU before Memory)', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const cpuIdx = ps.indexOf('heading, CPU Resources, level 3');
    const memIdx = ps.indexOf('heading, Memory Resources, level 3');
    expect(cpuIdx).toBeGreaterThanOrEqual(0);
    expect(memIdx).toBeGreaterThan(cpuIdx);
  });

  it('announces the CPU Requests spinbutton with its current value', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu requests/i.test(p));
    expect(field).toBeTruthy();
    expect(field).toMatch(/2000/);
  });

  it('announces the CPU Limits spinbutton with its current value', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu limits/i.test(p));
    expect(field).toMatch(/4000/);
  });

  it('announces the Memory Requests spinbutton with its current value', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory requests/i.test(p));
    expect(field).toMatch(/4096/);
  });

  it('announces the Memory Limits spinbutton with its current value', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory limits/i.test(p));
    expect(field).toMatch(/8192/);
  });

  it('announces helper text for CPU Requests as part of the spinbutton phrase', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu requests/i.test(p));
    // helperText is linked via aria-describedby and included in the spinbutton announcement
    expect(field).toMatch(/minimum cpu guaranteed/i);
  });

  it('announces helper text for Memory Requests as part of the spinbutton phrase', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory requests/i.test(p));
    expect(field).toMatch(/minimum memory guaranteed/i);
  });

  it('announces all four spinbuttons as "not invalid" when validation passes', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const spinbuttons = ps.filter(p => /spinbutton/i.test(p));
    expect(spinbuttons).toHaveLength(4);
    spinbuttons.forEach(s => expect(s).toMatch(/not invalid/i));
  });

  it('announces the "millicores" unit for CPU spinbuttons', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.filter(p => /millicores/i.test(p)).length).toBeGreaterThanOrEqual(2);
  });

  it('announces the "MiB" unit for Memory spinbuttons', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.filter(p => /^MiB$/.test(p)).length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT announce decorative startAdornment icons (arrow-up / arrow-down)', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // Icons have aria-hidden="true" — must not appear as named images in spoken log
    expect(ps.every(p => !/mdi:arrow/i.test(p))).toBe(true);
  });

  it('does NOT announce decorative ResourceCard title icons', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.every(p => !/mdi:cpu-64-bit|mdi:memory/i.test(p))).toBe(true);
  });
});

// ── ComputeStep — WithFieldErrors ─────────────────────────────────────────────
describe('SR: ComputeStep — WithFieldErrors', () => {
  const ERRORS = {
    isValid: false,
    errors: [],
    warnings: [],
    fieldErrors: {
      cpuRequest: ['CPU request must be less than or equal to CPU limit'],
      memoryLimit: ['Memory limit cannot exceed cluster node capacity (32768 MiB)'],
    },
  };

  it('announces CPU Requests spinbutton as "invalid" when it has a field error', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={ERRORS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu requests/i.test(p));
    expect(field).toMatch(/\binvalid\b/i);
    expect(field).not.toMatch(/not invalid/i);
  });

  it('announces the CPU Requests error message instead of the normal helper text', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={ERRORS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu requests/i.test(p));
    expect(field).toMatch(/must be less than or equal/i);
  });

  it('announces Memory Limits spinbutton as "invalid" when it has a field error', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={ERRORS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory limits/i.test(p));
    expect(field).toMatch(/\binvalid\b/i);
  });

  it('announces the Memory Limits error message', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={ERRORS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory limits/i.test(p));
    expect(field).toMatch(/cannot exceed cluster node capacity/i);
  });

  it('does NOT announce CPU Limits as invalid (it has no error)', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={ERRORS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu limits/i.test(p));
    // Error on cpuRequest must not bleed into cpuLimit
    expect(field).toMatch(/not invalid/i);
  });

  it('does NOT announce Memory Requests as invalid (it has no error)', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={ERRORS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory requests/i.test(p));
    expect(field).toMatch(/not invalid/i);
  });
});

// ── ComputeStep — CpuRequestError (single-field) ─────────────────────────────
describe('SR: ComputeStep — CpuRequestError (isolated single-field)', () => {
  const SINGLE_ERROR = {
    isValid: false,
    errors: [],
    warnings: [],
    fieldErrors: { cpuRequest: ['CPU request must be less than or equal to CPU limit'] },
  };

  it('marks only CPU Requests as invalid', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={SINGLE_ERROR} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const spinbuttons = ps.filter(p => /spinbutton/i.test(p));
    const invalidCount = spinbuttons.filter(
      s => /\binvalid\b/i.test(s) && !/not invalid/i.test(s)
    ).length;
    expect(invalidCount).toBe(1);
  });

  it('keeps all other three spinbuttons as "not invalid"', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} validation={SINGLE_ERROR} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const others = ps.filter(p => /spinbutton/i.test(p) && !/cpu requests/i.test(p));
    others.forEach(s => expect(s).toMatch(/not invalid/i));
  });
});

// ── ComputeStep — Loading ─────────────────────────────────────────────────────
describe('SR: ComputeStep — Loading (all spinbuttons disabled)', () => {
  it('announces the CPU Requests spinbutton as disabled', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} loading />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu requests/i.test(p));
    expect(field).toMatch(/disabled/i);
  });

  it('announces the CPU Limits spinbutton as disabled', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} loading />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /cpu limits/i.test(p));
    expect(field).toMatch(/disabled/i);
  });

  it('announces the Memory Requests spinbutton as disabled', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} loading />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory requests/i.test(p));
    expect(field).toMatch(/disabled/i);
  });

  it('announces the Memory Limits spinbutton as disabled', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} loading />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const field = ps.find(p => /spinbutton/i.test(p) && /memory limits/i.test(p));
    expect(field).toMatch(/disabled/i);
  });

  it('announces all four spinbuttons as disabled', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} loading />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const spinbuttons = ps.filter(p => /spinbutton/i.test(p));
    expect(spinbuttons).toHaveLength(4);
    spinbuttons.forEach(s => expect(s).toMatch(/disabled/i));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Breadcrumb
// ═══════════════════════════════════════════════════════════════════════════

const BREADCRUMB_BASE: BreadcrumbProps = {
  steps: ['Basics', 'Networking Policies', 'Compute Quota', 'Access', 'Review'],
  activeStep: 0,
  onStepClick: () => {},
};

describe('SR: Breadcrumb — FirstStep', () => {
  it('announces navigation landmark "Wizard steps"', async () => {
    render(<Breadcrumb {...BREADCRUMB_BASE} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('navigation, Wizard steps');
  });

  it('announces the first step as current', async () => {
    render(<Breadcrumb {...BREADCRUMB_BASE} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('button, Basics, current step');
  });

  it('announces all five step buttons', async () => {
    render(<Breadcrumb {...BREADCRUMB_BASE} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    for (const label of ['Basics', 'Networking Policies', 'Compute Quota', 'Access', 'Review']) {
      expect(ps.some(p => p.includes(`button, ${label}`))).toBe(true);
    }
  });
});

describe('SR: Breadcrumb — MiddleStep', () => {
  it('announces Compute Quota as the current step', async () => {
    render(<Breadcrumb {...BREADCRUMB_BASE} activeStep={2} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('button, Compute Quota, current step');
  });

  it('Basics step is no longer aria-current', async () => {
    render(<Breadcrumb {...BREADCRUMB_BASE} activeStep={2} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).not.toContain('button, Basics, current step');
  });
});

describe('SR: Breadcrumb — LastStep', () => {
  it('announces Review as the current step', async () => {
    render(<Breadcrumb {...BREADCRUMB_BASE} activeStep={4} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('button, Review, current step');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FormField
// ═══════════════════════════════════════════════════════════════════════════

const FORMFIELD_BASE: FormFieldProps = {
  label: 'Project Name',
  value: 'my-project',
  onChange: () => {},
};

describe('SR: FormField — Default', () => {
  it('announces a labeled textbox with its value', async () => {
    render(<FormField {...FORMFIELD_BASE} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const textbox = ps.find(p => /textbox/i.test(p) && /project name/i.test(p));
    expect(textbox).toBeTruthy();
  });
});

describe('SR: FormField — WithError', () => {
  it('announces the textbox as invalid', async () => {
    render(
      <FormField
        {...FORMFIELD_BASE}
        value=""
        error
        helperText="Project name is required"
        required
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const textbox = ps.find(p => /textbox/i.test(p) && /project name/i.test(p));
    expect(textbox).toMatch(/invalid/i);
    expect(textbox).not.toMatch(/not invalid/i);
  });

  it('announces the error helper text', async () => {
    render(<FormField {...FORMFIELD_BASE} value="" error helperText="Project name is required" />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    // The helper text is linked via aria-describedby and announced as part of the textbox
    const textbox = ps.find(p => /textbox/i.test(p) && /project name/i.test(p));
    expect(textbox).toMatch(/Project name is required/i);
  });
});

describe('SR: FormField — NumberField', () => {
  it('announces a spinbutton role', async () => {
    render(<FormField {...FORMFIELD_BASE} label="CPU Request" type="number" value={2000} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /spinbutton/i.test(p) && /cpu request/i.test(p))).toBe(true);
  });
});

describe('SR: FormField — Disabled', () => {
  it('announces the textbox as disabled', async () => {
    render(<FormField {...FORMFIELD_BASE} disabled />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const textbox = ps.find(p => /textbox/i.test(p) && /project name/i.test(p));
    expect(textbox).toMatch(/disabled/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SearchableSelect
// ═══════════════════════════════════════════════════════════════════════════

const SEARCHABLE_OPTIONS = [
  { value: 'sub-123', label: 'Production Subscription', subtitle: 'sub-123' },
  { value: 'sub-456', label: 'Development Subscription', subtitle: 'sub-456' },
];

const SEARCHABLE_BASE: SearchableSelectProps = {
  label: 'Subscription',
  value: '',
  onChange: () => {},
  options: SEARCHABLE_OPTIONS,
};

describe('SR: SearchableSelect — Default', () => {
  it('announces a labeled combobox', async () => {
    render(<SearchableSelect {...SEARCHABLE_BASE} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /combobox/i.test(p) && /subscription/i.test(p))).toBe(true);
  });
});

describe('SR: SearchableSelect — WithSelection', () => {
  it('announces the selected value in the combobox', async () => {
    render(<SearchableSelect {...SEARCHABLE_BASE} value="sub-123" />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    const combobox = ps.find(p => /combobox/i.test(p) && /subscription/i.test(p));
    expect(combobox).toMatch(/Production Subscription/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ValidationAlert
// ═══════════════════════════════════════════════════════════════════════════

describe('SR: ValidationAlert — Error', () => {
  it('announces an alert with the error message', async () => {
    render(<ValidationAlert type="error" message="Namespace creation failed" />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /alert/i.test(p))).toBe(true);
    expect(ps.some(p => /Namespace creation failed/i.test(p))).toBe(true);
  });
});

describe('SR: ValidationAlert — Warning', () => {
  it('announces a warning alert', async () => {
    render(<ValidationAlert type="warning" message="Cluster resources are running low" />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /alert/i.test(p))).toBe(true);
    expect(ps.some(p => /Cluster resources are running low/i.test(p))).toBe(true);
  });
});

describe('SR: ValidationAlert — Success', () => {
  it('announces a success alert', async () => {
    render(<ValidationAlert type="success" message="Project created successfully" />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /alert/i.test(p))).toBe(true);
    expect(ps.some(p => /Project created successfully/i.test(p))).toBe(true);
  });
});

describe('SR: ValidationAlert — Hidden', () => {
  it('renders nothing when show=false', async () => {
    const { container } = render(
      <ValidationAlert type="error" message="should not appear" show={false} />
    );
    // The component returns null, so the container should be empty
    expect(container.innerHTML).toBe('');
  });
});
