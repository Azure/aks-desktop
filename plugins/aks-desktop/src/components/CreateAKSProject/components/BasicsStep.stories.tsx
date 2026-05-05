// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { BasicsStepProps } from '../types';
import { BasicsStep } from './BasicsStep';

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const BASE_FORM_DATA = {
  projectName: 'azure-microservices-demo',
  description: '',
  subscription: '',
  cluster: '',
  resourceGroup: '',
  ingress: 'AllowSameNamespace' as const,
  egress: 'AllowAll' as const,
  cpuRequest: 2000,
  memoryRequest: 4096,
  cpuLimit: 2000,
  memoryLimit: 4096,
  userAssignments: [],
};

const SUBSCRIPTIONS = [
  {
    id: 'sub-123',
    name: 'Production Subscription',
    tenant: 'tenant-abc',
    tenantName: 'Contoso',
    status: 'Enabled',
  },
  {
    id: 'sub-456',
    name: 'Dev / Test Subscription',
    tenant: 'tenant-abc',
    tenantName: 'Contoso',
    status: 'Enabled',
  },
];

const CLUSTERS = [
  {
    name: 'aks-prod-eastus',
    location: 'eastus',
    version: '1.28.5',
    nodeCount: 3,
    status: 'Succeeded',
    resourceGroup: 'rg-prod',
    powerState: 'Running',
  },
  {
    name: 'aks-staging-westus',
    location: 'westus',
    version: '1.27.9',
    nodeCount: 2,
    status: 'Succeeded',
    resourceGroup: 'rg-staging',
    powerState: 'Running',
  },
];

const BASE_PROPS: BasicsStepProps = {
  formData: BASE_FORM_DATA,
  onFormDataChange: () => {},
  validation: { isValid: true, errors: [], warnings: [] },
  loading: false,
  error: null,
  subscriptions: SUBSCRIPTIONS,
  clusters: [],
  loadingClusters: false,
  clusterError: null,
  totalClusterCount: null,
  extensionStatus: { installed: true, installing: false, error: null, showSuccess: false },
  featureStatus: {
    registered: true,
    state: 'Registered',
    registering: false,
    error: null,
    showSuccess: false,
  },
  namespaceStatus: { exists: null, checking: false, error: null },
  clusterCapabilities: null,
  capabilitiesLoading: false,
  onInstallExtension: async () => {},
  onRegisterFeature: async () => {},
  onRetrySubscriptions: async () => {},
  onRetryClusters: async () => {},
  onRefreshCapabilities: () => {},
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export default {
  title: 'CreateAKSProject/BasicsStep',
  component: BasicsStep,
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} as Meta;

const Template: StoryFn<BasicsStepProps> = args => <BasicsStep {...args} />;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/**
 * Initial state: subscriptions loaded, no subscription or cluster selected yet.
 */
export const Default = Template.bind({});
Default.args = BASE_PROPS;

/**
 * Subscriptions are still loading — the Subscription dropdown is disabled with a spinner.
 */
export const SubscriptionsLoading = Template.bind({});
SubscriptionsLoading.args = {
  ...BASE_PROPS,
  subscriptions: [],
  loading: true,
};

/**
 * Subscription selected, clusters are still loading.
 */
export const ClustersLoading = Template.bind({});
ClustersLoading.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  loadingClusters: true,
};

/**
 * Subscription selected and clusters loaded. 5 total in the subscription,
 * only 2 have Entra ID auth — helper text shows the hidden-cluster count.
 */
export const HiddenClusters = Template.bind({});
HiddenClusters.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  clusters: CLUSTERS,
  totalClusterCount: 5,
};

/**
 * Selected cluster is in a non-ready provisioning state.
 * Shows the "Cluster Not Ready" warning banner with a Refresh button.
 */
export const ClusterNotReady = Template.bind({});
ClusterNotReady.args = {
  ...BASE_PROPS,
  formData: {
    ...BASE_FORM_DATA,
    subscription: 'sub-123',
    cluster: 'aks-prod-eastus',
    resourceGroup: 'rg-prod',
  },
  clusters: [{ ...CLUSTERS[0], status: 'Updating' }, CLUSTERS[1]],
  totalClusterCount: 2,
};

