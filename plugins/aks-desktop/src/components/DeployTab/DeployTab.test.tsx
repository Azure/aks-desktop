// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewFeatures = vi.hoisted(() => ({ githubPipelines: false }));
const pipelineSettings = vi.hoisted(() => ({ githubPipelineEnabled: true }));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => previewFeatures,
}));
vi.mock('./hooks/usePipelineSettings', () => ({
  usePipelineSettings: () => ({ settings: pipelineSettings, updateSettings: vi.fn() }),
}));
vi.mock('../GitHubPipeline/GitHubAuthContext', () => ({
  GitHubAuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="github-auth-provider">{children}</div>
  ),
}));
vi.mock('./components/ClusterDeployCard', () => ({
  ClusterDeployCard: ({
    cluster,
    pipelineEnabled,
  }: {
    cluster: string;
    pipelineEnabled: boolean;
  }) => (
    <div data-testid="cluster-deploy-card" data-cluster={cluster}>
      {pipelineEnabled ? 'pipeline-enabled' : 'pipeline-disabled'}
    </div>
  ),
}));

import DeployTab from './DeployTab';

const project = { id: 'p1', clusters: ['cluster-a'], namespaces: ['ns-a'] } as never;

describe('DeployTab pipeline gating', () => {
  beforeEach(() => {
    previewFeatures.githubPipelines = false;
    pipelineSettings.githubPipelineEnabled = true;
  });

  afterEach(cleanup);

  it('renders workloads when the GitHub Pipelines preview feature is off', () => {
    render(<DeployTab project={project} />);

    expect(screen.getByText('Workloads')).toBeInTheDocument();
    expect(screen.getByTestId('cluster-deploy-card')).toHaveAttribute('data-cluster', 'cluster-a');
  });

  it('disables pipeline actions and skips GitHub auth when the preview feature is off', () => {
    render(<DeployTab project={project} />);

    expect(screen.getByTestId('cluster-deploy-card')).toHaveTextContent('pipeline-disabled');
    expect(screen.queryByTestId('github-auth-provider')).not.toBeInTheDocument();
  });

  it('enables pipeline actions and provides GitHub auth when both flags are on', () => {
    previewFeatures.githubPipelines = true;

    render(<DeployTab project={project} />);

    expect(screen.getByTestId('cluster-deploy-card')).toHaveTextContent('pipeline-enabled');
    expect(screen.getByTestId('github-auth-provider')).toBeInTheDocument();
  });

  it('keeps pipeline actions off when both the preview feature and the setting are off', () => {
    pipelineSettings.githubPipelineEnabled = false;

    render(<DeployTab project={project} />);

    expect(screen.getByTestId('cluster-deploy-card')).toHaveTextContent('pipeline-disabled');
    expect(screen.queryByTestId('github-auth-provider')).not.toBeInTheDocument();
  });

  it('keeps pipeline actions off when the preview feature is on but the setting is off', () => {
    previewFeatures.githubPipelines = true;
    pipelineSettings.githubPipelineEnabled = false;

    render(<DeployTab project={project} />);

    expect(screen.getByTestId('cluster-deploy-card')).toHaveTextContent('pipeline-disabled');
    expect(screen.queryByTestId('github-auth-provider')).not.toBeInTheDocument();
  });
});
