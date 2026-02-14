// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import {
  checkAppInstallation,
  checkRepoReadiness,
  dispatchWorkflow,
} from '../../../utils/github/github-api';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { createSetupPR, triggerCopilotAgent } from '../utils/pipelineOrchestration';
import { useAgentPRDiscovery } from './useAgentPRDiscovery';
import { useDeploymentHealth } from './useDeploymentHealth';
import { useGitHubAuth } from './useGitHubAuth';
import { useGitHubPipelineState } from './useGitHubPipelineState';
import { usePRPolling } from './usePRPolling';
import { useWorkflowPolling } from './useWorkflowPolling';

interface UseGitHubPipelineOrchestrationProps {
  clusterName: string;
  namespace: string;
  appName: string;
  subscriptionId: string;
  resourceGroup: string;
  tenantId: string;
  /** Pre-selected repo for resuming an in-progress pipeline. */
  initialRepo?: GitHubRepo;
  /** Container configuration from the deploy wizard. */
  containerConfig?: ContainerConfig;
}

const ACTIVE_PIPELINE_KEY_PREFIX = 'aks-desktop:active-pipeline:';

/** States considered "in progress" — used by DeployButton to show resume indicator. */
const IN_PROGRESS_STATES = new Set([
  'CheckingRepo',
  'ReadyForSetup',
  'SetupPRCreating',
  'SetupPRAwaitingMerge',
  'AgentTaskCreating',
  'AgentRunning',
  'GeneratedPRAwaitingMerge',
  'PipelineRunning',
]);

/**
 * Reads the active pipeline reference for a given cluster+namespace.
 * Used by DeployButton to detect in-progress pipelines.
 */
