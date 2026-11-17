// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createValidConfig } from '../__fixtures__/pipelineConfig';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../constants';
import type { UseGitHubPipelineStateResult } from '../hooks/useGitHubPipelineState';
import { useGitHubPipelineState } from '../hooks/useGitHubPipelineState';
import type { RepoSetupStatus } from '../types';
import { getAcrBuildFiles } from '../utils/acrTasks/acrTaskRunner';
import { AgentSetupReview } from './AgentSetupReview';
import {
  GitHubPipelineWizardPure,
  type GitHubPipelineWizardPureProps,
} from './GitHubPipelineWizardPure';
import type { DeployPathChoice } from './PathSelectionStep';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../DeployWizard/components/ConfigureContainer', () => ({
  default: () => null,
}));
vi.mock('./ConnectSourceStep', () => ({ ConnectSourceStep: () => null }));
vi.mock('./AcrSelector', () => ({ AcrSelector: () => null }));
vi.mock('./DockerfileConfirmation', () => ({ DockerfileConfirmation: () => null }));
vi.mock('./ReviewAndMergeStep', () => ({ ReviewAndMergeStep: () => null }));
vi.mock('./WorkloadIdentitySetup', () => ({ WorkloadIdentitySetup: () => null }));
vi.mock('./WizardShell', () => ({
  AGENT_PATH_STEPS: [],
  FAST_PATH_STEPS: [],
  WizardShell: ({
    children,
    footerActions,
  }: {
    children: React.ReactNode;
    footerActions: React.ReactNode;
  }) => (
    <>
      {children}
      {footerActions}
    </>
  ),
}));

const config = createValidConfig();
const repoKey = `${config.repo.owner}/${config.repo.repo}`;
const handleCreateSetupPR = vi.fn();
const onFastPathDeploy = vi.fn();
let pipeline: UseGitHubPipelineStateResult;

function Review({
  identityReady = true,
  pathChoice = 'agent',
  localAppName = config.appName,
}: {
  identityReady?: boolean;
  pathChoice?: DeployPathChoice;
  localAppName?: string;
}) {
  pipeline = useGitHubPipelineState(repoKey);
  const props = {
    clusterName: config.clusterName,
    namespace: config.namespace,
    subscriptionId: config.subscriptionId,
    resourceGroup: config.resourceGroup,
    onClose: vi.fn(),
    orchestration: {
      pipeline,
      selectedRepo: config.repo,
      identityId: config.identityId,
      identityReady,
      localAppName,
      setLocalAppName: vi.fn(),
      handleCreateSetupPR,
    },
    fastPath: { pipeline: { state: { deploymentState: 'Configured' } } },
    localContainerConfig: { config: {}, setConfig: vi.fn(), furthestStep: 0 },
    dockerfileDiscovery: { selection: { path: 'Dockerfile', buildContext: '.' } },
    pathChoice,
    onFastPathDeploy,
  } as unknown as GitHubPipelineWizardPureProps;
  return <GitHubPipelineWizardPure {...props} />;
}

function renderReview(setupStatus?: RepoSetupStatus, filesExist = true) {
  localStorage.setItem(
    STORAGE_KEY_PREFIX + repoKey,
    JSON.stringify({
      __schemaVersion: SCHEMA_VERSION,
      deploymentState: 'ReadyForSetup',
      config,
      setupStatus,
      repoReadiness: {
        hasSetupWorkflow: filesExist,
        hasAgentConfig: filesExist,
        hasDeployWorkflow: false,
        dockerfilePaths: [],
      },
    })
  );
  return render(<Review />);
}

