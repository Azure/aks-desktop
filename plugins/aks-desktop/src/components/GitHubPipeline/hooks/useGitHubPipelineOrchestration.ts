// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import {
  checkAppInstallation,
  checkRepoReadiness,
  dispatchWorkflow,
} from '../../../utils/github/github-api';
import { isGitHubSessionCurrent } from '../../../utils/github/github-session';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { APP_INSTALL_CHECK_INTERVAL_MS, PIPELINE_WORKFLOW_FILENAME } from '../constants';
import { useGitHubAuthContext } from '../GitHubAuthContext';
import type { PipelineConfig, PipelineDeploymentState } from '../types';
import {
  createPipelineSecrets,
  createSetupPR,
  triggerCopilotAgent,
} from '../utils/pipelineOrchestration';
import {
  clearActivePipeline,
  getActivePipeline,
  RESUMABLE_STATES,
  setActivePipeline,
} from '../utils/pipelineStorage';
import { useAgentPRDiscovery } from './useAgentPRDiscovery';
import type { AgentWorkflowProgress } from './useAgentWorkflowProgress';
import { useAgentWorkflowProgress } from './useAgentWorkflowProgress';
import type { UseDeploymentHealthResult } from './useDeploymentHealth';
import { useDeploymentHealth } from './useDeploymentHealth';
import type { UseGitHubAuthResult } from './useGitHubAuth';
import type { UseGitHubPipelineStateResult } from './useGitHubPipelineState';
import { useGitHubPipelineState } from './useGitHubPipelineState';
import { useGitHubRepoAccess } from './useGitHubRepoAccess';
import {
  ANNOTATION_WORKLOAD_IDENTITY,
  usePipelineAnnotationSync,
} from './usePipelineAnnotationSync';
import type { UsePRPollingResult } from './usePRPolling';
import { usePRPolling } from './usePRPolling';
import type { UseWorkflowPollingResult } from './useWorkflowPolling';
import { useWorkflowPolling } from './useWorkflowPolling';
import type { UseWorkloadIdentitySetupReturn } from './useWorkloadIdentitySetup';
import { useWorkloadIdentitySetup } from './useWorkloadIdentitySetup';

interface UseGitHubPipelineOrchestrationProps {
  clusterName: string;
  namespace: string;
  /** Application name. Defaults to `''` (derived from repo name at runtime). */
  appName?: string;
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
  /** Pre-selected repo for resuming an in-progress pipeline. */
  initialRepo?: GitHubRepo;
  /** Container configuration from the deploy wizard. */
  containerConfig?: ContainerConfig;
  /**
   * Pipeline mode:
   * - 'configure': Pipeline setup ends at PipelineConfigured after generated PR merges (no auto-deploy).
   * - 'deploy': Full flow — generated PR merge triggers PipelineRunning → Deployed.
   * Defaults to 'deploy' for backward compatibility.
   */
  mode?: 'configure' | 'deploy';
  /** Project name — used for identity naming and resource group defaults. */
  projectName?: string;
}

export interface UseGitHubPipelineOrchestrationResult {
  gitHubAuth: UseGitHubAuthResult;
  repoAccess: ReturnType<typeof useGitHubRepoAccess>;
  selectedRepo: GitHubRepo | null;
  setSelectedRepo: React.Dispatch<React.SetStateAction<GitHubRepo | null>>;
  appInstallUrl: string | null;
  isCheckingInstall: boolean;
  pipeline: UseGitHubPipelineStateResult;
  identityId: string;
  localAppName: string;
  setLocalAppName: React.Dispatch<React.SetStateAction<string>>;
  checkRepoAndApp: (options?: { silent?: boolean }) => Promise<void>;
  handleCreateSetupPR: () => Promise<void>;
  handleRedeploy: () => Promise<void>;
  setupPrPolling: UsePRPollingResult;
  generatedPrPolling: UsePRPollingResult;
  agentWorkflowProgress: AgentWorkflowProgress;
  workflowPolling: UseWorkflowPollingResult;
  deploymentHealth: UseDeploymentHealthResult;
  identitySetup: UseWorkloadIdentitySetupReturn;
  projectName?: string;
}

