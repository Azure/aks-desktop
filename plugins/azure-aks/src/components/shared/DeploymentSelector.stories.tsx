// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { DeploymentSelector } from './DeploymentSelector';

const deployments = [{ name: 'api-server' }, { name: 'worker' }, { name: 'frontend' }];

export default {
  title: 'shared/DeploymentSelector',
  component: DeploymentSelector,
  args: {
    onDeploymentChange: () => {},
  },
} as Meta<typeof DeploymentSelector>;

const Template: StoryFn<typeof DeploymentSelector> = args => <DeploymentSelector {...args} />;

export const WithDeployments = Template.bind({});
WithDeployments.args = {
  selectedDeployment: 'api-server',
  deployments,
};

export const Loading = Template.bind({});
Loading.args = {
  selectedDeployment: '',
  deployments: [],
  loading: true,
};

export const Empty = Template.bind({});
Empty.args = {
  selectedDeployment: '',
  deployments: [],
  loading: false,
};

export const CustomWidth = Template.bind({});
CustomWidth.args = {
  selectedDeployment: 'frontend',
  deployments,
  sx: { minWidth: 350 },
};
