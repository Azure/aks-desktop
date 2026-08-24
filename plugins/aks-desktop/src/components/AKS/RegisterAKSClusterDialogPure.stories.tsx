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

// Realistic multi-tenant data: real GUIDs plus the display names resolved from
// `az account tenant list`, including a guest tenant that only has a domain.
const MULTI_TENANTS = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Contoso Corporation' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Fabrikam Engineering' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'northwind.onmicrosoft.com' },
];

const MULTI_TENANT_SUBSCRIPTIONS = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    name: 'Contoso Production',
    state: 'Enabled',
    tenantId: MULTI_TENANTS[0].id,
    tenantName: MULTI_TENANTS[0].name,
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    name: 'Fabrikam Shared Services',
    state: 'Enabled',
    tenantId: MULTI_TENANTS[1].id,
    tenantName: MULTI_TENANTS[1].name,
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000003',
    name: 'Northwind Guest Access',
    state: 'Enabled',
    tenantId: MULTI_TENANTS[2].id,
    tenantName: MULTI_TENANTS[2].name,
  },
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

/** Registration in progress with tenant, subscription, and cluster selection locked. */
export const SelectionControlsLockedDuringRegistration = Template.bind({});
SelectionControlsLockedDuringRegistration.args = {
  ...ClusterSelected.args,
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

/** Successful registration keeps selection controls locked and exposes the terminal action. */
export const SelectionControlsLockedAfterSuccess = Template.bind({});
SelectionControlsLockedAfterSuccess.args = {
  ...Success.args,
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

/**
 * Multi-tenant account with real tenant display names resolved from
 * `az account tenant list` — each option shows the name above its GUID.
 * Regression cover for issue #853, where every option showed the GUID twice.
 */
export const MultipleTenantsWithNames = Template.bind({});
MultipleTenantsWithNames.args = {
  ...baseArgs,
  tenants: MULTI_TENANTS,
  selectedTenant: null,
  tenantInputValue: '',
  subscriptions: MULTI_TENANT_SUBSCRIPTIONS.filter(s => s.tenantId === MULTI_TENANTS[0].id),
  selectedSubscription: null,
  subscriptionInputValue: '',
};

/**
 * Multi-tenant account where no display name could be resolved (tenant list
 * unavailable, e.g. stale login). Options fall back to the GUID, shown once.
 */
export const MultipleTenantsUnresolvedNames = Template.bind({});
MultipleTenantsUnresolvedNames.args = {
  ...MultipleTenantsWithNames.args,
  tenants: MULTI_TENANTS.map(tenant => ({ ...tenant, name: tenant.id })),
};
