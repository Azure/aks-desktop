// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { GitHubRepo } from '../../../types/github';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../constants';
import type { PipelineDeploymentState } from '../types';
import { safeRecord } from './safeRecord';

export const ACTIVE_PIPELINE_KEY_PREFIX = 'aks-desktop:active-pipeline:';

/**
 * States where the pipeline wizard should be resumable. Includes 'Failed'
 * so users can re-enter the wizard and retry from the failure point.
 */
export const RESUMABLE_STATES: ReadonlySet<PipelineDeploymentState> =
  new Set<PipelineDeploymentState>([
    'AppInstallationNeeded',
    'CheckingRepo',
    'WorkloadIdentitySetup',
    'ReadyForSetup',
    'SetupPRCreating',
    'SetupPRAwaitingMerge',
    'AgentTaskCreating',
    'AgentRunning',
    'GeneratedPRAwaitingMerge',
    'PipelineRunning',
    'Failed',
  ]);

export function isValidGitHubRepo(value: unknown): value is GitHubRepo {
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
    const pipelineState: unknown = JSON.parse(stateRaw);
    if (typeof pipelineState !== 'object' || pipelineState === null) return null;
    const record = pipelineState as Record<string, unknown>;
    if (record.__schemaVersion !== SCHEMA_VERSION) return null;
    const state = record.deploymentState;
    if (typeof state !== 'string' || !RESUMABLE_STATES.has(state as PipelineDeploymentState))
      return null;
    const deploymentState = state as PipelineDeploymentState;
    return { repo, state: deploymentState };
  } catch {
    return null;
  }
}

/**
 * Records the active pipeline for a given cluster+namespace.
 * Called when the user starts a new pipeline deployment.
 */
export function setActivePipeline(cluster: string, ns: string, repo: GitHubRepo): void {
  try {
    localStorage.setItem(`${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`, JSON.stringify(repo));
  } catch (err) {
    console.warn('Failed to save active pipeline:', err);
  }
}

/**
 * Iterates all pipeline-state entries in localStorage, calling `visitor` for
 * each entry whose JSON parses to a non-null object. Shared by scan helpers.
 */
function scanPipelineEntries(
  visitor: (key: string, parsed: Record<string, unknown>) => void
): void {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) continue;
      visitor(key, parsed as Record<string, unknown>);
    } catch {
      // skip malformed entries
    }
  }
}

/**
 * Clears the active pipeline reference and all persisted pipeline state for a
 * given cluster+namespace. Called when the user explicitly cancels / starts over.
 *
 * Scans all `pipeline-state:` entries to find any whose config matches the
 * cluster+namespace, because the `active-pipeline:` pointer may have already
 * been cleared by the orchestration hook.
 */
export function clearActivePipeline(cluster: string, ns: string): void {
  try {
    localStorage.removeItem(`${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`);

    const keysToRemove: string[] = [];
    scanPipelineEntries((key, parsed) => {
      const config = safeRecord(parsed.config);
      if (config?.clusterName === cluster && config?.namespace === ns) {
        keysToRemove.push(key);
      }
    });
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('Failed to clear active pipeline:', err);
  }
}

const CONFIGURED_STATES: ReadonlySet<string> = new Set([
  'PipelineConfigured',
  'Deployed',
  'PipelineRunning',
]);

/**
 * Scans localStorage for pipeline state entries whose config matches the
 * given cluster+namespace and whose deploymentState indicates a configured pipeline.
 * Returns deduplicated GitHubRepo objects.
 */
export function findPipelineReposForCluster(cluster: string, namespace: string): GitHubRepo[] {
  const repos: GitHubRepo[] = [];
  scanPipelineEntries((_key, parsed) => {
    const config = safeRecord(parsed.config);
    if (
      CONFIGURED_STATES.has(parsed.deploymentState as string) &&
      config?.repo &&
      config?.clusterName === cluster &&
      config?.namespace === namespace
    ) {
      const r = config.repo;
      if (
        isValidGitHubRepo(r) &&
        !repos.some(existing => existing.owner === r.owner && existing.repo === r.repo)
      ) {
        repos.push(r);
      }
    }
  });
  return repos;
}
