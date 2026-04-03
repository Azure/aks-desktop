// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { dispatchWorkflow } from '../../../utils/github/github-api';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { DEFAULT_DOCKERFILE_PATH, MANIFESTS_DIR, PIPELINE_WORKFLOW_FILENAME } from '../constants';
import { useGitHubAuthContext } from '../GitHubAuthContext';
import type { PipelineConfig } from '../types';
import {
  createFastPathPR,
  type FastPathPRConfig,
  triggerAsyncAgentReview,
} from '../utils/fastPathOrchestration';
import { createPipelineSecrets } from '../utils/pipelineOrchestration';
import type { UseDeploymentHealthResult } from './useDeploymentHealth';
import { useDeploymentHealth } from './useDeploymentHealth';
import type { DockerfileSelection } from './useDockerfileDiscovery';
import type { FastPathDeploymentState } from './useFastPathPipelineState';
import type { UseFastPathPipelineStateResult } from './useFastPathPipelineState';
import { useFastPathPipelineState } from './useFastPathPipelineState';
import type { UsePRPollingResult } from './usePRPolling';
import { usePRPolling } from './usePRPolling';
import type { UseWorkflowPollingResult } from './useWorkflowPolling';
import { useWorkflowPolling } from './useWorkflowPolling';

/** Reads the current deployment state from a ref without triggering TS narrowing. */
function currentState(ref: React.RefObject<FastPathDeploymentState>): FastPathDeploymentState {
  return ref.current;
}

export interface UseFastPathOrchestrationProps {
  clusterName: string;
  namespace: string;
  appName: string;
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
  selectedRepo: GitHubRepo | null;
  containerConfig: ContainerConfig;
  identityId: string;
}

export interface HandleDeployOptions {
  selection: DockerfileSelection;
  /** When true, includes agent config files and triggers async review after deploy. */
  withAsyncAgent?: boolean;
}

export interface UseFastPathOrchestrationResult {
  pipeline: UseFastPathPipelineStateResult;
  /** Kicks off fast-path generation + PR creation + workflow dispatch. */
  handleDeploy: (options: HandleDeployOptions) => Promise<void>;
  /** Re-dispatches the deploy workflow (for redeploy from Deployed state). */
  handleRedeploy: () => Promise<void>;
  fastPathPrPolling: UsePRPollingResult;
  workflowPolling: UseWorkflowPollingResult;
  deploymentHealth: UseDeploymentHealthResult;
}

/**
 * Orchestrates the fast-path pipeline: deterministic generation → single PR →
 * auto-dispatch → monitor deployment. Parallel to useGitHubPipelineOrchestration
 * but with fewer states and no Copilot agent interaction.
 */
