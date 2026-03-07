// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared GitHub types used by both `utils/github/` and `components/GitHubPipeline/`.
 * Extracted here to avoid circular imports (utils → components).
 */

/**
 * GitHub repository reference.
 */
export interface GitHubRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
}

/**
 * Status of repo readiness for the Copilot coding agent.
 */
export interface RepoReadiness {
  /** Whether copilot-setup-steps.yml exists on the default branch. */
  hasSetupWorkflow: boolean;
  /** Whether containerization.agent.md exists on the default branch. */
  hasAgentConfig: boolean;
  /** Whether deploy-to-aks.yml exists on the default branch. */
  hasDeployWorkflow: boolean;
}

/**
 * Pipeline run status.
 */
export type WorkflowRunStatus = 'queued' | 'in_progress' | 'completed' | 'waiting';
export type WorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | null;

/** Alias — status/conclusion types are shared across workflow runs and check runs. */
export type GitHubRunStatus = WorkflowRunStatus;
export type GitHubRunConclusion = WorkflowRunConclusion;
