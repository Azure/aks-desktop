// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { STEPS } from '../types';
import CreateAKSProjectPure, { CreateAKSProjectPureProps } from './CreateAKSProjectPure';

const noOp = () => {};
const noOpAsync = async () => {};

const baseArgs: CreateAKSProjectPureProps = {
  activeStep: 0,
  steps: STEPS,
  handleNext: noOp,
  handleBack: noOp,
  handleStepClick: noOp,
  handleSubmit: noOpAsync,
  onBack: noOp,
  isCreating: false,
  creationProgress: '',
  creationError: null,
  creationWarnings: [],
  showSuccessDialog: false,
  applicationName: '',
  setApplicationName: noOp as any,
  cliSuggestions: [],
  validation: { isValid: true },
  azureResourcesLoading: false,
  onNavigateToProject: noOp,
  stepContent: <div>Basics step content</div>,
  projectName: 'azure-microservices-demo',
  onDismissError: noOp,
  onCancelSuccess: noOp,
  stepContentRef: React.createRef<HTMLDivElement>(),
};

export default {
  title: 'CreateAKSProject/CreateAKSProjectPure',
  component: CreateAKSProjectPure,
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} as Meta;

const Template: StoryFn<CreateAKSProjectPureProps> = args => <CreateAKSProjectPure {...args} />;

export const BasicsStepDefault = Template.bind({});
BasicsStepDefault.args = {
  ...baseArgs,
  activeStep: 0,
  isCreating: false,
  creationError: null,
  showSuccessDialog: false,
  stepContent: <div>Basics step content</div>,
};

export const LoadingOverlay = Template.bind({});
LoadingOverlay.args = {
  ...baseArgs,
  isCreating: true,
  creationProgress: 'Creating namespace...',
};

export const ErrorOverlay = Template.bind({});
ErrorOverlay.args = {
  ...baseArgs,
  isCreating: false,
  creationError:
    'Error: Namespace creation failed: ResourceQuotaExceeded — Exceeded quota: compute-resources, requested: limits.cpu=2, used: limits.cpu=14, limited: limits.cpu=14. Failed after 3 retries.',
};

export const LongErrorMessage = Template.bind({});
LongErrorMessage.args = {
  ...baseArgs,
  isCreating: false,
  creationError:
    'Error: Namespace creation failed: ResourceQuotaExceeded — Exceeded quota: compute-resources, requested: limits.cpu=2, used: limits.cpu=14, limited: limits.cpu=14. Failed after 3 retries.\n\nAdditional context: The cluster autoscaler attempted to provision new nodes but all available node pools have reached their maximum size. Node pool "default" is at capacity (10/10 nodes). Node pool "high-memory" is at capacity (5/5 nodes).\n\nRecommended actions:\n  1. Increase the CPU quota for the compute-resources ResourceQuota.\n  2. Scale down existing workloads to free up CPU headroom.\n  3. Request a quota increase from your cluster administrator.\n\nFor more details see: https://docs.example.com/troubleshooting/quota-exceeded Error: Namespace creation failed: ResourceQuotaExceeded — Exceeded quota: compute-resources, requested: limits.cpu=2, used: limits.cpu=14, limited: limits.cpu=14. Failed after 3 retries.\n\nAdditional context: The cluster autoscaler attempted to provision new nodes but all available node pools have reached their maximum size. Node pool "default" is at capacity (10/10 nodes). Node pool "high-memory" is at capacity (5/5 nodes).\n\nRecommended actions:\n  1. Increase the CPU quota for the compute-resources ResourceQuota.\n  2. Scale down existing workloads to free up CPU headroom.\n  3. Request a quota increase from your cluster administrator.\n\nFor more details see: https://docs.example.com/troubleshooting/quota-exceeded',
};

/**
 * Error dialog with a very long, realistic multi-phase failure trace.
 * The error box has `maxHeight: 400px` with `overflowY: auto`, so this
 * story exercises the scrollable state of the dialog.
 */
