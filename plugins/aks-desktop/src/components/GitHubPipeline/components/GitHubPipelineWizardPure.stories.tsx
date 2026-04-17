// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { useContainerConfiguration } from '../../DeployWizard/hooks/useContainerConfiguration';
import type { UseDockerfileDiscoveryReturn } from '../hooks/useDockerfileDiscovery';
import type { UseFastPathOrchestrationResult } from '../hooks/useFastPathOrchestration';
import type { FastPathState } from '../hooks/useFastPathPipelineState';
import type { UseGitHubPipelineOrchestrationResult } from '../hooks/useGitHubPipelineOrchestration';
import type { PipelineState } from '../types';
import {
  GitHubPipelineWizardPure,
  type GitHubPipelineWizardPureProps,
} from './GitHubPipelineWizardPure';

const meta: Meta<typeof GitHubPipelineWizardPure> = {
  title: 'GitHubPipeline/GitHubPipelineWizardPure',
  component: GitHubPipelineWizardPure,
};
export default meta;

const noop = () => {};
const asyncNoop = async () => {};

const mockRepo = { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' };

function makePipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    deploymentState: 'Configured',
    config: null,
    repoReadiness: null,
    setupPr: { url: null, number: null, merged: false },
    triggerIssue: { url: null, number: null },
    generatedPr: { url: null, number: null, merged: false },
    serviceEndpoint: null,
    lastSuccessfulState: null,
    error: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeFastPathState(overrides: Partial<FastPathState> = {}): FastPathState {
  return {
    deploymentState: 'Configured',
    config: null,
    dockerfilePaths: [],
    fastPathPr: { url: null, number: null, merged: false },
    asyncAgentIssueUrl: null,
    withAsyncAgent: false,
    serviceEndpoint: null,
    lastSuccessfulState: null,
    error: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeOrchestration(
  state: PipelineState = makePipelineState()
): UseGitHubPipelineOrchestrationResult {
  const emptyPrPolling = {
    prStatus: null,
    isMerged: false,
    isClosed: false,
    isTimedOut: false,
    statusChecks: null,
    error: null,
    stopPolling: noop,
  };
  return {
    gitHubAuth: {
      authState: {
        isAuthenticated: true,
        isRestoring: false,
        isAuthorizingBrowser: false,
        token: 'gho_token',
        refreshToken: null,
        expiresAt: null,
        username: 'testuser',
        error: null,
      },
      octokit: {} as never,
      startOAuth: asyncNoop,
      logout: noop,
      refreshAuthState: asyncNoop,
      reset: asyncNoop,
    } as UseGitHubPipelineOrchestrationResult['gitHubAuth'],
    selectedRepo: mockRepo,
    setSelectedRepo: noop,
    appInstallUrl: null,
    isCheckingInstall: false,
    pipeline: {
      state,
      setConfig: noop,
      updateConfig: noop,
      setAuthNeeded: noop,
      setAuthCompleted: noop,
      setAppInstallNeeded: noop,
      setCheckingRepo: noop,
      setRepoReadiness: noop,
      setAcrCompleted: noop,
      setIdentitySetup: noop,
      setIdentityReady: noop,
      setCreatingSetupPR: noop,
      setSetupPRCreated: noop,
      setSetupPRMerged: noop,
      setAgentTriggered: noop,
      setGeneratedPRCreated: noop,
      setGeneratedPRMerged: noop,
      setPipelineConfigured: noop,
      setDeployed: noop,
      setFailed: noop,
      retry: noop,
    },
    identityId: 'identity-123',
    localAppName: 'my-app',
    setLocalAppName: noop,
    checkRepoAndApp: asyncNoop,
    handleCreateSetupPR: asyncNoop,
    handleRedeploy: asyncNoop,
    setupPrPolling: emptyPrPolling,
    generatedPrPolling: emptyPrPolling,
    agentWorkflowProgress: {
      runFound: false,
      phases: [],
      agentStartedAt: null,
    },
    workflowPolling: {
      runStatus: null,
      runConclusion: null,
      runUrl: null,
      error: null,
      stopPolling: noop,
    },
    deploymentHealth: {
      deploymentReady: false,
      podStatuses: [],
      serviceEndpoint: null,
      error: null,
    },
    identitySetup: {
      status: 'idle',
      error: null,
      result: null,
      warnings: [],
      setupWorkloadIdentity: asyncNoop,
    },
    projectName: 'my-project',
  };
}

function makeFastPath(state: FastPathState = makeFastPathState()): UseFastPathOrchestrationResult {
  return {
    pipeline: {
      state,
      setConfig: noop,
      updateConfig: noop,
      setDockerfileDetected: noop,
      setGenerating: noop,
      setPRCreating: noop,
      setPRCreated: noop,
      setPRMerged: noop,
      setDeployed: noop,
      setAsyncAgentTriggered: noop,
      setFailed: noop,
      retry: noop,
      loadState: noop,
    },
    handleDeploy: asyncNoop,
    handleRedeploy: asyncNoop,
    fastPathPrPolling: {
      prStatus: null,
      isMerged: false,
      isClosed: false,
      isTimedOut: false,
      statusChecks: null,
      error: null,
      stopPolling: noop,
    },
    workflowPolling: {
      runStatus: null,
      runConclusion: null,
      runUrl: null,
      error: null,
      stopPolling: noop,
    },
    deploymentHealth: {
      deploymentReady: false,
      podStatuses: [],
      serviceEndpoint: null,
      error: null,
    },
  };
}

function makeDockerfileDiscovery(
  selection: UseDockerfileDiscoveryReturn['selection'] = null
): UseDockerfileDiscoveryReturn {
  return {
    selection,
    setSelectedPath: noop,
    setBuildContext: noop,
  };
}

function makeContainerConfig(): ReturnType<typeof useContainerConfiguration> {
  return {
    config: {
      containerStep: 0,
      appName: 'my-app',
      containerImage: 'nginx:1.25',
      replicas: 3,
      targetPort: 8080,
      servicePort: 80,
      useCustomServicePort: false,
      serviceType: 'LoadBalancer',
      enableResources: true,
      cpuRequest: '200m',
      cpuLimit: '1',
      memoryRequest: '256Mi',
      memoryLimit: '1Gi',
      envVars: [],
      enableLivenessProbe: true,
      enableReadinessProbe: true,
      enableStartupProbe: false,
      showProbeConfigs: false,
      livenessPath: '/health',
      readinessPath: '/ready',
      startupPath: '/',
      livenessInitialDelay: 10,
      livenessPeriod: 10,
      livenessTimeout: 1,
      livenessFailure: 3,
      livenessSuccess: 1,
      readinessInitialDelay: 5,
      readinessPeriod: 10,
      readinessTimeout: 1,
      readinessFailure: 3,
      readinessSuccess: 1,
      startupInitialDelay: 0,
      startupPeriod: 10,
      startupTimeout: 1,
      startupFailure: 30,
      startupSuccess: 1,
      enableHpa: false,
      hpaMinReplicas: 2,
      hpaMaxReplicas: 10,
      hpaTargetCpu: 80,
      runAsNonRoot: true,
      readOnlyRootFilesystem: false,
      allowPrivilegeEscalation: false,
      enableWorkloadIdentity: false,
      workloadIdentityClientId: '',
      workloadIdentityServiceAccount: '',
      enablePodAntiAffinity: false,
      enableTopologySpreadConstraints: false,
      containerPreviewYaml: '',
    },
    setConfig: noop,
  };
}

function baseProps(
  overrides: Partial<GitHubPipelineWizardPureProps> = {}
): GitHubPipelineWizardPureProps {
  return {
    clusterName: 'my-cluster',
    namespace: 'my-namespace',
    subscriptionId: 'sub-123',
    resourceGroup: 'rg-123',
    onClose: noop,
    onCancel: noop,
    onViewDeployment: noop,
    orchestration: makeOrchestration(),
    fastPath: makeFastPath(),
    dockerfileDiscovery: makeDockerfileDiscovery(),
    localContainerConfig: makeContainerConfig(),
    isManagedNamespace: false,
    azureRbacEnabled: true,
    pathChoice: null,
    onPathChoiceChange: noop,
    onFastPathDeploy: noop,
    ...overrides,
  };
}

/** Initial screen — user needs to connect their GitHub account. */
export const ConnectGitHub: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      orchestration: {
        ...makeOrchestration(makePipelineState({ deploymentState: 'GitHubAuthorizationNeeded' })),
        selectedRepo: null,
        gitHubAuth: {
          authState: {
            isAuthenticated: false,
            isRestoring: false,
            isAuthorizingBrowser: false,
            token: null,
            refreshToken: null,
            expiresAt: null,
            username: null,
            error: null,
          },
          octokit: null,
          startOAuth: asyncNoop,
          logout: noop,
          refreshAuthState: asyncNoop,
          reset: asyncNoop,
        } as UseGitHubPipelineOrchestrationResult['gitHubAuth'],
      },
    })}
  />
);

