// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { AccessStepProps } from '../types';
import { AccessStep } from './AccessStep';

const BASE_FORM_DATA = {
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

const BASE_PROPS: AccessStepProps = {
  formData: BASE_FORM_DATA,
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
};

const meta: Meta<typeof AccessStep> = {
  title: 'CreateAKSProject/AccessStep',
  component: AccessStep,
};
export default meta;

/** Default state with one valid assignee. */
export const Default: StoryFn<AccessStepProps> = () => <AccessStep {...BASE_PROPS} />;

/** Multiple assignees with different roles. */
export const MultipleAssignees: StoryFn<AccessStepProps> = () => (
  <AccessStep
    {...BASE_PROPS}
    formData={{
      ...BASE_FORM_DATA,
      userAssignments: [
        { objectId: '00000000-1111-2222-3333-444444444444', role: 'Admin' },
        { objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'Writer' },
        { objectId: '11111111-2222-3333-4444-555555555555', role: 'Reader' },
      ],
    }}
  />
);

/** Empty state with no assignees. */
export const NoAssignees: StoryFn<AccessStepProps> = () => (
  <AccessStep {...BASE_PROPS} formData={{ ...BASE_FORM_DATA, userAssignments: [] }} />
);

/** Invalid object ID triggers validation error. */
export const InvalidObjectId: StoryFn<AccessStepProps> = () => (
  <AccessStep
    {...BASE_PROPS}
    formData={{
      ...BASE_FORM_DATA,
      userAssignments: [{ objectId: 'not-a-uuid', role: 'Writer' }],
    }}
  />
);

/** Loading state disables all controls. */
export const Loading: StoryFn<AccessStepProps> = () => <AccessStep {...BASE_PROPS} loading />;
