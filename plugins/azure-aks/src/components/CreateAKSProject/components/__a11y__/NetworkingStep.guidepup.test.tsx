// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Screen reader tests for **NetworkingStep**:
 * default, DenyAll/AllowAll, and loading scenarios.
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
import { NetworkingStep } from '../../../shared/NetworkingStep';
import type { NetworkingStepProps } from '../../types';
import { phrases } from './guidepup-setup';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
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
    expect(ps.every(p => !/mdi:network/i.test(p))).toBe(true);
  });
});

// ── NetworkingStep — DenyAll ──────────────────────────────────────────────────
describe('SR: NetworkingStep — DenyAll', () => {
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

// ── NetworkingStep — AllowAll ────────────────────────────────────────────────
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

// ── NetworkingStep — Loading ─────────────────────────────────────────────────
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
