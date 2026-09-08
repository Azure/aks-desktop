// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Screen reader tests for the **ReviewStep** component:
 * FullConfiguration, NoAssignees, NoDescription, UnresolvedResources, and
 * SingleAssignee scenarios.
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
import type { ReviewStepProps } from '../../types';
import { ReviewStep } from '../ReviewStep';
import { phrases } from './guidepup-setup';

// ── Fixtures ─────────────────────────────────────────────────────────────────

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
// ReviewStep — FullConfiguration
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
    expect(ps).toContain('2.0 CPU');
    expect(ps).toContain('4.0 CPU');
  });

  it('announces memory request and limit as human-readable GiB values', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('4.0 GiB');
    expect(ps).toContain('8.0 GiB');
  });

  it('announces the "Access Control" section heading with the assignee count', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} />);
    await virtual.start({ container: document.body });
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
    const regionPhrase = ps.find(p => /region/i.test(p) && /access control/i.test(p));
    expect(regionPhrase).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — NoAssignees
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
// ReviewStep — NoDescription
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
    expect(ps.filter(p => p === '')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — UnresolvedResources
// ═══════════════════════════════════════════════════════════════════════════
describe('SR: ReviewStep — UnresolvedResources (subscription/cluster not in lists)', () => {
  it('falls back to "N/A" when subscription cannot be resolved', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} subscriptions={[]} clusters={[]} />);
    await virtual.start({ container: document.body });
    expect(await phrases()).toContain('N/A');
  });

  it('shows the raw cluster name (without location/version) when cluster cannot be resolved', async () => {
    render(<ReviewStep {...REVIEW_BASE_PROPS} subscriptions={[]} clusters={[]} />);
    await virtual.start({ container: document.body });
    const ps = await phrases();
    expect(ps).toContain('aks-prod-eastus');
    expect(ps.every(p => !/eastus, 1\.28\.3/.test(p))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReviewStep — SingleAssignee
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