/** Mid-flow: checking repo readiness spinner. */
export const CheckingRepo: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      orchestration: makeOrchestration(makePipelineState({ deploymentState: 'CheckingRepo' })),
    })}
  />
);

/** ACR selection step — user picks the container registry. */
export const AcrSelection: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      orchestration: makeOrchestration(makePipelineState({ deploymentState: 'AcrSelection' })),
    })}
  />
);

/** Path selection — Dockerfile found, user picks fast vs agent path. */
export const PathSelection: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      orchestration: makeOrchestration(
        makePipelineState({
          deploymentState: 'ReadyForSetup',
          config: {
            tenantId: 't',
            identityId: 'i',
            subscriptionId: 's',
            clusterName: 'c',
            resourceGroup: 'r',
            namespace: 'my-namespace',
            appName: 'my-app',
            serviceType: 'LoadBalancer',
            repo: mockRepo,
          },
          repoReadiness: {
            hasSetupWorkflow: false,
            hasAgentConfig: false,
            hasDeployWorkflow: false,
            dockerfilePaths: ['Dockerfile'],
          },
        })
      ),
    })}
  />
);

/** Fast-path deploy selected, Dockerfile confirmation view. */
export const FastPathDockerfileConfirm: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      pathChoice: 'fast',
      orchestration: makeOrchestration(
        makePipelineState({
          deploymentState: 'ReadyForSetup',
          config: {
            tenantId: 't',
            identityId: 'i',
            subscriptionId: 's',
            clusterName: 'c',
            resourceGroup: 'r',
            namespace: 'my-namespace',
            appName: 'my-app',
            serviceType: 'LoadBalancer',
            repo: mockRepo,
          },
          repoReadiness: {
            hasSetupWorkflow: false,
            hasAgentConfig: false,
            hasDeployWorkflow: false,
            dockerfilePaths: ['Dockerfile', 'src/web/Dockerfile'],
          },
        })
      ),
      dockerfileDiscovery: makeDockerfileDiscovery({
        path: 'Dockerfile',
        buildContext: '.',
      }),
    })}
  />
);

