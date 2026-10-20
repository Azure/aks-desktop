// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { dispatchWorkflow } from '../../../utils/github/github-api';
import { isGitHubSessionCurrent } from '../../../utils/github/github-session';
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
import { useGitHubRepoAccess } from './useGitHubRepoAccess';
import type { UsePRPollingResult } from './usePRPolling';
import { usePRPolling } from './usePRPolling';
import type { UseWorkflowPollingResult } from './useWorkflowPolling';
import { useWorkflowPolling } from './useWorkflowPolling';

/** Reads the current deployment state from a ref without triggering TS narrowing. */
function currentState(ref: RefObject<FastPathDeploymentState>): FastPathDeploymentState {
  return ref.current;
}

/** Extracts a human-readable message from an unknown caught value. */
function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export interface UseFastPathOrchestrationProps {
  /** AKS cluster name the pipeline will deploy into. */
  clusterName: string;
  /** Kubernetes namespace the generated manifests target. */
  namespace: string;
  /** App name used for the Deployment/Service resource names and branch slug. */
  appName: string;
  /** Azure subscription that owns the cluster + ACR. */
  subscriptionId: string;
  /** Azure resource group containing the AKS cluster. */
  resourceGroup: string;
  /** Azure AD tenant — plumbed through for federated-credential issuer URL construction. */
  tenantId: string;
  /** GitHub repo the deploy PR is created against, or `null` until the user selects one. */
  selectedRepo: GitHubRepo | null;
  /** Container runtime config (resources, probes, security context) the manifests inherit. */
  containerConfig: ContainerConfig;
  /** Azure managed identity client ID used by the workflow for workload-identity auth. */
  identityId: string;
}

export interface HandleDeployOptions {
  selection: DockerfileSelection;
  /** When true, includes agent config files and triggers async review after deploy. */
  withAsyncAgent?: boolean;
}