/**
 * AKS Preview extension is not installed.
 * Shows the yellow warning banner with the "Install Extension" button.
 */
export const ExtensionNotInstalled = Template.bind({});
ExtensionNotInstalled.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  extensionStatus: { installed: false, installing: false, error: null, showSuccess: false },
};

/**
 * AKS Preview extension is currently being installed.
 * The "Install Extension" button shows a spinner and is disabled.
 */
export const ExtensionInstalling = Template.bind({});
ExtensionInstalling.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  extensionStatus: { installed: false, installing: true, error: null, showSuccess: false },
};

/**
 * AKS Preview extension install succeeded.
 * Shows the green success alert.
 */
export const ExtensionInstallSuccess = Template.bind({});
ExtensionInstallSuccess.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  extensionStatus: { installed: true, installing: false, error: null, showSuccess: true },
};

/**
 * The `ManagedNamespacePreview` feature flag is not yet registered.
 * Shows the red error panel with the "Register Feature" button.
 */
export const FeatureNotRegistered = Template.bind({});
FeatureNotRegistered.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  featureStatus: {
    registered: false,
    state: 'NotRegistered',
    registering: false,
    error: null,
    showSuccess: false,
  },
};

/**
 * Feature registration is in progress.
 * The "Register Feature" button shows a spinner and is disabled.
 */
export const FeatureRegistering = Template.bind({});
FeatureRegistering.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  featureStatus: {
    registered: false,
    state: 'Registering',
    registering: true,
    error: null,
    showSuccess: false,
  },
};

/**
 * Project name collides with an existing namespace.
 * The Project Name field shows an error state and a "name taken" message.
 */
export const NamespaceExists = Template.bind({});
NamespaceExists.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  namespaceStatus: { exists: true, checking: false, error: null },
};

/**
 * Namespace availability check is in flight.
 * The Project Name field shows "Checking..." helper text.
 */
export const NamespaceChecking = Template.bind({});
NamespaceChecking.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  namespaceStatus: { exists: null, checking: true, error: null },
};

/**
 * Subscription list failed to load.
 * Shows an error alert above the Subscription dropdown with a Retry button.
 */
export const SubscriptionError = Template.bind({});
SubscriptionError.args = {
  ...BASE_PROPS,
  subscriptions: [],
  error: 'Failed to load subscriptions: authorization failed',
};

/**
 * Cluster list failed to load.
 * Shows an error alert below the Cluster dropdown with a Retry button.
 */
export const ClusterError = Template.bind({});
ClusterError.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  clusters: [],
  clusterError: 'Failed to load clusters: network timeout',
};

/**
 * Cluster capabilities are loading after a cluster is selected.
 * Shows the "Checking cluster capabilities..." text.
 */
export const CapabilitiesLoading = Template.bind({});
CapabilitiesLoading.args = {
  ...BASE_PROPS,
  formData: {
    ...BASE_FORM_DATA,
    subscription: 'sub-123',
    cluster: 'aks-prod-eastus',
    resourceGroup: 'rg-prod',
  },
  clusters: CLUSTERS,
  capabilitiesLoading: true,
};

/**
 * Cluster has some addons disabled (Prometheus off, KEDA off, VPA on).
 * Shows the {@link ClusterConfigurePanel} below the cluster field.
 */
export const ConfigurableAddons = Template.bind({});
ConfigurableAddons.args = {
  ...BASE_PROPS,
  formData: {
    ...BASE_FORM_DATA,
    subscription: 'sub-123',
    cluster: 'aks-prod-eastus',
    resourceGroup: 'rg-prod',
  },
  clusters: CLUSTERS,
  clusterCapabilities: { prometheusEnabled: false, kedaEnabled: false, vpaEnabled: true },
};

/**
 * Validation field error on the project name field.
 */
export const ProjectNameValidationError = Template.bind({});
ProjectNameValidationError.args = {
  ...BASE_PROPS,
  formData: { ...BASE_FORM_DATA, subscription: 'sub-123' },
  validation: {
    isValid: false,
    errors: [],
    warnings: [],
    fieldErrors: { projectName: ['Name must be 63 characters or fewer'] },
  },
};
