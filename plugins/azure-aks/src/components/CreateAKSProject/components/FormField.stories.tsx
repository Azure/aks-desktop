// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { FormFieldProps } from '../../shared/FormField';
import { FormField } from '../../shared/FormField';

const BASE_PROPS: FormFieldProps = {
  label: 'Project Name',
  value: 'my-project',
  onChange: () => {},
};

const meta: Meta<typeof FormField> = {
  title: 'CreateAKSProject/FormField',
  component: FormField,
};
export default meta;

/** Default text field. */
export const Default: StoryFn<FormFieldProps> = () => <FormField {...BASE_PROPS} />;

/** Field with error. */
export const WithError: StoryFn<FormFieldProps> = () => (
  <FormField {...BASE_PROPS} value="" error helperText="Project name is required" required />
);

/** Number field. */
export const NumberField: StoryFn<FormFieldProps> = () => (
  <FormField
    {...BASE_PROPS}
    label="CPU Request"
    type="number"
    value={2000}
    helperText="Minimum CPU guaranteed (1000m = 1 CPU core)"
  />
);

/** Disabled field. */
export const Disabled: StoryFn<FormFieldProps> = () => (
  <FormField {...BASE_PROPS} disabled helperText="This field is disabled" />
);

/** Multiline textarea. */
export const Multiline: StoryFn<FormFieldProps> = () => (
  <FormField
    {...BASE_PROPS}
    label="Description"
    value="A multi-line description for the project"
    multiline
    rows={4}
  />
);
