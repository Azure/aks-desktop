// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import SourceStep, { SourceStepProps } from './SourceStep';

export default {
  title: 'DeployWizard/SourceStep',
  component: SourceStep,
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} as Meta;

const Template: StoryFn<SourceStepProps> = args => <SourceStep {...args} />;

const noOp = () => {};

/** No source selected — both cards show "not pressed". */
export const NoSelection = Template.bind({});
NoSelection.args = {
  sourceType: null,
  onSourceTypeChange: noOp,
};

/** Container Image source selected. */
export const ContainerSelected = Template.bind({});
ContainerSelected.args = {
  sourceType: 'container',
  onSourceTypeChange: noOp,
};

/** Kubernetes YAML source selected. */
export const YamlSelected = Template.bind({});
YamlSelected.args = {
  sourceType: 'yaml',
  onSourceTypeChange: noOp,
};