/** Fast-path in progress: PR created, awaiting merge. */
export const FastPathAwaitingMerge: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      pathChoice: 'fast',
      orchestration: makeOrchestration(
        makePipelineState({
          deploymentState: 'ReadyForSetup',
          config: {
            tenantId: 't',
            identityId: 'i',
            subscriptionId: 's',
            clusterName: 'c',
            resourceGroup: 'r',
            namespace: 'my-namespace',
            appName: 'my-app',
            serviceType: 'LoadBalancer',
            repo: mockRepo,
          },
          repoReadiness: {
            hasSetupWorkflow: false,
            hasAgentConfig: false,
            hasDeployWorkflow: false,
            dockerfilePaths: ['Dockerfile'],
          },
        })
      ),
      fastPath: makeFastPath(
        makeFastPathState({
          deploymentState: 'FastPathPRAwaitingMerge',
          fastPathPr: {
            url: 'https://github.com/testuser/my-repo/pull/42',
            number: 42,
            merged: false,
          },
        })
      ),
    })}
  />
);

/** Fast-path: deployed successfully. */
export const FastPathDeployed: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      pathChoice: 'fast',
      orchestration: makeOrchestration(
        makePipelineState({
          deploymentState: 'ReadyForSetup',
          config: {
            tenantId: 't',
            identityId: 'i',
            subscriptionId: 's',
            clusterName: 'c',
            resourceGroup: 'r',
            namespace: 'my-namespace',
            appName: 'my-app',
            serviceType: 'LoadBalancer',
            repo: mockRepo,
          },
          repoReadiness: {
            hasSetupWorkflow: false,
            hasAgentConfig: false,
            hasDeployWorkflow: false,
            dockerfilePaths: ['Dockerfile'],
          },
        })
      ),
      fastPath: makeFastPath(makeFastPathState({ deploymentState: 'Deployed' })),
    })}
  />
);

