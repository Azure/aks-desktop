// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Screen reader tests for **ComputeStep**:
 * default, field errors, single-field error, and loading scenarios.
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
import { ComputeStep } from '../../../shared/ComputeStep';
import type { ComputeStepProps } from '../../types';
import { phrases } from './guidepup-setup';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
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

// ── ComputeStep — Default ───────────────────────────────────────────────────
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
    expect(ps.every(p => !/mdi:arrow/i.test(p))).toBe(true);
  });

  it('does NOT announce decorative ResourceCard title icons', async () => {
    render(<ComputeStep {...COMPUTE_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.every(p => !/mdi:cpu-64-bit|mdi:memory/i.test(p))).toBe(true);
  });
});

// ── ComputeStep — WithFieldErrors ────────────────────────────────────────────
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

// ── ComputeStep — CpuRequestError (single-field) ────────────────────────────
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

// ── ComputeStep — Loading ───────────────────────────────────────────────────
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
