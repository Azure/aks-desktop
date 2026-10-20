// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const deployments = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));
vi.mock('../../../hooks/useAzureContext', () => ({
  useAzureContext: () => ({
    azureContext: { subscriptionId: 'sub-1', resourceGroup: 'rg-1' },
  }),
}));
vi.mock('../../../hooks/useNamespaceCapabilities', () => ({
  useNamespaceCapabilities: () => ({ isManagedNamespace: false, azureRbacEnabled: false }),
}));
vi.mock('../hooks/usePipelineStatus', () => ({
  usePipelineStatus: () => ({
    isConfigured: true,
    repos: [{ owner: 'contoso', repo: 'store' }],
  }),
}));
vi.mock('../hooks/useClusterDeployStatus', () => ({
  useClusterDeployStatus: () => ({
    deployments: deployments.list,
    services: [],
    loading: false,
    error: null,
  }),
}));
vi.mock('../../DeployWizard/DeployWizard', () => ({
  default: () => <div>Deploy wizard</div>,
}));
vi.mock('./PipelineDeployDialog', () => ({
  // Mirrors the real component's dependency on the GitHub auth context, which
  // throws when no provider is mounted above it.
  PipelineDeployDialog: () => {
    throw new Error('useGitHubAuthContext must be used within GitHubAuthProvider');
  },
}));

import { ClusterDeployCard } from './ClusterDeployCard';

const pipelineDeployment = {
  name: 'store-front',
  replicas: 1,
  readyReplicas: 1,
  availableReplicas: 1,
  provenance: 'pipeline',
  pipelineRepo: 'contoso/store',
  pipelineRunUrl: 'https://github.com/contoso/store/actions/runs/1',
  pipelineWorkflow: 'deploy.yaml',
  rawDeployment: {},
};

describe('ClusterDeployCard pipeline gating', () => {
  afterEach(() => {
    cleanup();
    deployments.list = [];
  });

  it('hides pipeline actions when pipelines are disabled', () => {
    deployments.list = [pipelineDeployment];

    render(<ClusterDeployCard cluster="c1" namespace="ns1" pipelineEnabled={false} />);

    // No GitHubAuthProvider is mounted in this state, so any affordance that
    // opens PipelineDeployDialog would crash the tab (see issue #264 follow-up).
    expect(screen.queryByTestId('icon-mdi:replay')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy via Pipeline')).not.toBeInTheDocument();
    expect(screen.getByText('Manual Deploy')).toBeInTheDocument();
  });

  it('shows pipeline actions when pipelines are enabled', () => {
    deployments.list = [pipelineDeployment];

    render(<ClusterDeployCard cluster="c1" namespace="ns1" pipelineEnabled />);

    expect(screen.getByTestId('icon-mdi:replay')).toBeInTheDocument();
    expect(screen.getByText('Deploy via Pipeline')).toBeInTheDocument();
  });

  it('keeps the edit action for manually deployed apps when pipelines are disabled', () => {
    deployments.list = [
      { ...pipelineDeployment, provenance: 'manual', pipelineRepo: null, pipelineRunUrl: null },
    ];

    render(<ClusterDeployCard cluster="c1" namespace="ns1" pipelineEnabled={false} />);

    expect(screen.getByTestId('icon-mdi:pencil')).toBeInTheDocument();
  });
});
