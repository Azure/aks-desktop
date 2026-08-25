// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormData } from '../types';
import { AccessStep } from './AccessStep';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock('../../../utils/azure/az-ad', () => ({
  resolveAzureADUser: vi.fn().mockResolvedValue({ success: false }),
  searchAzureADUsers: vi.fn().mockResolvedValue({ success: true, users: [] }),
}));

const formData: FormData = {
  projectName: 'project',
  description: '',
  subscription: 'subscription',
  cluster: 'cluster',
  resourceGroup: 'resource-group',
  ingress: 'AllowSameNamespace',
  egress: 'AllowSameNamespace',
  cpuRequest: 1,
  memoryRequest: 1,
  cpuLimit: 1,
  memoryLimit: 1,
  userAssignments: [
    {
      objectId: '',
      upn: 'someone@contoso.com',
      displayName: 'someone@contoso.com',
      role: 'Writer',
    },
  ],
};

describe('AccessStep', () => {
  afterEach(cleanup);

  it('clears a stale display name when a manually entered UPN is cleared', () => {
    const onFormDataChange = vi.fn();
    render(
      <AccessStep
        formData={formData}
        onFormDataChange={onFormDataChange}
        validation={{ isValid: false, errors: [], warnings: [] }}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: /Assignee 1/i }), {
      target: { value: '' },
    });

    expect(onFormDataChange).toHaveBeenCalledWith({
      userAssignments: [{ objectId: '', upn: undefined, displayName: '', role: 'Writer' }],
    });
  });

  it('retains a manual UPN when an object ID is entered for native RBAC', () => {
    const onFormDataChange = vi.fn();
    render(
      <AccessStep
        formData={formData}
        onFormDataChange={onFormDataChange}
        validation={{ isValid: false, errors: [], warnings: [] }}
        requiresUpn
      />
    );

    expect(screen.getByRole('textbox', { name: /Assignee 1 UPN/i })).toHaveValue(
      'someone@contoso.com'
    );
    fireEvent.change(screen.getByRole('combobox', { name: /Assignee 1/i }), {
      target: { value: '00000000-1111-2222-3333-444444444444' },
    });

    expect(onFormDataChange).toHaveBeenCalledWith({
      userAssignments: [
        {
          objectId: '00000000-1111-2222-3333-444444444444',
          upn: 'someone@contoso.com',
          displayName: '',
          role: 'Writer',
        },
      ],
    });
  });
});
