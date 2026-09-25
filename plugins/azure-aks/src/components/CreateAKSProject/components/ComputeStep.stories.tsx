// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { ComputeStep } from '../../shared/ComputeStep';
import type { ComputeStepProps } from '../types';

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
  userAssignments: [],
};

const BASE_PROPS: ComputeStepProps = {
  formData: BASE_FORM_DATA,
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
};

export default {
  title: 'CreateAKSProject/ComputeStep',
  component: ComputeStep,
} as Meta;

const Template: StoryFn<ComputeStepProps> = args => <ComputeStep {...args} />;

/**
 * Default state — CPU request 2 cores / limit 4 cores, memory request 4 GiB / limit 8 GiB.
 * All fields valid; helper text shows units guidance.
 */
export const Default = Template.bind({});
Default.args = BASE_PROPS;

/**
 * Validation error on CPU request and memory limit.
 * Both fields are marked invalid and show their field-level error messages instead
 * of the normal helper text.
 */
export const WithFieldErrors = Template.bind({});
WithFieldErrors.args = {
  ...BASE_PROPS,
  validation: {
    isValid: false,
    errors: [],
    warnings: [],
    fieldErrors: {
      cpuRequest: ['CPU request must be less than or equal to CPU limit'],
      memoryLimit: ['Memory limit cannot exceed cluster node capacity (32768 MiB)'],
    },
  },
};

/**
 * CPU request error only — isolated single-field failure.
 * Verifies that an error on one field does not pollute sibling fields.
 */
export const CpuRequestError = Template.bind({});
CpuRequestError.args = {
  ...BASE_PROPS,
  validation: {
    isValid: false,
    errors: [],
    warnings: [],
    fieldErrors: { cpuRequest: ['CPU request must be less than or equal to CPU limit'] },
  },
};

/**
 * Loading state — all four spinbuttons are disabled while a request is in flight.
 */
export const Loading = Template.bind({});
Loading.args = { ...BASE_PROPS, loading: true };
