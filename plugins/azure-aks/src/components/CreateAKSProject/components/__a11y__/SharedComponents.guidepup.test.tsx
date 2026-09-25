// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Screen reader tests for shared primitives: **Breadcrumb**, **FormField**,
 * **SearchableSelect**, and **ValidationAlert**.
 */

import { render } from '@testing-library/react';
import React from 'react';
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
import { Breadcrumb } from '../../../shared/Breadcrumb';
import type { FormFieldProps } from '../../../shared/FormField';
import { FormField } from '../../../shared/FormField';
import type { SearchableSelectProps } from '../../../shared/SearchableSelect';
import { SearchableSelect } from '../../../shared/SearchableSelect';
import type { BreadcrumbProps } from '../../types';
import { ValidationAlert } from '../ValidationAlert';
import { phrases } from './guidepup-setup';

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
    expect(container.innerHTML).toBe('');
  });
});
