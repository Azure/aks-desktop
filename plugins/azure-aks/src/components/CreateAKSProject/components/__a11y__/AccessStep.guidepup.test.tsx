// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Screen reader tests for the **AccessStep** component:
 * empty state, invalid/valid object IDs, and loading (disabled) state.
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
import { AccessStep } from '../AccessStep';
import { phrases } from './guidepup-setup';

// ── Fixtures ─────────────────────────────────────────────────────────────────

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
  const VALID_ID = '11111111-2222-3333-4444-555555555555';

  it('announces the textbox as "not invalid" when object ID is valid', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: VALID_ID, role: 'Reader' }],
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
          userAssignments: [{ objectId: VALID_ID, role: 'Reader' }],
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
          userAssignments: [{ objectId: VALID_ID, role: 'Reader' }],
        }}
        onFormDataChange={() => {}}
        validation={ACCESS_VALIDATION}
      />
    );
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps.some(p => /combobox/i.test(p) && /role/i.test(p))).toBe(true);
    expect(ps).toContain('Reader');
  });

  it('announces "Add assignee" as enabled when all assignments are valid', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: VALID_ID, role: 'Reader' }],
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
          userAssignments: [{ objectId: VALID_ID, role: 'Reader' }],
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
  const VALID_ID = '11111111-2222-3333-4444-555555555555';

  it('announces the object ID textbox as disabled', async () => {
    render(
      <AccessStep
        formData={{
          ...ACCESS_FORM_DATA,
          userAssignments: [{ objectId: VALID_ID, role: 'Writer' }],
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
          userAssignments: [{ objectId: VALID_ID, role: 'Writer' }],
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
          userAssignments: [{ objectId: VALID_ID, role: 'Writer' }],
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
          userAssignments: [{ objectId: VALID_ID, role: 'Writer' }],
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