export function getActivePipeline(
  cluster: string,
  ns: string
): { repo: GitHubRepo; state: string } | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`);
    if (!raw) return null;
    const repo = JSON.parse(raw) as GitHubRepo;
    const stateRaw = localStorage.getItem(`aks-desktop:pipeline-state:${repo.owner}/${repo.repo}`);
    if (!stateRaw) return null;
    const pipelineState = JSON.parse(stateRaw);
    const state = pipelineState?.deploymentState;
    if (!state || !IN_PROGRESS_STATES.has(state)) return null;
    return { repo, state };
  } catch {
    return null;
  }
}

/**
 * Return type for the {@link useGitHubPipelineOrchestration} hook.
 * Provides everything the wizard component needs for rendering.
 */
export interface UseGitHubPipelineOrchestrationResult {
  gitHubAuth: ReturnType<typeof useGitHubAuth>;
  selectedRepo: GitHubRepo | null;
  setSelectedRepo: React.Dispatch<React.SetStateAction<GitHubRepo | null>>;
  appInstallUrl: string | null;
  isCheckingInstall: boolean;
  pipeline: ReturnType<typeof useGitHubPipelineState>;
  identityId: string;
  setIdentityId: React.Dispatch<React.SetStateAction<string>>;
  localAppName: string;
  setLocalAppName: React.Dispatch<React.SetStateAction<string>>;
  checkRepoAndApp: () => Promise<void>;
  handleCreateSetupPR: () => Promise<void>;
  handleRedeploy: () => Promise<void>;
  setupPrPolling: ReturnType<typeof usePRPolling>;
  generatedPrPolling: ReturnType<typeof usePRPolling>;
  agentPrDiscoveryPollNow: () => void;
  workflowPolling: ReturnType<typeof useWorkflowPolling>;
  deploymentHealth: ReturnType<typeof useDeploymentHealth>;
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
  appName,
  subscriptionId,
  resourceGroup,
  tenantId,
  initialRepo,
  containerConfig,
}: UseGitHubPipelineOrchestrationProps): UseGitHubPipelineOrchestrationResult => {
  const agentTriggerInFlightRef = useRef(false);
  const checkRepoInFlightRef = useRef(false);

  const gitHubAuth = useGitHubAuth();
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(initialRepo ?? null);
  const [appInstallUrl, setAppInstallUrl] = useState<string | null>(null);
  const [isCheckingInstall, setIsCheckingInstall] = useState(false);
  const repoKey = selectedRepo ? `${selectedRepo.owner}/${selectedRepo.repo}` : null;
  const pipeline = useGitHubPipelineState(repoKey);

  // identityId: sourced from namespace label or user input (see AgentSetupReview)
  const [identityId, setIdentityId] = useState('');
  // appName: from parent prop or user input in AgentSetupReview
  const [localAppName, setLocalAppName] = useState(appName || '');

  // Default appName to repo name when not provided by parent
  useEffect(() => {
    if (!localAppName && selectedRepo) {
      setLocalAppName(selectedRepo.repo);
    }
  }, [localAppName, selectedRepo]);

  // --- Step A: Auth check on mount (wait for token restore before deciding) ---
  useEffect(() => {
    if (gitHubAuth.authState.isRestoring) return;
    if (!gitHubAuth.authState.isAuthenticated) {
      pipeline.setAuthNeeded();
    }
  }, [
    gitHubAuth.authState.isAuthenticated,
    gitHubAuth.authState.isRestoring,
    pipeline.setAuthNeeded,
  ]);

  // --- When repo is selected, assemble or update PipelineConfig ---
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
    } else if (!pipeline.state.config.repo.owner) {
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
  ]);

  // --- Handler: check app installation + repo readiness (reused by Step B effect and retry) ---
  const checkRepoAndApp = useCallback(async () => {
    if (!gitHubAuth.octokit || !selectedRepo) return;
    if (checkRepoInFlightRef.current) return;
    checkRepoInFlightRef.current = true;
    setIsCheckingInstall(true);
    pipeline.setCheckingRepo();
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
      pipeline.setRepoReadiness(readiness);
    } catch (err) {
      pipeline.setFailed(err instanceof Error ? err.message : 'Failed to check repo');
    } finally {
      checkRepoInFlightRef.current = false;
      setIsCheckingInstall(false);
    }
  }, [
    gitHubAuth.octokit,
    selectedRepo,
    pipeline.setCheckingRepo,
    pipeline.setAppInstallNeeded,
    pipeline.setRepoReadiness,
    pipeline.setFailed,
  ]);

  // --- Polling hooks (always declared, enabled/disabled via state) ---
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
    localAppName,
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

  // --- Consolidated state machine orchestration ---
  // A single effect that drives transitions based on the current deployment state
  // and polling results. Each case only acts when its preconditions are met.
  useEffect(() => {
    switch (pipeline.state.deploymentState) {
      // Step B: Check app installation + repo readiness after auth + repo selection
      case 'Configured':
        if (gitHubAuth.authState.isAuthenticated && selectedRepo) {
          checkRepoAndApp();
        }
        break;

      // Step D: After setup PR merges, transition to agent trigger
      case 'SetupPRAwaitingMerge':
        if (setupPrPolling.isMerged) {
          pipeline.setSetupPRMerged();
        }
        break;

      // Step D (cont.): Trigger Copilot agent via issue creation
      case 'AgentTaskCreating':
        if (gitHubAuth.octokit && pipeline.state.config && !agentTriggerInFlightRef.current) {
          agentTriggerInFlightRef.current = true;
          triggerCopilotAgent(gitHubAuth.octokit, pipeline.state.config)
            .then(issue => pipeline.setAgentTriggered(issue))
            .catch(err => {
              console.error('Failed to trigger Copilot agent:', err);
              pipeline.setFailed(
                err instanceof Error ? err.message : 'Failed to trigger Copilot agent'
              );
            })
            .finally(() => {
              agentTriggerInFlightRef.current = false;
            });
        }
        break;

      // Step E: Wait for agent to create a PR
      case 'AgentRunning':
        if (agentPrDiscovery.prUrl && agentPrDiscovery.prNumber) {
          pipeline.setGeneratedPRCreated(agentPrDiscovery.prUrl, agentPrDiscovery.prNumber);
        } else if (agentPrDiscovery.isTimedOut) {
          pipeline.setFailed('Timed out waiting for Copilot agent to create PR');
        }
        break;

      // Step E (cont.): Wait for user to merge the generated PR
      case 'GeneratedPRAwaitingMerge':
        if (generatedPrPolling.isMerged) {
          pipeline.setGeneratedPRMerged();
        }
        break;

      // Step F: Monitor deployment workflow
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
    pipeline.state.config,
    gitHubAuth.authState.isAuthenticated,
    gitHubAuth.octokit,
    selectedRepo,
    checkRepoAndApp,
    setupPrPolling.isMerged,
    agentPrDiscovery.prUrl,
    agentPrDiscovery.prNumber,
    agentPrDiscovery.isTimedOut,
    generatedPrPolling.isMerged,
    workflowPolling.runConclusion,
    deploymentHealth.serviceEndpoint,
    pipeline.setSetupPRMerged,
    pipeline.setAgentTriggered,
    pipeline.setGeneratedPRCreated,
    pipeline.setGeneratedPRMerged,
    pipeline.setDeployed,
    pipeline.setFailed,
  ]);

  // --- Auto-recheck app installation while waiting for user to install ---
  // Polls silently without transitioning to CheckingRepo, so the install
  // screen stays visible. Only advances state when installation is detected.
  useEffect(() => {
    if (pipeline.state.deploymentState !== 'AppInstallationNeeded') return;
    if (!gitHubAuth.octokit || !selectedRepo) return;
    const intervalId = setInterval(async () => {
      if (checkRepoInFlightRef.current) return;
      try {
        setIsCheckingInstall(true);
        const { installed } = await checkAppInstallation(
          gitHubAuth.octokit!,
          selectedRepo!.owner,
          selectedRepo!.repo
        );
        if (installed) {
          checkRepoAndApp();
        }
      } catch {
        // Silently ignore — will retry on next interval
      } finally {
        setIsCheckingInstall(false);
      }
    }, 5_000);
    return () => clearInterval(intervalId);
  }, [pipeline.state.deploymentState, gitHubAuth.octokit, selectedRepo, checkRepoAndApp]);

  // --- Persist / clear active pipeline reference for resume indicator ---
  // Saves the selected repo when the pipeline is in progress, so DeployButton
  // can show a "Resume" button. Clears when the pipeline completes or is reset.
  useEffect(() => {
    if (!selectedRepo) return;
    const key = `${ACTIVE_PIPELINE_KEY_PREFIX}${clusterName}:${namespace}`;
    const state = pipeline.state.deploymentState;
    if (IN_PROGRESS_STATES.has(state)) {
      localStorage.setItem(key, JSON.stringify(selectedRepo));
    } else if (state === 'Deployed' || state === 'Failed' || state === 'Configured') {
      localStorage.removeItem(key);
    }
  }, [pipeline.state.deploymentState, selectedRepo, clusterName, namespace]);

  // --- Handler: create setup PR (or skip to agent trigger if files already exist) ---
  const handleCreateSetupPR = useCallback(async () => {
    // Persist latest identityId and appName to localStorage for crash recovery.
    // Note: React state won't reflect this until next render, so we build a
    // fresh config object below for the API call.
    const resolvedIdentityId = identityId || pipeline.state.config!.identityId;
    const resolvedAppName = localAppName || pipeline.state.config!.appName;
    pipeline.updateConfig({ identityId: resolvedIdentityId, appName: resolvedAppName });

    // If both config files already exist on the repo (e.g. setup PR was merged in a previous
    // session), skip PR creation and go straight to the agent trigger.
    const readiness = pipeline.state.repoReadiness;
    if (readiness?.hasSetupWorkflow && readiness?.hasAgentConfig) {
      pipeline.setSetupPRMerged();
      return;
    }

    pipeline.setCreatingSetupPR();
    try {
      const config = {
        ...pipeline.state.config!,
        identityId: resolvedIdentityId,
        appName: resolvedAppName,
      };
      const pr = await createSetupPR(gitHubAuth.octokit!, config);
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
  ]);

  // --- Handler: redeploy ---
  const handleRedeploy = useCallback(async () => {
    if (!gitHubAuth.octokit || !selectedRepo) return;
    try {
      await dispatchWorkflow(
        gitHubAuth.octokit,
        selectedRepo.owner,
        selectedRepo.repo,
        'deploy-to-aks.yml',
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
    setIdentityId,
    localAppName,
    setLocalAppName,
    checkRepoAndApp,
    handleCreateSetupPR,
    handleRedeploy,
    setupPrPolling,
    generatedPrPolling,
    agentPrDiscoveryPollNow: agentPrDiscovery.pollNow,
    workflowPolling,
    deploymentHealth,
  };
};