export interface UseFastPathOrchestrationResult {
  repoAccess: ReturnType<typeof useGitHubRepoAccess>;
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
  const deployInFlightRef = useRef<symbol | null>(null);
  const dispatchInFlightRef = useRef<symbol | null>(null);
  const asyncAgentInFlightRef = useRef<symbol | null>(null);
  const dispatchStartedRef = useRef<string | null>(null);
  const [dispatchAttempt, setDispatchAttempt] = useState(0);
  const reviewStartedRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      deployInFlightRef.current =
        dispatchInFlightRef.current =
        asyncAgentInFlightRef.current =
          null;
    };
  }, []);
  const deploymentStateRef = useRef<FastPathDeploymentState>('Configured');

  const gitHubAuth = useGitHubAuthContext();
  const repoKey = selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : null;
  const pipeline = useFastPathPipelineState(repoKey);
  const sessionVersion = gitHubAuth.authState.sessionVersion;
  const repoAccess = useGitHubRepoAccess(gitHubAuth.octokit, selectedRepo, sessionVersion);
  const ready = gitHubAuth.authState.isAuthenticated && repoAccess.status === 'granted';
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const key = JSON.stringify([
    sessionVersion,
    repoKey,
    selectedRepo?.defaultBranch,
    clusterName,
    namespace,
  ]);
  const scopeRef = useRef({ key });
  if (scopeRef.current.key !== key) {
    scopeRef.current = { key };
    deployInFlightRef.current = dispatchInFlightRef.current = asyncAgentInFlightRef.current = null;
  }
  const scope = scopeRef.current;
  const isCurrent = useCallback(
    () =>
      mountedRef.current &&
      scopeRef.current === scope &&
      readyRef.current &&
      isGitHubSessionCurrent(sessionVersion),
    [scope, sessionVersion]
  );

  useLayoutEffect(() => {
    deploymentStateRef.current = pipeline.state.deploymentState;
  }, [pipeline.state.deploymentState]);

  const fastPathPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.fastPathPr.number,
    ready && pipeline.state.deploymentState === 'FastPathPRAwaitingMerge',
    sessionVersion
  );

  const workflowPolling = useWorkflowPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    selectedRepo?.defaultBranch ?? null,
    ready && pipeline.state.deploymentState === 'PipelineRunning',
    sessionVersion,
    JSON.stringify([pipeline.state.fastPathPr.number, dispatchAttempt])
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
      if (!isCurrent() || !gitHubAuth.octokit || !selectedRepo) return;
      if (deployInFlightRef.current) return;
      const operation = Symbol('deploy');
      deployInFlightRef.current = operation;
      const current = () => isCurrent() && deployInFlightRef.current === operation;

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

      pipeline.setConfig(config, withAsyncAgent);
      pipeline.setDockerfileDetected([selection.path]);
      pipeline.setGenerating();
      // Sync ref eagerly — useLayoutEffect won't run until after this callback yields
      deploymentStateRef.current = 'FastPathGenerating';

      try {
        // Create secrets first (needed for the workflow to authenticate)
        await createPipelineSecrets(gitHubAuth.octokit, config);
        if (!current() || currentState(deploymentStateRef) !== 'FastPathGenerating') return;

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
        if (!current() || currentState(deploymentStateRef) !== 'FastPathPRCreating') return;

        pipeline.setPRCreated(pr);
      } catch (err) {
        if (!current() || currentState(deploymentStateRef) === 'Failed') return;
        pipeline.setFailed(errorMessage(err, 'Failed to create fast-path PR'));
      } finally {
        if (deployInFlightRef.current === operation) deployInFlightRef.current = null;
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
      isCurrent,
    ]
  );

  useEffect(() => {
    if (!ready || !isCurrent()) return;
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
    ready,
    isCurrent,
  ]);

  useEffect(() => {
    if (!ready || !isCurrent() || pipeline.state.deploymentState !== 'PipelineRunning') return;
    const dispatchKey = JSON.stringify([repoKey, pipeline.state.fastPathPr.number]);
    if (dispatchInFlightRef.current || dispatchStartedRef.current === dispatchKey) return;
    if (!gitHubAuth.octokit || !selectedRepo) return;

    const operation = Symbol('dispatch');
    dispatchInFlightRef.current = operation;
    // Reconnection is not a request to deploy the same merged PR a second time.
    dispatchStartedRef.current = dispatchKey;
    const current = () => isCurrent() && dispatchInFlightRef.current === operation;
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
        if (!current() || currentState(deploymentStateRef) !== 'PipelineRunning') return;
        pipeline.setFailed(errorMessage(err, 'Failed to dispatch workflow'));
      } finally {
        if (dispatchInFlightRef.current === operation) dispatchInFlightRef.current = null;
      }
    })();
  }, [
    pipeline.state.deploymentState,
    pipeline.state.fastPathPr.number,
    gitHubAuth.octokit,
    selectedRepo,
    pipeline.setFailed,
    repoKey,
    ready,
    isCurrent,
  ]);

  // Fire-and-forget: trigger async agent review after successful deploy
  useEffect(() => {
    if (!ready || !isCurrent() || pipeline.state.deploymentState !== 'Deployed') return;
    if (!pipeline.state.withAsyncAgent) return;
    const reviewKey = JSON.stringify([repoKey, pipeline.state.fastPathPr.number]);
    if (asyncAgentInFlightRef.current || reviewStartedRef.current === reviewKey) return;
    if (!gitHubAuth.octokit || !selectedRepo || !pipeline.state.config) return;

    const operation = Symbol('agent-review');
    asyncAgentInFlightRef.current = operation;
    reviewStartedRef.current = reviewKey;
    const current = () => isCurrent() && asyncAgentInFlightRef.current === operation;
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
        if (current()) pipeline.setAsyncAgentTriggered(issueUrl);
      } catch {
        // Fire-and-forget: don't fail the deploy because the async agent failed
        if (current()) console.warn('Failed to trigger async agent review');
      } finally {
        if (asyncAgentInFlightRef.current === operation) asyncAgentInFlightRef.current = null;
      }
    })();
  }, [
    pipeline.state.deploymentState,
    pipeline.state.withAsyncAgent,
    pipeline.state.config,
    pipeline.state.dockerfilePaths,
    gitHubAuth.octokit,
    selectedRepo,
    pipeline.setAsyncAgentTriggered,
    pipeline.state.fastPathPr.number,
    repoKey,
    ready,
    isCurrent,
  ]);

  const handleRedeploy = useCallback(async () => {
    if (!isCurrent() || !gitHubAuth.octokit || !selectedRepo) return;
    try {
      await dispatchWorkflow(
        gitHubAuth.octokit,
        selectedRepo.owner,
        selectedRepo.repo,
        PIPELINE_WORKFLOW_FILENAME,
        selectedRepo.defaultBranch
      );
    } catch (err) {
      if (isCurrent()) pipeline.setFailed(errorMessage(err, 'Failed to redeploy'));
    }
  }, [gitHubAuth.octokit, selectedRepo, pipeline.setFailed, isCurrent]);

  const retry = useCallback(() => {
    if (!isCurrent()) return;
    if (
      pipeline.state.deploymentState === 'Failed' &&
      pipeline.state.lastSuccessfulState === 'PipelineRunning'
    ) {
      dispatchStartedRef.current = null;
      setDispatchAttempt(value => value + 1);
    }
    pipeline.retry();
  }, [
    isCurrent,
    pipeline.state.deploymentState,
    pipeline.state.lastSuccessfulState,
    pipeline.retry,
  ]);

  return {
    repoAccess,
    pipeline: { ...pipeline, retry },
    handleDeploy,
    handleRedeploy,
    fastPathPrPolling,
    workflowPolling,
    deploymentHealth,
  };
};
