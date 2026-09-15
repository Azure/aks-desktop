// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import ConfigureYAML, { ConfigureYAMLProps } from './ConfigureYAML';

export default {
  title: 'DeployWizard/ConfigureYAML',
  component: ConfigureYAML,
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} as Meta;

const Template: StoryFn<ConfigureYAMLProps> = args => <ConfigureYAML {...args} />;

const noOp = () => {};

/** Empty editor — initial state with no YAML content. */
export const Empty = Template.bind({});
Empty.args = {
  yamlEditorValue: '',
  yamlError: null,
  onYamlChange: noOp,
  onYamlErrorChange: noOp,
};

/** Editor with sample YAML content. */
export const WithContent = Template.bind({});
WithContent.args = {
  yamlEditorValue: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3`,
  yamlError: null,
  onYamlChange: noOp,
  onYamlErrorChange: noOp,
};

/** Editor with a YAML validation error. */
export const WithError = Template.bind({});
WithError.args = {
  yamlEditorValue: '{ invalid: yaml: }',
  yamlError: 'Invalid YAML: unexpected token at line 1, column 16',
  onYamlChange: noOp,
  onYamlErrorChange: noOp,
};
