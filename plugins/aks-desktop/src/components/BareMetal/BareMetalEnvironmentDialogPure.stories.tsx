// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import BareMetalEnvironmentDialogPure, {
  BareMetalEnvironmentDialogPureProps,
} from './BareMetalEnvironmentDialogPure';

const noOp = () => {};

const baseArgs: BareMetalEnvironmentDialogPureProps = {
  open: true,
  isLoggedIn: true,
  isChecking: false,
  formData: {
    subscription: '',
    groupName: '',
    location: '',
    username: '',
    password: '',
    vmName: '',
  },
  loading: false,
  loadingAction: null,
  error: '',
  success: '',
  extensionStatus: {
    installed: true,
    installing: false,
    error: null,
    showSuccess: false,
  },
  onClose: noOp,
  onChange: noOp,
  onSetup: noOp,
  onTeardown: noOp,
  onDismissError: noOp,
  onDismissSuccess: noOp,
  onInstallExtensions: noOp,
};

export default {
  title: 'BareMetal/EnvironmentDialog',
  component: BareMetalEnvironmentDialogPure,
} as Meta;

const Template: StoryFn<BareMetalEnvironmentDialogPureProps> = args => (
  <BareMetalEnvironmentDialogPure {...args} />
);

export const Default = Template.bind({});
Default.args = { ...baseArgs };

export const NotLoggedIn = Template.bind({});
NotLoggedIn.args = { ...baseArgs, isLoggedIn: false };

export const CheckingAuth = Template.bind({});
CheckingAuth.args = { ...baseArgs, isChecking: true, isLoggedIn: false };

export const FilledForm = Template.bind({});
FilledForm.args = {
  ...baseArgs,
  formData: {
    subscription: '00000000-0000-0000-0000-000000000000',
    groupName: 'jumpstart-rg',
    location: 'eastus',
    username: 'adminuser',
    password: 'P@ssw0rd!',
    vmName: 'jumpstartVM',
  },
};

export const SetupLoading = Template.bind({});
SetupLoading.args = {
  ...baseArgs,
  loading: true,
  loadingAction: 'setup',
  formData: {
    subscription: '00000000-0000-0000-0000-000000000000',
    groupName: 'jumpstart-rg',
    location: 'eastus',
    username: 'adminuser',
    password: 'P@ssw0rd!',
    vmName: 'jumpstartVM',
  },
};

export const TeardownLoading = Template.bind({});
TeardownLoading.args = {
  ...baseArgs,
  loading: true,
  loadingAction: 'teardown',
  formData: {
    subscription: '00000000-0000-0000-0000-000000000000',
    groupName: '',
    location: '',
    username: '',
    password: '',
    vmName: '',
  },
};

export const WithError = Template.bind({});
WithError.args = {
  ...baseArgs,
  error: 'Failed to provision VM: Quota exceeded in region eastus',
};

export const WithSuccess = Template.bind({});
WithSuccess.args = {
  ...baseArgs,
  success: 'BareMetal environment created successfully!\nResource group: jumpstart-rg',
};

export const ExtensionsRequired = Template.bind({});
ExtensionsRequired.args = {
  ...baseArgs,
  extensionStatus: {
    installed: false,
    installing: false,
    error: null,
    showSuccess: false,
  },
};

export const ExtensionsInstalling = Template.bind({});
ExtensionsInstalling.args = {
  ...baseArgs,
  extensionStatus: {
    installed: false,
    installing: true,
    error: null,
    showSuccess: false,
  },
};

export const ExtensionsInstalled = Template.bind({});
ExtensionsInstalled.args = {
  ...baseArgs,
  extensionStatus: {
    installed: true,
    installing: false,
    error: null,
    showSuccess: true,
  },
};

export const ExtensionError = Template.bind({});
ExtensionError.args = {
  ...baseArgs,
  extensionStatus: {
    installed: false,
    installing: false,
    error: 'Failed to install connectedk8s extension',
    showSuccess: false,
  },
};