/** Fast-path + AI: deployed and async agent review triggered. */
export const FastPathAsyncAgentTriggered: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      pathChoice: 'fast-with-ai',
      orchestration: makeOrchestration(
        makePipelineState({
          deploymentState: 'ReadyForSetup',
          config: {
            tenantId: 't',
            identityId: 'i',
            subscriptionId: 's',
            clusterName: 'c',
            resourceGroup: 'r',
            namespace: 'my-namespace',
            appName: 'my-app',
            serviceType: 'LoadBalancer',
            repo: mockRepo,
          },
          repoReadiness: {
            hasSetupWorkflow: false,
            hasAgentConfig: false,
            hasDeployWorkflow: false,
            dockerfilePaths: ['Dockerfile'],
          },
        })
      ),
      fastPath: makeFastPath(
        makeFastPathState({
          deploymentState: 'AsyncAgentTriggered',
          asyncAgentIssueUrl: 'https://github.com/testuser/my-repo/issues/43',
        })
      ),
    })}
  />
);

/** Fast-path: deploy failed, recovery UI with Retry/Back. */
export const FastPathFailed: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      pathChoice: 'fast',
      orchestration: makeOrchestration(
        makePipelineState({
          deploymentState: 'ReadyForSetup',
          config: {
            tenantId: 't',
            identityId: 'i',
            subscriptionId: 's',
            clusterName: 'c',
            resourceGroup: 'r',
            namespace: 'my-namespace',
            appName: 'my-app',
            serviceType: 'LoadBalancer',
            repo: mockRepo,
          },
          repoReadiness: {
            hasSetupWorkflow: false,
            hasAgentConfig: false,
            hasDeployWorkflow: false,
            dockerfilePaths: ['Dockerfile'],
          },
        })
      ),
      fastPath: makeFastPath(
        makeFastPathState({
          deploymentState: 'Failed',
          error: 'Permission denied while creating branch.',
        })
      ),
    })}
  />
);

/** Agent path: top-level failure with recovery hint + "View on GitHub" link. */
export const AgentPathFailed: StoryFn = () => (
  <GitHubPipelineWizardPure
    {...baseProps({
      orchestration: makeOrchestration(
        makePipelineState({
          deploymentState: 'Failed',
          error: 'Request timed out while polling the agent workflow.',
          setupPr: {
            url: 'https://github.com/testuser/my-repo/pull/12',
            number: 12,
            merged: true,
          },
        })
      ),
    })}
  />
);