export const useFastPathOrchestration = ({
  clusterName,
  namespace,
  appName,
  subscriptionId,
  resourceGroup,
  tenantId,
  selectedRepo,
  containerConfig,
  identityId,
}: UseFastPathOrchestrationProps): UseFastPathOrchestrationResult => {
  const deployInFlightRef = useRef(false);
  const dispatchInFlightRef = useRef(false);
  const asyncAgentInFlightRef = useRef(false);
  const withAsyncAgentRef = useRef(false);
  const deploymentStateRef = useRef<FastPathDeploymentState>('Configured');

  const gitHubAuth = useGitHubAuthContext();
  const repoKey = selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : null;
  const pipeline = useFastPathPipelineState(repoKey);

  useLayoutEffect(() => {
    deploymentStateRef.current = pipeline.state.deploymentState;
  }, [pipeline.state.deploymentState]);

  const fastPathPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.fastPathPr.number,
    pipeline.state.deploymentState === 'FastPathPRAwaitingMerge'
  );

  const workflowPolling = useWorkflowPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    selectedRepo?.defaultBranch ?? null,
    pipeline.state.deploymentState === 'PipelineRunning'
  );

  const deploymentHealth = useDeploymentHealth(
    appName,
    namespace,
    clusterName,
    pipeline.state.deploymentState === 'PipelineRunning' ||
      pipeline.state.deploymentState === 'Deployed'
  );

  /**
   * Main deploy action: generates templates, creates PR, sets up secrets,
   * and transitions through the fast-path states.
   */
  const handleDeploy = useCallback(
    async ({ selection, withAsyncAgent }: HandleDeployOptions) => {
      if (!gitHubAuth.octokit || !selectedRepo) return;
      if (deployInFlightRef.current) return;
      deployInFlightRef.current = true;
      withAsyncAgentRef.current = !!withAsyncAgent;

      const config: PipelineConfig = {
        tenantId,
        identityId,
        subscriptionId,
        clusterName,
        resourceGroup,
        namespace,
        appName,
        serviceType: containerConfig.serviceType,
        containerConfig,
        repo: selectedRepo,
      };

      pipeline.setConfig(config);
      pipeline.setDockerfileDetected([selection.path]);
      pipeline.setGenerating();
      // Sync ref eagerly — useLayoutEffect won't run until after this callback yields
      deploymentStateRef.current = 'FastPathGenerating';

      try {
        // Create secrets first (needed for the workflow to authenticate)
        await createPipelineSecrets(gitHubAuth.octokit, config);
        if (currentState(deploymentStateRef) !== 'FastPathGenerating') return;

        const fastPathConfig: FastPathPRConfig = {
          pipelineConfig: config,
          dockerfilePath: selection.path,
          buildContextPath: selection.buildContext,
          containerConfig,
          withAsyncAgent,
        };

        pipeline.setPRCreating();
        deploymentStateRef.current = 'FastPathPRCreating';
        const pr = await createFastPathPR(gitHubAuth.octokit, fastPathConfig);
        if (currentState(deploymentStateRef) !== 'FastPathPRCreating') return;

        pipeline.setPRCreated(pr);
      } catch (err) {
        if (currentState(deploymentStateRef) === 'Failed') return;
        pipeline.setFailed(err instanceof Error ? err.message : 'Failed to create fast-path PR');
      } finally {
        deployInFlightRef.current = false;
      }
    },
    [
      gitHubAuth.octokit,
      selectedRepo,
      tenantId,
      identityId,
      subscriptionId,
      clusterName,
      resourceGroup,
      namespace,
      appName,
      containerConfig,
      pipeline.setConfig,
      pipeline.setDockerfileDetected,
      pipeline.setGenerating,
      pipeline.setPRCreating,
      pipeline.setPRCreated,
      pipeline.setFailed,
    ]
  );

  useEffect(() => {
    switch (pipeline.state.deploymentState) {
      case 'FastPathPRAwaitingMerge':
        if (fastPathPrPolling.isMerged) {
          pipeline.setPRMerged();
        }
        break;

      case 'PipelineRunning':
        if (workflowPolling.runConclusion === 'success') {
          pipeline.setDeployed(deploymentHealth.serviceEndpoint ?? undefined);
        } else if (workflowPolling.runConclusion === 'failure') {
          pipeline.setFailed('GitHub Actions workflow failed');
        }
        break;
    }
  }, [
    pipeline.state.deploymentState,
    fastPathPrPolling.isMerged,
    workflowPolling.runConclusion,
    deploymentHealth.serviceEndpoint,
    pipeline.setPRMerged,
    pipeline.setDeployed,
    pipeline.setFailed,
  ]);

  useEffect(() => {
    if (pipeline.state.deploymentState !== 'PipelineRunning') return;
    if (dispatchInFlightRef.current) return;
    if (!gitHubAuth.octokit || !selectedRepo) return;

    dispatchInFlightRef.current = true;
    (async () => {
      try {
        await dispatchWorkflow(
          gitHubAuth.octokit!,
          selectedRepo.owner,
          selectedRepo.repo,
          PIPELINE_WORKFLOW_FILENAME,
          selectedRepo.defaultBranch
        );
      } catch (err) {
        if (currentState(deploymentStateRef) !== 'PipelineRunning') return;
        pipeline.setFailed(err instanceof Error ? err.message : 'Failed to dispatch workflow');
      } finally {
        dispatchInFlightRef.current = false;
      }
    })();
  }, [pipeline.state.deploymentState, gitHubAuth.octokit, selectedRepo, pipeline.setFailed]);

  // Fire-and-forget: trigger async agent review after successful deploy
  useEffect(() => {
    if (pipeline.state.deploymentState !== 'Deployed') return;
    if (!withAsyncAgentRef.current) return;
    if (asyncAgentInFlightRef.current) return;
    if (!gitHubAuth.octokit || !selectedRepo || !pipeline.state.config) return;

    asyncAgentInFlightRef.current = true;
    const config = pipeline.state.config;
    const dockerfilePath = pipeline.state.dockerfilePaths[0] ?? DEFAULT_DOCKERFILE_PATH;

    (async () => {
      try {
        const issueUrl = await triggerAsyncAgentReview(gitHubAuth.octokit!, {
          owner: selectedRepo.owner,
          repo: selectedRepo.repo,
          defaultBranch: selectedRepo.defaultBranch,
          appName: config.appName,
          namespace: config.namespace,
          clusterName: config.clusterName,
          dockerfilePath,
          manifestsPath: `${MANIFESTS_DIR}/`,
        });
        pipeline.setAsyncAgentTriggered(issueUrl);
      } catch (err) {
        // Fire-and-forget: don't fail the deploy because the async agent failed
        console.warn('Failed to trigger async agent review:', err);
      } finally {
        asyncAgentInFlightRef.current = false;
      }
    })();
  }, [
    pipeline.state.deploymentState,
    pipeline.state.config,
    pipeline.state.dockerfilePaths,
    gitHubAuth.octokit,
    selectedRepo,
    pipeline.setAsyncAgentTriggered,
  ]);

  const handleRedeploy = useCallback(async () => {
    if (!gitHubAuth.octokit || !selectedRepo) return;
    try {
      await dispatchWorkflow(
        gitHubAuth.octokit,
        selectedRepo.owner,
        selectedRepo.repo,
        PIPELINE_WORKFLOW_FILENAME,
        selectedRepo.defaultBranch
      );
    } catch (err) {
      pipeline.setFailed(err instanceof Error ? err.message : 'Failed to redeploy');
    }
  }, [gitHubAuth.octokit, selectedRepo, pipeline.setFailed]);

  return {
    pipeline,
    handleDeploy,
    handleRedeploy,
    fastPathPrPolling,
    workflowPolling,
    deploymentHealth,
  };
};
