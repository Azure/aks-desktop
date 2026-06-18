// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import BareMetalProxySettingsPagePure, {
  BareMetalProxySettingsPagePureProps,
} from './BareMetalProxySettingsPagePure';

const noOp = () => {};

const sampleSubscriptions = [
  {
    id: 'sub-1',
    name: 'Dev Subscription',
    state: 'Enabled',
    tenantId: 'tenant-1',
    isDefault: true,
  },
  {
    id: 'sub-2',
    name: 'Production Subscription',
    state: 'Enabled',
    tenantId: 'tenant-1',
    isDefault: false,
  },
];

const sampleClusters = [
  {
    name: 'arc-cluster-1',
    resourceGroup: 'rg-baremetal',
    location: 'eastus',
    kubernetesVersion: '1.28.3',
    provisioningState: 'Succeeded',
    powerState: 'Running',
    nodeCount: 3,
    fqdn: '',
    isAzureRBACEnabled: false,
    clusterType: 'aksarc' as const,
  },
  {
    name: 'arc-cluster-2',
    resourceGroup: 'rg-edge',
    location: 'westus',
    kubernetesVersion: '1.27.9',
    provisioningState: 'Succeeded',
    powerState: 'Running',
    nodeCount: 1,
    fqdn: '',
    isAzureRBACEnabled: false,
    clusterType: 'aksarc' as const,
  },
];

const baseArgs: BareMetalProxySettingsPagePureProps = {
  loadingSubscriptions: false,
  loadingClusters: false,
  error: '',
  proxyUiError: '',
  proxyDropped: false,
  subscriptions: sampleSubscriptions,
  selectedSubscription: sampleSubscriptions[0],
  clusters: sampleClusters,
  selectedCluster: null,
  proxyStatus: null,
  proxyActionLoading: false,
  onSubscriptionChange: noOp,
  onClusterChange: noOp,
  onProxyStart: noOp,
  onProxyStop: noOp,
  onProxyRestart: noOp,
  onProxyRefresh: noOp,
  onDismissProxyDropped: noOp,
  onOpenRegisterControls: noOp,
  onBack: noOp,
};

export default {
  title: 'BareMetal/ProxySettingsPage',
  component: BareMetalProxySettingsPagePure,
} as Meta;

const Template: StoryFn<BareMetalProxySettingsPagePureProps> = args => (
  <BareMetalProxySettingsPagePure {...args} />
);

export const Default = Template.bind({});
Default.args = { ...baseArgs };

export const LoadingSubscriptions = Template.bind({});
LoadingSubscriptions.args = {
  ...baseArgs,
  loadingSubscriptions: true,
  subscriptions: [],
  selectedSubscription: null,
  clusters: [],
};

export const LoadingClusters = Template.bind({});
LoadingClusters.args = {
  ...baseArgs,
  loadingClusters: true,
  clusters: [],
  selectedCluster: null,
};

export const NoClustersFound = Template.bind({});
NoClustersFound.args = {
  ...baseArgs,
  clusters: [],
  selectedCluster: null,
};

export const ClusterSelected = Template.bind({});
ClusterSelected.args = {
  ...baseArgs,
  selectedCluster: sampleClusters[0],
  proxyStatus: { status: 'stopped', pid: null, lastError: null },
};

export const ProxyRunning = Template.bind({});
ProxyRunning.args = {
  ...baseArgs,
  selectedCluster: sampleClusters[0],
  proxyStatus: { status: 'running', pid: 4242, lastError: null },
};

export const ProxyError = Template.bind({});
ProxyError.args = {
  ...baseArgs,
  selectedCluster: sampleClusters[0],
  proxyStatus: {
    status: 'error',
    pid: null,
    lastError: 'Unable to reach BareMetal proxy endpoint',
  },
};

export const ProxyActionLoading = Template.bind({});
ProxyActionLoading.args = {
  ...baseArgs,
  selectedCluster: sampleClusters[0],
  proxyActionLoading: true,
  proxyStatus: { status: 'stopped', pid: null, lastError: null },
};

export const ProxyDropped = Template.bind({});
ProxyDropped.args = {
  ...baseArgs,
  selectedCluster: sampleClusters[0],
  proxyDropped: true,
  proxyStatus: { status: 'stopped', pid: null, lastError: null },
};

export const WithError = Template.bind({});
WithError.args = {
  ...baseArgs,
  error: 'Failed to load subscriptions: Network timeout',
};

export const WithProxyUiError = Template.bind({});
WithProxyUiError.args = {
  ...baseArgs,
  selectedCluster: sampleClusters[0],
  proxyUiError: 'Failed to start proxy: Permission denied',
  proxyStatus: { status: 'error', pid: null, lastError: null },
};

export const NoSubscription = Template.bind({});
NoSubscription.args = {
  ...baseArgs,
  subscriptions: [],
  selectedSubscription: null,
  clusters: [],
  selectedCluster: null,
};
