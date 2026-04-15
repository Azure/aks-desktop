// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { UseWorkloadIdentitySetupReturn } from '../hooks/useWorkloadIdentitySetup';
import { WorkloadIdentitySetup } from './WorkloadIdentitySetup';

const meta: Meta<typeof WorkloadIdentitySetup> = {
  title: 'GitHubPipeline/WorkloadIdentitySetup',
  component: WorkloadIdentitySetup,
};
export default meta;

const mockRepo = { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' };

function makeIdentitySetup(
  overrides: Partial<UseWorkloadIdentitySetupReturn> = {}
): UseWorkloadIdentitySetupReturn {
  return {
    status: 'idle',
    error: null,
    result: null,
    warnings: [],
    setupWorkloadIdentity: () => Promise.resolve(),
    ...overrides,
  };
}

const baseProps = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'cluster-rg',
  clusterName: 'my-cluster',
  repo: mockRepo,
  projectName: 'my-project',
  isManagedNamespace: false as const,
};

/** Idle — initial view with the "Continue" button. */
export const Idle: StoryFn = () => (
  <WorkloadIdentitySetup {...baseProps} identitySetup={makeIdentitySetup()} />
);

/** In-flight: creating the managed identity. */
export const CreatingIdentity: StoryFn = () => (
  <WorkloadIdentitySetup
    {...baseProps}
    identitySetup={makeIdentitySetup({ status: 'creating-identity' })}
  />
);

/** In-flight: assigning Azure RBAC roles. */
export const AssigningRoles: StoryFn = () => (
  <WorkloadIdentitySetup
    {...baseProps}
    identitySetup={makeIdentitySetup({ status: 'assigning-roles' })}
  />
);

/** In-flight: creating a Kubernetes RoleBinding (non-Azure-RBAC cluster). */
export const CreatingRoleBinding: StoryFn = () => (
  <WorkloadIdentitySetup
    {...baseProps}
    isManagedNamespace
    namespaceName="my-namespace"
    azureRbacEnabled={false}
    identitySetup={makeIdentitySetup({ status: 'creating-rolebinding' })}
  />
);

/** Error: permission denied while assigning roles. */
export const Error: StoryFn = () => (
  <WorkloadIdentitySetup
    {...baseProps}
    identitySetup={makeIdentitySetup({
      status: 'error',
      error: 'Permission denied assigning role',
    })}
  />
);

/** Done: everything succeeded. */
export const Done: StoryFn = () => (
  <WorkloadIdentitySetup {...baseProps} identitySetup={makeIdentitySetup({ status: 'done' })} />
);

/** Done with non-fatal warnings (e.g. AcrPull assignment failed but flow continued). */
export const DoneWithWarnings: StoryFn = () => (
  <WorkloadIdentitySetup
    {...baseProps}
    identitySetup={makeIdentitySetup({
      status: 'done',
      warnings: [
        'Failed to assign AcrPull to kubelet identity: Forbidden',
        'AKS RBAC Writer assignment skipped — user lacks permission',
      ],
      result: {
        clientId: 'client-id',
        tenantId: 'tenant-id',
        principalId: 'principal-id',
        identityName: 'id-my-project-github',
        isExisting: false,
        warnings: [
          'Failed to assign AcrPull to kubelet identity: Forbidden',
          'AKS RBAC Writer assignment skipped — user lacks permission',
        ],
      },
    })}
  />
);
