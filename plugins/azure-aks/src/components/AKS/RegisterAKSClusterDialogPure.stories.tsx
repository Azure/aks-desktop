// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import RegisterAKSClusterDialogPure, {
  RegisterAKSClusterDialogPureProps,
} from './RegisterAKSClusterDialogPure';

const noOp = () => {};

const SAMPLE_SUBSCRIPTIONS = [
  { id: 'sub-1', name: 'Production Subscription', state: 'Enabled', tenantId: 'tenant-1' },
  { id: 'sub-2', name: 'Development Subscription', state: 'Enabled', tenantId: 'tenant-1' },
  { id: 'sub-3', name: 'Legacy Subscription', state: 'Disabled', tenantId: 'tenant-2' },
];

const SAMPLE_TENANTS = [
  { id: 'tenant-1', name: 'Tenant 1' },
  { id: 'tenant-2', name: 'Tenant 2' },
];

const SAMPLE_CLUSTERS = [
  {
    name: 'prod-aks-cluster',
    resourceGroup: 'prod-rg',
    location: 'eastus',
    kubernetesVersion: '1.28.5',
    provisioningState: 'Succeeded',
  },
  {
    name: 'dev-aks-cluster',
    resourceGroup: 'dev-rg',
    location: 'westus2',
    kubernetesVersion: '1.29.0',
    provisioningState: 'Succeeded',
  },
];

const baseArgs: RegisterAKSClusterDialogPureProps = {
  open: true,
  isChecking: false,
  isLoggedIn: true,
  loading: false,
  loadingSubscriptions: false,
  loadingClusters: false,
  capabilitiesLoading: false,
  error: '',
  success: '',
  subscriptions: SAMPLE_SUBSCRIPTIONS.filter(s => s.tenantId === SAMPLE_TENANTS[0].id),
  selectedSubscription: null,
  subscriptionInputValue: '',
  tenants: SAMPLE_TENANTS,
  selectedTenant: SAMPLE_TENANTS[0],
  tenantInputValue: SAMPLE_TENANTS[0].name,
  clusters: [],
  filteredClusters: [],
  clusterInputValue: '',
  selectedCluster: null,
  capabilities: null,
  onClose: noOp,
  onSubscriptionChange: noOp as any,
  onSubscriptionInputChange: noOp as any,
  onTenantChange: noOp as any,
  onTenantInputChange: noOp as any,
  onClusterChange: noOp as any,
  onClusterInputChange: noOp as any,
  onRegister: noOp,
  onDone: noOp,
  onDismissError: noOp,
  onDismissSuccess: noOp,
  onConfigured: noOp,
};

export default {
  title: 'AKS/RegisterAKSClusterDialogPure',
  component: RegisterAKSClusterDialogPure,
} as Meta;

const Template: StoryFn<RegisterAKSClusterDialogPureProps> = args => (
  <RegisterAKSClusterDialogPure {...args} />
);

/** Default state: logged in with subscriptions loaded, nothing selected. */
export const Default = Template.bind({});
Default.args = { ...baseArgs };

/** Not logged in to Azure — shows a warning alert. */
export const NotLoggedIn = Template.bind({});
NotLoggedIn.args = {
  ...baseArgs,
  isLoggedIn: false,
  subscriptions: [],
};

/** Checking authentication status — spinner shown while verifying Azure login. */
export const CheckingAuth = Template.bind({});
CheckingAuth.args = {
  ...baseArgs,
  isChecking: true,
  isLoggedIn: false,
  subscriptions: [],
};

/** Loading subscriptions — Autocomplete is disabled with a spinner. */
export const LoadingSubscriptions = Template.bind({});
LoadingSubscriptions.args = {
  ...baseArgs,
  loadingSubscriptions: true,
  subscriptions: [],
};

/** Subscription selected, loading clusters. */
export const LoadingClusters = Template.bind({});
LoadingClusters.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  loadingClusters: true,
};

/** Subscription selected, no clusters found. */
export const NoClusters = Template.bind({});
NoClusters.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: [],
};

/** Subscription selected and clusters loaded — cluster picker visible. */
export const WithClusters = Template.bind({});
WithClusters.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
};

/** Cluster selected — shows cluster details and enabled Register button. */
export const ClusterSelected = Template.bind({});
ClusterSelected.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
};

/** Registration in progress — Register button shows spinner and "Registering...". */
export const Registering = Template.bind({});
Registering.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
  loading: true,
};

/** Registration succeeded — success alert and Done button. */
export const Success = Template.bind({});
Success.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
  success: "Cluster 'prod-aks-cluster' successfully merged in kubeconfig",
};

/** Registration failed — error alert displayed. */
export const Error = Template.bind({});
Error.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
  error: 'Failed to register cluster: ECONNREFUSED — Could not reach the Kubernetes API server.',
};

/** Checking cluster capabilities after registration. */
export const CheckingCapabilities = Template.bind({});
CheckingCapabilities.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
  success: "Cluster 'prod-aks-cluster' successfully merged in kubeconfig",
  capabilitiesLoading: true,
};

/** All capabilities enabled — green success alert. */
export const AllCapabilitiesEnabled = Template.bind({});
AllCapabilitiesEnabled.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
  success: "Cluster 'prod-aks-cluster' successfully merged in kubeconfig",
  capabilities: {
    azureRbacEnabled: true,
    prometheusEnabled: true,
    kedaEnabled: true,
    vpaEnabled: true,
    networkPolicy: 'cilium',
  },
};

/** Azure RBAC not enabled — error alert for RBAC. */
export const RbacNotEnabled = Template.bind({});
RbacNotEnabled.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
  success: "Cluster 'prod-aks-cluster' successfully merged in kubeconfig",
  capabilities: {
    azureRbacEnabled: false,
    prometheusEnabled: true,
    kedaEnabled: true,
    vpaEnabled: true,
    networkPolicy: 'cilium',
  },
};

/** Network policy not configured — warning alert. */
export const NoNetworkPolicy = Template.bind({});
NoNetworkPolicy.args = {
  ...baseArgs,
  selectedSubscription: SAMPLE_SUBSCRIPTIONS[0],
  clusters: SAMPLE_CLUSTERS,
  filteredClusters: SAMPLE_CLUSTERS,
  selectedCluster: SAMPLE_CLUSTERS[0],
  clusterInputValue: SAMPLE_CLUSTERS[0].name,
  success: "Cluster 'prod-aks-cluster' successfully merged in kubeconfig",
  capabilities: {
    azureRbacEnabled: true,
    prometheusEnabled: true,
    kedaEnabled: true,
    vpaEnabled: true,
    networkPolicy: 'none',
  },
};

/** Multiple tenants, none selected — Subscription field stays disabled. */
export const TenantNotSelected = Template.bind({});
TenantNotSelected.args = {
  ...baseArgs,
  selectedTenant: null,
  tenantInputValue: '',
  selectedSubscription: null,
  subscriptionInputValue: '',
};