describe('agent review verified setup actions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('renders an explicit upgrade and merge explanation for obsolete existing setup', () => {
    renderReview('obsolete');
    expect(screen.getByText(/Upgrade setup: a setup PR will be created/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trigger Copilot Agent' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Merge the setup PR before the Copilot agent can run/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade setup' }));
    expect(handleCreateSetupPR).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'unknown', 'verifying'] as const)(
    'does not treat %s persisted status as current even when both filenames exist',
    status => {
      renderReview(status);
      expect(screen.getByRole('button', { name: 'Verifying setup...' })).toBeDisabled();
      expect(
        screen.queryByText(/Provide the configuration below to trigger/)
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Trigger Copilot Agent' })
      ).not.toBeInTheDocument();
    }
  );

  it('uses the verified state for the trigger and invalidates it when config changes', () => {
    renderReview('obsolete');
    act(() => pipeline.setSetupStatus('current'));
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Copilot Agent' }));
    expect(handleCreateSetupPR).toHaveBeenCalledOnce();
    expect(screen.getByText(/Agent setup is verified and current/)).toBeInTheDocument();
    act(() => pipeline.updateConfig({ appName: 'changed-app' }));
    expect(screen.getByRole('button', { name: 'Verifying setup...' })).toBeDisabled();
  });

  it('keeps the setup PR creation action for a repository without setup files', () => {
    renderReview('obsolete', false);
    expect(screen.getByRole('button', { name: 'Create Setup PR' })).toBeEnabled();
    expect(screen.getByText(/Create setup: a setup PR will be created/)).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade setup:/)).not.toBeInTheDocument();
  });

  it('keeps the normal disabled action label when application name is empty and setup status is unknown', () => {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + repoKey,
      JSON.stringify({
        __schemaVersion: SCHEMA_VERSION,
        deploymentState: 'ReadyForSetup',
        config,
        setupStatus: 'unknown',
        repoReadiness: {
          hasSetupWorkflow: false,
          hasAgentConfig: false,
          hasDeployWorkflow: false,
          dockerfilePaths: [],
        },
      })
    );
    render(<Review localAppName="   " />);
    expect(screen.getByRole('button', { name: 'Create Setup PR' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Verifying setup...' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Enter an application name below to verify repository setup.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Verifying agent setup before continuing.')).not.toBeInTheDocument();
  });

  it.each(['fast', 'fast-with-ai'] as const)(
    'disables the %s deploy action until fresh identity proof is available',
    pathChoice => {
      const { rerender } = renderReview('obsolete');
      rerender(<Review pathChoice={pathChoice} identityReady={false} />);
      expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled();
      rerender(<Review pathChoice={pathChoice} identityReady />);
      fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
      expect(onFastPathDeploy).toHaveBeenCalledOnce();
    }
  );

  it.each([
    {},
    { acrLoginServer: 'myregistry-abc123.azurecr.io' },
    { acrResourceId: '/registries/myregistry' },
  ])('lists runtime files exactly when registry-backed setup publishes them: %o', registry => {
    render(
      <AgentSetupReview
        config={{ ...config, ...registry }}
        identityId={config.identityId}
        appName={config.appName}
        onAppNameChange={vi.fn()}
        setupStatus="obsolete"
        hasSetupFiles={false}
      />
    );
    for (const path of Object.keys(getAcrBuildFiles())) {
      if (Object.keys(registry).length) expect(screen.getByText(path)).toBeInTheDocument();
      else expect(screen.queryByText(path)).not.toBeInTheDocument();
    }
  });

  it('shows verification API failures through the existing pipeline error UI', () => {
    renderReview('verifying');
    act(() => {
      pipeline.setSetupStatus('unknown');
      pipeline.setFailed('Setup verification forbidden');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Setup verification forbidden');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Trigger Copilot Agent' })).not.toBeInTheDocument();
  });

  it('shows capability lookup errors with Retry when managed-namespace status is unresolved', () => {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + repoKey,
      JSON.stringify({
        __schemaVersion: SCHEMA_VERSION,
        deploymentState: 'WorkloadIdentitySetup',
        config,
      })
    );
    const onRetryCapabilities = vi.fn();
    function UnresolvedCapabilities() {
      pipeline = useGitHubPipelineState(repoKey);
      const props = {
        clusterName: config.clusterName,
        namespace: config.namespace,
        subscriptionId: config.subscriptionId,
        resourceGroup: config.resourceGroup,
        onClose: vi.fn(),
        orchestration: {
          pipeline,
          selectedRepo: config.repo,
          identityId: config.identityId,
          identityReady: false,
          localAppName: config.appName,
          setLocalAppName: vi.fn(),
          handleCreateSetupPR,
        },
        fastPath: { pipeline: { state: { deploymentState: 'Configured' } } },
        localContainerConfig: { config: {}, setConfig: vi.fn(), furthestStep: 0 },
        dockerfileDiscovery: { selection: { path: 'Dockerfile', buildContext: '.' } },
        isManagedNamespace: undefined,
        capabilitiesError: 'Failed to check managed namespace status',
        onRetryCapabilities,
        pathChoice: 'agent',
        onFastPathDeploy,
      } as unknown as GitHubPipelineWizardPureProps;
      return <GitHubPipelineWizardPure {...props} />;
    }
    render(<UnresolvedCapabilities />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to check managed namespace status');
    expect(screen.queryByText('Resolving namespace capabilities...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryCapabilities).toHaveBeenCalledOnce();
  });

  it('keeps the application-name draft editable, including an empty value and saved defaults', () => {
    const onAppNameChange = vi.fn();
    const { rerender } = render(
      <AgentSetupReview
        config={config}
        identityId={config.identityId}
        appName={config.appName}
        onAppNameChange={onAppNameChange}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Application Name' }), {
      target: { value: '' },
    });
    expect(onAppNameChange).toHaveBeenCalledWith('');
    rerender(
      <AgentSetupReview
        config={config}
        identityId={config.identityId}
        appName=""
        onAppNameChange={onAppNameChange}
      />
    );
    expect(screen.getByRole('textbox', { name: 'Application Name' })).toHaveValue('');
  });
});
