// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { NetworkingStep } from '../../shared/NetworkingStep';
import type { NetworkingStepProps } from '../types';

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
  cpuLimit: 2000,
  memoryLimit: 4096,
  userAssignments: [],
};

const BASE_PROPS: NetworkingStepProps = {
  formData: BASE_FORM_DATA,
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
};

export default {
  title: 'CreateAKSProject/NetworkingStep',
  component: NetworkingStep,
} as Meta;

const Template: StoryFn<NetworkingStepProps> = args => <NetworkingStep {...args} />;

/**
 * Default state — ingress set to "Allow same namespace", egress set to "Allow all".
 * These are the most permissive-but-safe defaults.
 */
export const Default = Template.bind({});
Default.args = BASE_PROPS;

/**
 * Strict / locked-down configuration — both ingress and egress set to "Deny all".
 * Exercises the DenyAll path for both selects simultaneously.
 */
export const DenyAll = Template.bind({});
DenyAll.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, ingress: 'DenyAll', egress: 'DenyAll' },
};

/**
 * Allow-all configuration — maximum permissiveness; useful for development
 * namespaces where policies are not yet required.
 */
export const AllowAll = Template.bind({});
AllowAll.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, ingress: 'AllowAll', egress: 'AllowAll' },
};

/**
 * Loading state — both selects are disabled while Azure resources are
 * loading or a submission is in flight.
 */
export const Loading = Template.bind({});
Loading.args = { ...BASE_PROPS, loading: true };
