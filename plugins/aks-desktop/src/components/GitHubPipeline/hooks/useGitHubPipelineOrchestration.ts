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
  const agentTriggerInFlightRef = useRef(false);
  const checkRepoInFlightRef = useRef(false);

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
  ]);

  // Latch first successful auth — cross-tree sync can briefly flicker the flag.
  const authSeenRef = useRef(false);
  useEffect(() => {
    if (gitHubAuth.authState.isAuthenticated) {
      authSeenRef.current = true;
    }
  }, [gitHubAuth.authState.isAuthenticated]);

  useEffect(() => {
    if (gitHubAuth.authState.isRestoring) return;
    if (!gitHubAuth.authState.isAuthenticated && !authSeenRef.current) {
      pipeline.setAuthNeeded();
    }
  }, [
    gitHubAuth.authState.isAuthenticated,
    gitHubAuth.authState.isRestoring,
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
      if (!gitHubAuth.octokit || !selectedRepo) return;
      if (checkRepoInFlightRef.current) return;
      checkRepoInFlightRef.current = true;
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
        const effective = isResumingRef.current
          ? readiness
          : { ...readiness, hasDeployWorkflow: false };
        pipeline.setRepoReadiness(effective);
      } catch (err) {
        pipeline.setFailed(err instanceof Error ? err.message : 'Failed to check repo');
      } finally {
        checkRepoInFlightRef.current = false;
        setIsCheckingInstall(false);
      }
    },
    [
      gitHubAuth.octokit,
      selectedRepo,
      pipeline.setCheckingRepo,
      pipeline.setAppInstallNeeded,
      pipeline.setRepoReadiness,
      pipeline.setFailed,
    ]
  );

  const setupPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.setupPr.number,
    pipeline.state.deploymentState === 'SetupPRAwaitingMerge'
  );

  const agentPrDiscovery = useAgentPRDiscovery(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.deploymentState === 'AgentRunning',
    pipeline.state.triggerIssue.number
  );

  const agentWorkflowProgress = useAgentWorkflowProgress(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.deploymentState === 'AgentRunning'
  );

  const generatedPrPolling = usePRPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    pipeline.state.generatedPr.number,
    pipeline.state.deploymentState === 'GeneratedPRAwaitingMerge'
  );

  const workflowPolling = useWorkflowPolling(
    gitHubAuth.octokit,
    selectedRepo?.owner ?? '',
    selectedRepo?.repo ?? '',
    selectedRepo?.defaultBranch ?? null,
    pipeline.state.deploymentState === 'PipelineRunning'
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
    if (pipeline.state.deploymentState !== 'AgentTaskCreating') return;
    if (agentTriggerInFlightRef.current) return;
    const currentConfig = pipeline.state.config;
    const currentOctokit = gitHubAuth.octokit;
    if (!currentConfig || !currentOctokit) return;

    agentTriggerInFlightRef.current = true;
    (async () => {
      try {
        await createPipelineSecrets(currentOctokit, currentConfig);
        if (deploymentStateRef.current !== 'AgentTaskCreating') return;
        const issue = await triggerCopilotAgent(currentOctokit, currentConfig);
        if (deploymentStateRef.current !== 'AgentTaskCreating') return;
        pipeline.setAgentTriggered(issue);
      } catch (err) {
        if (deploymentStateRef.current !== 'AgentTaskCreating') return;
        console.error('Failed to trigger Copilot agent:', err);
        pipeline.setFailed(err instanceof Error ? err.message : 'Failed to trigger Copilot agent');
      } finally {
        agentTriggerInFlightRef.current = false;
      }
    })();
  }, [
    pipeline.state.deploymentState,
    pipeline.state.config,
    gitHubAuth.octokit,
    pipeline.setAgentTriggered,
    pipeline.setFailed,
  ]);

  useEffect(() => {
    switch (pipeline.state.deploymentState) {
      case 'Configured':
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
          pipeline.setFailed(
            'Copilot agent completed but no deployment PR was found. Check the GitHub issue for details.'
          );
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
  ]);

  // Polls silently without transitioning to CheckingRepo, so the install
  // screen stays visible. Only advances state when installation is detected.
  useEffect(() => {
    if (pipeline.state.deploymentState !== 'AppInstallationNeeded') return;
    if (!gitHubAuth.octokit || !selectedRepo) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
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
        if (!cancelled && installed) {
          checkRepoAndApp({ silent: true });
          return;
        }
      } catch (err) {
        console.warn('App installation check failed:', err);
      } finally {
        if (!cancelled) setIsCheckingInstall(false);
      }
      if (!cancelled) {
        timeoutId = setTimeout(poll, APP_INSTALL_CHECK_INTERVAL_MS);
      }
    };

    timeoutId = setTimeout(poll, APP_INSTALL_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [pipeline.state.deploymentState, gitHubAuth.octokit, selectedRepo, checkRepoAndApp]);

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
    if (!pipeline.state.config || !gitHubAuth.octokit) return;

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

    pipeline.setCreatingSetupPR();
    try {
      const pr = await createSetupPR(gitHubAuth.octokit, mergedConfig);
      pipeline.setSetupPRCreated(pr);
    } catch (error) {
      console.error('Failed to create setup PR:', error);
      pipeline.setFailed(error instanceof Error ? error.message : 'Failed to create setup PR');
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
    } catch (error) {
      pipeline.setFailed(error instanceof Error ? error.message : 'Failed to redeploy');
    }
  }, [gitHubAuth.octokit, selectedRepo, pipeline.setFailed]);

  return {
    gitHubAuth,
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