/**
 * Orchestrates the full GitHub pipeline wizard lifecycle.
 *
 * Encapsulates all hooks, effects, state, and callbacks that drive the
 * pipeline wizard. The companion `GitHubPipelineWizard` component is a
 * pure render-only consumer of the values returned here.
 */
export const useGitHubPipelineOrchestration = ({
  clusterName,
  namespace,
  appName = '',
  subscriptionId,
  resourceGroup,
  tenantId,
  initialRepo,
  containerConfig,
  mode = 'deploy',
  projectName,
}: UseGitHubPipelineOrchestrationProps): UseGitHubPipelineOrchestrationResult => {
  const agentTriggerInFlightRef = useRef<symbol | null>(null);
  const checkRepoInFlightRef = useRef<symbol | null>(null);
  const setupPrInFlightRef = useRef<symbol | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      agentTriggerInFlightRef.current =
        checkRepoInFlightRef.current =
        setupPrInFlightRef.current =
          null;
    };
  }, []);

  const deploymentStateRef = useRef<PipelineDeploymentState>('Configured');

  const resolvedInitialRepo =
    initialRepo ?? getActivePipeline(clusterName, namespace)?.repo ?? null;
  const isResumingRef = useRef(!!resolvedInitialRepo);

  const gitHubAuth = useGitHubAuthContext();
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(resolvedInitialRepo);
  const [appInstallUrl, setAppInstallUrl] = useState<string | null>(null);
  const [isCheckingInstall, setIsCheckingInstall] = useState(false);
  const repoKey = selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : null;
  const pipeline = useGitHubPipelineState(repoKey);
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
    agentTriggerInFlightRef.current =
      checkRepoInFlightRef.current =
      setupPrInFlightRef.current =
        null;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new scope clears the previous operation's transient indicator.
  useEffect(() => {
    setIsCheckingInstall(false);
  }, [scope]);

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster: clusterName,
  });

  useLayoutEffect(() => {
    deploymentStateRef.current = pipeline.state.deploymentState;
  }, [pipeline.state.deploymentState]);

  const identitySetup = useWorkloadIdentitySetup();

  const [identityId, setIdentityId] = useState('');
  const [localAppName, setLocalAppName] = useState(appName || '');

  useEffect(() => {
    if (identityId) return;
    const stored =
      namespaceInstance?.jsonData?.metadata?.annotations?.[ANNOTATION_WORKLOAD_IDENTITY];
    if (stored) {
      setIdentityId(stored);
    }
  }, [identityId, namespaceInstance]);

  useEffect(() => {
    if (!localAppName && selectedRepo) {
      setLocalAppName(selectedRepo.repo);
    }
  }, [localAppName, selectedRepo]);

  useEffect(() => {
    if (!ready || !isCurrent()) return;
    if (
      identitySetup.status === 'done' &&
      identitySetup.result &&
      pipeline.state.deploymentState === 'WorkloadIdentitySetup'
    ) {
      setIdentityId(identitySetup.result.clientId);
      pipeline.updateConfig({ identityId: identitySetup.result.clientId });
      pipeline.setIdentityReady();
    }
  }, [
    identitySetup.status,
    identitySetup.result,
    pipeline.state.deploymentState,
    pipeline.updateConfig,
    pipeline.setIdentityReady,
    ready,
    isCurrent,
  ]);

  // Authentication is an overlay over advanced progress, not a replacement state.
  useEffect(() => {
    if (
      gitHubAuth.authState.isRestoring ||
      gitHubAuth.authState.isAuthenticated ||
      pipeline.state.deploymentState !== 'Configured'
    )
      return;
    pipeline.setAuthNeeded();
  }, [
    gitHubAuth.authState.isAuthenticated,
    gitHubAuth.authState.isRestoring,
    pipeline.state.deploymentState,
    pipeline.setAuthNeeded,
  ]);

  useEffect(() => {
    if (!selectedRepo) return;

    if (!pipeline.state.config) {
      pipeline.setConfig({
        tenantId,
        identityId: identityId || '',
        subscriptionId,
        clusterName,
        resourceGroup,
        namespace,
        appName,
        serviceType: containerConfig?.serviceType ?? 'ClusterIP',
        containerConfig,
        repo: selectedRepo,
      });
    } else if (!pipeline.state.config.repo?.owner) {
      // Config was created during auth with placeholder repo — update it now
      pipeline.updateConfig({ repo: selectedRepo });
    }
  }, [
    selectedRepo,
    pipeline.state.config,
    pipeline.setConfig,
    tenantId,
    identityId,
    subscriptionId,
    clusterName,
    resourceGroup,
    namespace,
    appName,
    containerConfig,
  ]);

  const checkRepoAndApp = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isCurrent() || !gitHubAuth.octokit || !selectedRepo) return;
      if (checkRepoInFlightRef.current) return;
      const operation = Symbol('repository-check');
      checkRepoInFlightRef.current = operation;
      const current = () => isCurrent() && checkRepoInFlightRef.current === operation;
      setIsCheckingInstall(true);
      if (!options?.silent) {
        pipeline.setCheckingRepo();
      }
      try {
        const { installed, installUrl } = await checkAppInstallation(
          gitHubAuth.octokit,
          selectedRepo.owner,
          selectedRepo.repo
        );
        if (!current()) return;
        if (!installed) {
          pipeline.setAppInstallNeeded();
          setAppInstallUrl(installUrl);
          return;
        }
        const readiness = await checkRepoReadiness(
          gitHubAuth.octokit,
          selectedRepo.owner,
          selectedRepo.repo,
          selectedRepo.defaultBranch
        );
        // Only shortcut to PipelineConfigured when resuming via initialRepo.
        // When the user manually selected a repo (or used "Start over"),
        // always show the setup review so they can re-run the pipeline.
        if (!current()) return;
        const effective = isResumingRef.current
          ? readiness
          : { ...readiness, hasDeployWorkflow: false };
        pipeline.setRepoReadiness(effective);
      } catch (err) {
        if (current())
          pipeline.setFailed(err instanceof Error ? err.message : 'Failed to check repo');
      } finally {
        if (checkRepoInFlightRef.current === operation) {
          checkRepoInFlightRef.current = null;
          if (isCurrent()) setIsCheckingInstall(false);
        }
      }
    },
    [
      gitHubAuth.octokit,
      selectedRepo,
      pipeline.setCheckingRepo,
      pipeline.setAppInstallNeeded,
      pipeline.setRepoReadiness,
      pipeline.setFailed,
      isCurrent,
    ]
  );

  const setupPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.setupPr.number,
    ready && pipeline.state.deploymentState === 'SetupPRAwaitingMerge',
    sessionVersion
  );

  const agentPrDiscovery = useAgentPRDiscovery(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    ready && pipeline.state.deploymentState === 'AgentRunning',
    pipeline.state.triggerIssue.number,
    sessionVersion
  );

  const agentWorkflowProgress = useAgentWorkflowProgress(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    ready && pipeline.state.deploymentState === 'AgentRunning',
    pipeline.state.triggerIssue.number,
    sessionVersion
  );

  const generatedPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.generatedPr.number,
    ready && pipeline.state.deploymentState === 'GeneratedPRAwaitingMerge',
    sessionVersion
  );

  const workflowPolling = useWorkflowPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    selectedRepo?.defaultBranch ?? null,
    ready && pipeline.state.deploymentState === 'PipelineRunning',
    sessionVersion
  );

  const deploymentHealth = useDeploymentHealth(
    localAppName,
    namespace,
    clusterName,
    pipeline.state.deploymentState === 'PipelineRunning' ||
      pipeline.state.deploymentState === 'Deployed'
  );

  // Agent task creation: secrets + Copilot agent trigger (narrow dependencies)
  useEffect(() => {
    if (!ready || !isCurrent() || pipeline.state.deploymentState !== 'AgentTaskCreating') return;
    if (agentTriggerInFlightRef.current) return;
    const currentConfig = pipeline.state.config;
    const currentOctokit = gitHubAuth.octokit;
    if (!currentConfig || !currentOctokit) return;

    const operation = Symbol('agent-trigger');
    agentTriggerInFlightRef.current = operation;
    const current = () => isCurrent() && agentTriggerInFlightRef.current === operation;
    (async () => {
      try {
        await createPipelineSecrets(currentOctokit, currentConfig);
        if (!current() || deploymentStateRef.current !== 'AgentTaskCreating') return;
        const issue = await triggerCopilotAgent(currentOctokit, currentConfig);
        if (!current() || deploymentStateRef.current !== 'AgentTaskCreating') return;
        pipeline.setAgentTriggered(issue);
      } catch (err) {
        if (!current() || deploymentStateRef.current !== 'AgentTaskCreating') return;
        console.error('Failed to trigger Copilot agent');
        pipeline.setFailed(err instanceof Error ? err.message : 'Failed to trigger Copilot agent');
      } finally {
        if (agentTriggerInFlightRef.current === operation) agentTriggerInFlightRef.current = null;
      }
    })();
  }, [
    pipeline.state.deploymentState,
    pipeline.state.config,
    gitHubAuth.octokit,
    pipeline.setAgentTriggered,
    pipeline.setFailed,
    ready,
    isCurrent,
  ]);

  useEffect(() => {
    if (!ready || !isCurrent()) return;
    switch (pipeline.state.deploymentState) {
      case 'Configured':
      case 'CheckingRepo':
        if (gitHubAuth.authState.isAuthenticated && selectedRepo) {
          checkRepoAndApp();
        }
        break;

      case 'SetupPRAwaitingMerge':
        if (setupPrPolling.isMerged) {
          pipeline.setSetupPRMerged();
        }
        break;

      case 'AgentRunning':
        if (agentPrDiscovery.prUrl && agentPrDiscovery.prNumber) {
          pipeline.setGeneratedPRCreated(agentPrDiscovery.prUrl, agentPrDiscovery.prNumber);
        } else if (agentPrDiscovery.issueClosed) {
          if (agentPrDiscovery.failureReason === 'token-limit') {
            pipeline.setFailed(
              "The Copilot agent's evaluator hit its 64k input token limit before finishing. " +
                'This typically happens on large repos or when the build retried many times. ' +
                'Runs are non-deterministic, so trying again often succeeds. ' +
                'Check the trigger issue for details.'
            );
          } else {
            pipeline.setFailed(
              'Copilot agent completed but no deployment PR was found. Check the GitHub issue for details.'
            );
          }
        } else if (agentPrDiscovery.isTimedOut) {
          pipeline.setFailed('Timed out waiting for Copilot agent to create PR');
        }
        break;

      case 'GeneratedPRAwaitingMerge':
        if (generatedPrPolling.isMerged) {
          if (mode === 'configure') {
            pipeline.setPipelineConfigured();
          } else {
            pipeline.setGeneratedPRMerged();
          }
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
    gitHubAuth.authState.isAuthenticated,
    selectedRepo,
    checkRepoAndApp,
    setupPrPolling.isMerged,
    agentPrDiscovery.prUrl,
    agentPrDiscovery.prNumber,
    agentPrDiscovery.issueClosed,
    agentPrDiscovery.failureReason,
    agentPrDiscovery.isTimedOut,
    generatedPrPolling.isMerged,
    workflowPolling.runConclusion,
    deploymentHealth.serviceEndpoint,
    pipeline.setSetupPRMerged,
    pipeline.setGeneratedPRCreated,
    pipeline.setGeneratedPRMerged,
    pipeline.setPipelineConfigured,
    mode,
    pipeline.setDeployed,
    pipeline.setFailed,
    ready,
    isCurrent,
  ]);

  // Polls silently without transitioning to CheckingRepo, so the install
  // screen stays visible. Only advances state when installation is detected.
  useEffect(() => {
    if (!ready || !isCurrent() || pipeline.state.deploymentState !== 'AppInstallationNeeded')
      return;
    if (!gitHubAuth.octokit || !selectedRepo) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled || !isCurrent()) return;
      const currentOctokit = gitHubAuth.octokit;
      const currentRepo = selectedRepo;
      if (!currentOctokit || !currentRepo) return;
      try {
        setIsCheckingInstall(true);
        const { installed } = await checkAppInstallation(
          currentOctokit,
          currentRepo.owner,
          currentRepo.repo
        );
        if (!cancelled && isCurrent() && installed) {
          checkRepoAndApp({ silent: true });
          return;
        }
      } catch {
        if (!cancelled && isCurrent()) console.warn('App installation check failed');
      } finally {
        if (!cancelled && isCurrent()) setIsCheckingInstall(false);
      }
      if (!cancelled && isCurrent()) {
        timeoutId = setTimeout(poll, APP_INSTALL_CHECK_INTERVAL_MS);
      }
    };

    timeoutId = setTimeout(poll, APP_INSTALL_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    pipeline.state.deploymentState,
    gitHubAuth.octokit,
    selectedRepo,
    checkRepoAndApp,
    ready,
    isCurrent,
  ]);

  // Saves the selected repo when the pipeline is in progress, so DeployButton
  // can show a "Resume" button. Clears when the pipeline completes or is reset.
  useEffect(() => {
    if (!selectedRepo) return;
    const state = pipeline.state.deploymentState;
    if (RESUMABLE_STATES.has(state)) {
      setActivePipeline(clusterName, namespace, selectedRepo);
    } else if (state === 'Deployed' || state === 'PipelineConfigured' || state === 'Configured') {
      clearActivePipeline(clusterName, namespace);
    }
  }, [pipeline.state.deploymentState, selectedRepo, clusterName, namespace]);

  usePipelineAnnotationSync({
    deploymentState: pipeline.state.deploymentState,
    selectedRepo,
    repoKey,
    identityId,
    tenantId,
    configIdentityId: pipeline.state.config?.identityId,
    namespace,
    clusterName,
    namespaceInstance,
  });

  const handleCreateSetupPR = useCallback(async () => {
    if (!isCurrent() || !pipeline.state.config || !gitHubAuth.octokit || setupPrInFlightRef.current)
      return;

    const resolvedIdentityId = identityId || pipeline.state.config.identityId;
    const resolvedAppName = localAppName || pipeline.state.config.appName;

    // Single source of truth — used for both persistence and the API call.
    const mergedConfig: PipelineConfig = {
      ...pipeline.state.config,
      identityId: resolvedIdentityId,
      appName: resolvedAppName,
      containerConfig,
    };

    pipeline.updateConfig({
      identityId: resolvedIdentityId,
      appName: resolvedAppName,
      containerConfig,
    });

    // If both config files already exist on the repo (e.g. setup PR was merged in a previous
    // session), skip PR creation and go straight to the agent trigger.
    const readiness = pipeline.state.repoReadiness;
    if (readiness?.hasSetupWorkflow && readiness?.hasAgentConfig) {
      pipeline.setSetupPRMerged();
      return;
    }

    const operation = Symbol('setup-pr');
    setupPrInFlightRef.current = operation;
    const current = () => isCurrent() && setupPrInFlightRef.current === operation;
    pipeline.setCreatingSetupPR();
    try {
      const pr = await createSetupPR(gitHubAuth.octokit, mergedConfig);
      if (current()) pipeline.setSetupPRCreated(pr);
    } catch (error) {
      if (!current()) return;
      console.error('Failed to create setup PR');
      pipeline.setFailed(error instanceof Error ? error.message : 'Failed to create setup PR');
    } finally {
      if (setupPrInFlightRef.current === operation) setupPrInFlightRef.current = null;
    }
  }, [
    gitHubAuth.octokit,
    pipeline.state.config,
    pipeline.state.repoReadiness,
    pipeline.updateConfig,
    pipeline.setSetupPRMerged,
    pipeline.setCreatingSetupPR,
    pipeline.setSetupPRCreated,
    pipeline.setFailed,
    identityId,
    localAppName,
    containerConfig,
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
    } catch (error) {
      if (isCurrent())
        pipeline.setFailed(error instanceof Error ? error.message : 'Failed to redeploy');
    }
  }, [gitHubAuth.octokit, selectedRepo, pipeline.setFailed, isCurrent]);

  return {
    gitHubAuth,
    repoAccess,
    selectedRepo,
    setSelectedRepo,
    appInstallUrl,
    isCheckingInstall,
    pipeline,
    identityId,
    localAppName,
    setLocalAppName,
    checkRepoAndApp,
    handleCreateSetupPR,
    handleRedeploy,
    setupPrPolling,
    generatedPrPolling,
    agentWorkflowProgress,
    workflowPolling,
    deploymentHealth,
    identitySetup,
    projectName,
  };
};
