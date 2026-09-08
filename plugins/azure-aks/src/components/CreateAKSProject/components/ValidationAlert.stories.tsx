// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Button } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { ValidationAlertProps } from '../types';
import { ValidationAlert } from './ValidationAlert';

const meta: Meta<typeof ValidationAlert> = {
  title: 'CreateAKSProject/ValidationAlert',
  component: ValidationAlert,
};
export default meta;

/** Error alert. */
export const Error: StoryFn<ValidationAlertProps> = () => (
  <ValidationAlert type="error" message="Namespace creation failed: insufficient quota" />
);

/** Warning alert. */
export const Warning: StoryFn<ValidationAlertProps> = () => (
  <ValidationAlert type="warning" message="Cluster resources are running low" />
);

/** Success alert. */
export const Success: StoryFn<ValidationAlertProps> = () => (
  <ValidationAlert type="success" message="Project created successfully" />
);

/** Info alert. */
export const Info: StoryFn<ValidationAlertProps> = () => (
  <ValidationAlert type="info" message="Cluster is being configured" />
);

/** Alert with action button. */
export const WithAction: StoryFn<ValidationAlertProps> = () => (
  <ValidationAlert
    type="error"
    message="Failed to connect to cluster"
    action={
      <Button color="inherit" size="small">
        Retry
      </Button>
    }
  />
);

/** Hidden alert (show=false). */
export const Hidden: StoryFn<ValidationAlertProps> = () => (
  <ValidationAlert type="error" message="This should not be visible" show={false} />
);
