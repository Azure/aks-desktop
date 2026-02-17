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
  /** Numeric GitHub repo ID (used for App install URL pre-selection). */
  id?: number;
  /** Numeric GitHub owner/org ID (used for App install URL pre-selection). */
  ownerId?: number;
}

/**
 * Status of repo readiness for the Copilot agent (Step B).
 */
export interface RepoReadiness {
  /** Whether copilot-setup-steps.yml exists on the default branch. */
  hasSetupWorkflow: boolean;
  /** Whether containerization.agent.md exists on the default branch. */
  hasAgentConfig: boolean;
  /** Whether Copilot Coding Agent is enabled for the repo/org. */
  copilotAgentEnabled: boolean | null;
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
