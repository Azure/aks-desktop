// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { ReviewStepProps } from '../types';
import { ReviewStep } from './ReviewStep';

const SUBSCRIPTION = {
  id: 'sub-123',
  name: 'Production Subscription',
  tenant: 'tenant-1',
  tenantName: 'Contoso Ltd',
  status: 'Enabled',
};

const CLUSTER = {
  name: 'aks-prod-eastus',
  location: 'eastus',
  version: '1.28.3',
  nodeCount: 3,
  status: 'Running',
  resourceGroup: 'rg-prod',
};

const BASE_FORM_DATA = {
  projectName: 'azure-microservices-demo',
  description: 'Demo project for microservices on AKS',
  subscription: 'sub-123',
  cluster: 'aks-prod-eastus',
  resourceGroup: 'rg-prod',
  ingress: 'AllowSameNamespace' as const,
  egress: 'AllowAll' as const,
  cpuRequest: 2000,
  memoryRequest: 4096,
  cpuLimit: 4000,
  memoryLimit: 8192,
  userAssignments: [
    { objectId: '00000000-1111-2222-3333-444444444444', role: 'Admin' },
    { objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'Reader' },
  ],
};

const BASE_PROPS: ReviewStepProps = {
  formData: BASE_FORM_DATA,
  subscriptions: [SUBSCRIPTION],
  clusters: [CLUSTER],
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
};

export default {
  title: 'CreateAKSProject/ReviewStep',
  component: ReviewStep,
} as Meta;

const Template: StoryFn<ReviewStepProps> = args => <ReviewStep {...args} />;

/**
 * Full configuration — two assignees, description filled, cluster resolved from
 * the subscriptions/clusters lists so location + version are shown.
 */
export const FullConfiguration = Template.bind({});
FullConfiguration.args = BASE_PROPS;

/**
 * No assignees — Access Control section shows the count "(0 assignee)" and
 * renders an empty scrollable box.
 */
export const NoAssignees = Template.bind({});
NoAssignees.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, userAssignments: [] },
};

/**
 * No description — falls back to the "No description provided" placeholder so
 * screen readers are never left with a blank field.
 */
export const NoDescription = Template.bind({});
NoDescription.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, description: '' },
};

/**
 * Unresolved subscription / cluster — subscription and cluster IDs do not
 * match anything in the lists, so the component falls back to "N/A" /
 * the raw cluster name.  Exercises the graceful-degradation path.
 */
export const UnresolvedResources = Template.bind({});
UnresolvedResources.args = {
  ...BASE_PROPS,
  subscriptions: [],
  clusters: [],
};

/**
 * Single assignee with Writer role.
 */
export const SingleAssignee = Template.bind({});
SingleAssignee.args = {
  ...BASE_PROPS,
  formData: {
    ...BASE_FORM_DATA,
    userAssignments: [{ objectId: '11111111-2222-3333-4444-555555555555', role: 'Writer' }],
  },
};

/**
 * Many assignees — the Access Control region overflows its 200 px max-height,
 * making it keyboard-scrollable (Tab to focus the region, then ↑/↓ to scroll).
 * Use this story to verify that the scrollable-region-focusable a11y requirement
 * is satisfied and that all assignees are reachable by keyboard.
 */
export const ManyAssignees = Template.bind({});
ManyAssignees.args = {
  ...BASE_PROPS,
  formData: {
    ...BASE_FORM_DATA,
    userAssignments: [
      { objectId: '00000000-1111-2222-3333-444444444444', role: 'Admin' },
      { objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'Reader' },
      { objectId: '11111111-2222-3333-4444-555555555555', role: 'Writer' },
      { objectId: '22222222-3333-4444-5555-666666666666', role: 'Admin' },
      { objectId: '33333333-4444-5555-6666-777777777777', role: 'Reader' },
      { objectId: '44444444-5555-6666-7777-888888888888', role: 'Writer' },
      { objectId: '55555555-6666-7777-8888-999999999999', role: 'Reader' },
      { objectId: '66666666-7777-8888-9999-aaaaaaaaaaaa', role: 'Admin' },
    ],
  },
};
