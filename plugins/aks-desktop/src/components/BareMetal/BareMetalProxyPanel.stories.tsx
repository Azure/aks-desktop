// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import BareMetalProxyPanel, { BareMetalProxyPanelProps } from './BareMetalProxyPanel';

const noOp = () => {};

const baseArgs: BareMetalProxyPanelProps = {
  proxyStatus: null,
  proxyActionLoading: false,
  disabled: false,
  onProxyStart: noOp,
  onProxyStop: noOp,
  onProxyRestart: noOp,
  onProxyRefresh: noOp,
};

export default {
  title: 'BareMetal/ProxyPanel',
  component: BareMetalProxyPanel,
} as Meta;

const Template: StoryFn<BareMetalProxyPanelProps> = args => <BareMetalProxyPanel {...args} />;

export const Unknown = Template.bind({});
Unknown.args = { ...baseArgs };

export const Stopped = Template.bind({});
Stopped.args = {
  ...baseArgs,
  proxyStatus: { status: 'stopped', pid: null, lastError: null },
};

export const Running = Template.bind({});
Running.args = {
  ...baseArgs,
  proxyStatus: { status: 'running', pid: 4242, lastError: null },
};

export const ErrorState = Template.bind({});
ErrorState.args = {
  ...baseArgs,
  proxyStatus: {
    status: 'error',
    pid: null,
    lastError: 'Unable to reach BareMetal proxy endpoint',
  },
};

export const ActionLoading = Template.bind({});
ActionLoading.args = {
  ...baseArgs,
  proxyActionLoading: true,
  proxyStatus: { status: 'stopped', pid: null, lastError: null },
};

export const Disabled = Template.bind({});
Disabled.args = {
  ...baseArgs,
  disabled: true,
  proxyStatus: { status: 'stopped', pid: null, lastError: null },
};
