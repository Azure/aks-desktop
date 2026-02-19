// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { GitHubRepo } from '../../../types/github';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../hooks/useGitHubPipelineState';
import type { PipelineDeploymentState } from '../types';

export const ACTIVE_PIPELINE_KEY_PREFIX = 'aks-desktop:active-pipeline:';

/**
 * States where the pipeline wizard should be resumable. Includes 'Failed'
 * so users can re-enter the wizard and retry from the failure point.
 */
export const RESUMABLE_STATES: ReadonlySet<PipelineDeploymentState> =
  new Set<PipelineDeploymentState>([
    'AppInstallationNeeded',
    'CheckingRepo',
    'ReadyForSetup',
    'SetupPRCreating',
    'SetupPRAwaitingMerge',
    'AgentTaskCreating',
    'AgentRunning',
    'GeneratedPRAwaitingMerge',
    'PipelineRunning',
    'Failed',
  ]);

function isValidGitHubRepo(value: unknown): value is GitHubRepo {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.owner === 'string' &&
    typeof obj.repo === 'string' &&
    typeof obj.defaultBranch === 'string'
  );
}

/**
 * Reads the active pipeline reference for a given cluster+namespace.
 * Used by DeployButton to detect in-progress pipelines.
 */
export function getActivePipeline(
  cluster: string,
  ns: string
): { repo: GitHubRepo; state: PipelineDeploymentState } | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidGitHubRepo(parsed)) return null;
    const repo = parsed;
    const stateRaw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${repo.owner}/${repo.repo}`);
    if (!stateRaw) return null;
    const pipelineState = JSON.parse(stateRaw) as {
      __schemaVersion?: number;
      deploymentState?: string;
    };
    if (pipelineState?.__schemaVersion !== SCHEMA_VERSION) return null;
    const state = pipelineState?.deploymentState;
    if (!state || !RESUMABLE_STATES.has(state as PipelineDeploymentState)) return null;
    const deploymentState = state as PipelineDeploymentState;
    return { repo, state: deploymentState };
  } catch {
    return null;
  }
}