export const ErrorOverlayScrollable = Template.bind({});
ErrorOverlayScrollable.args = {
  ...baseArgs,
  isCreating: false,
  creationError: [
    'Error: Project creation failed after exhausting all retry attempts (attempt 3/3).',
    '',
    'Phase 1 — Namespace provisioning:',
    '  [OK]   Validating namespace name "azure-microservices-demo"',
    '  [OK]   Checking for existing namespace conflicts',
    '  [FAIL] Creating namespace: POST https://aks-api-server.eastus.cloudapp.azure.com/api/v1/namespaces',
    '         Status: 422 Unprocessable Entity',
    '         Body: {"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure",',
    '               "message":"namespace \\"azure-microservices-demo\\" is forbidden: exceeded quota: ',
    '               compute-resources, requested: limits.cpu=4, used: limits.cpu=12, limited: limits.cpu=14",',
    '               "reason":"Forbidden","details":{"name":"azure-microservices-demo","kind":"namespace"},',
    '               "code":422}',
    '',
    'Phase 2 — RBAC role binding:',
    '  [SKIP] Skipped due to Phase 1 failure.',
    '',
    'Phase 3 — Network policy application:',
    '  [SKIP] Skipped due to Phase 1 failure.',
    '',
    'Phase 4 — Resource quota initialisation:',
    '  [SKIP] Skipped due to Phase 1 failure.',
    '',
    'Retry 1/3 at 2024-06-12T14:03:11Z — same error.',
    'Retry 2/3 at 2024-06-12T14:03:41Z — same error.',
    'Retry 3/3 at 2024-06-12T14:04:11Z — same error.',
    '',
    'Cluster diagnostics at time of failure:',
    '  Node pool "system"        : 3/3 nodes Ready, CPU used 78 %, Memory used 61 %',
    '  Node pool "user-default"  : 5/5 nodes Ready, CPU used 91 %, Memory used 74 %',
    '  Node pool "high-memory"   : 2/2 nodes Ready, CPU used 43 %, Memory used 88 %',
    '',
    'Active ResourceQuotas in namespace "default":',
    '  compute-resources  limits.cpu=14/14  limits.memory=56Gi/64Gi  pods=47/50',
    '  storage-resources  requests.storage=480Gi/500Gi',
    '',
    'Recommended remediation steps:',
    '  1. Free up CPU by scaling down or deleting unused Deployments in the "default" namespace.',
    '  2. Ask your cluster administrator to raise the limits.cpu quota for "default".',
    '  3. Consider using a dedicated namespace with its own ResourceQuota for this project.',
    '  4. If autoscaler is enabled, verify node pool max-node-count is not already reached.',
    '',
    'Support reference: AKS-ERR-QUOTA-CPU-4421',
    'Documentation   : https://learn.microsoft.com/azure/aks/operator-best-practices-scheduler',
  ].join('\n'),
};

export const ValidationError = Template.bind({});
ValidationError.args = {
  ...baseArgs,
  validation: { isValid: false },
  azureResourcesLoading: false,
  stepContent: <div>Basics step content — required fields not filled</div>,
};

export const SuccessDialog = Template.bind({});
SuccessDialog.args = {
  ...baseArgs,
  showSuccessDialog: true,
  applicationName: '',
  projectName: 'my-project',
};

export const SuccessDialogWithAppName = Template.bind({});
SuccessDialogWithAppName.args = {
  ...baseArgs,
  showSuccessDialog: true,
  applicationName: 'frontend-service',
  projectName: 'azure-microservices-demo',
};

/** "Next" button while Azure resources are loading (`azureResourcesLoading: true`). */
export const NextButtonLoading = Template.bind({});
NextButtonLoading.args = {
  ...baseArgs,
  azureResourcesLoading: true,
  validation: { isValid: false },
  stepContent: <div>Basics step content</div>,
};
