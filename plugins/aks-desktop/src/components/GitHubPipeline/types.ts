// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type {
  GitHubRepo,
  RepoReadiness,
  WorkflowRunConclusion,
  WorkflowRunStatus,
} from '../../types/github';

/**
 * Deployment state machine states per PRD Section 6.4.
 *
 * States marked with (*) are implementation sub-states not in the PRD but
 * needed for fine-grained UX (loading spinners, conditional screens).
 */
export type PipelineDeploymentState =
  | 'Configured' // Config collected, ready to start
  | 'GitHubAuthorizationNeeded' // GitHub OAuth not authorized
  | 'AppInstallationNeeded' // GitHub App not installed on repo
  | 'CheckingRepo' // (*) Checking repo readiness (agent config exists?)
  | 'ReadyForSetup' // (*) Repo checked, showing AgentSetupReview before creating PR
  | 'SetupPRCreating' // Creating the setup PR (pushing files, opening PR)
  | 'SetupPRAwaitingMerge' // Setup PR created, awaiting user merge
  | 'CopilotNotEnabled' // (*) Copilot Coding Agent not enabled — guide user
  | 'AgentTaskCreating' // Creating issue + assigning to Copilot
  | 'AgentRunning' // Copilot agent is working, waiting for generated PR
  | 'GeneratedPRAwaitingMerge' // Agent created the deployment PR, awaiting user merge
  | 'PipelineRunning' // Deployment workflow running after merge
  | 'Deployed' // Deployment successful
  | 'Failed'; // Any step failed

/**
 * GitHub OAuth device flow auth state.
 */
export interface GitHubAuthState {
  /** Whether the user has authorized via device flow and we have a valid token. */
  isAuthenticated: boolean;
  /** Whether we're restoring a previous session from localStorage (true until restore completes). */
  isRestoring: boolean;
  /** Whether we're actively waiting for the user to complete device flow authorization. */
  isAuthorizingDevice: boolean;
  /** The user-to-server access token (expires ~8 hours). */
  token: string | null;
  /** The refresh token (expires ~6 months). */
  refreshToken: string | null;
  /** ISO timestamp when the access token expires. */
  expiresAt: string | null;
  /** The device flow user code (displayed to user during authorization). */
  userCode: string | null;
  /** The device flow verification URI (opened in browser). */
  verificationUri: string | null;
  /** The authenticated GitHub username. */
  username: string | null;
  /** Error message, if any. */
  error: string | null;
}

/**
 * Pipeline deployment configuration — collected from the existing deploy wizard.
 * Serialized into the agent task issue body per PRD Section 6.3.
 */
export interface PipelineConfig {
  // From Azure/AKS context (PRD Section 6.3 input contract)
  tenantId: string;
  identityId: string;
  subscriptionId: string;
  clusterName: string;
  resourceGroup: string;
  namespace: string;

  // Application context
  appName: string;
  serviceType: 'ClusterIP' | 'LoadBalancer';

  // Optional overrides — omitted in v1 (Copilot agent + containerization-assist-mcp auto-detects)
  imageReference?: string;
  ingressEnabled?: boolean;
  ingressHost?: string;
  port?: number;

  // GitHub-specific (not part of agent payload — used by AKS Desktop internally)
  repo: GitHubRepo;
}

/**
 * Tracks a PR's URL, number, and merge status.
 * Reused for both the setup PR and the agent-generated PR.
 */
export interface PRTracking {
  url: string | null;
  number: number | null;
  merged: boolean;
}

/**
 * Tracks a GitHub issue's URL and number.
 */
export interface IssueTracking {
  url: string | null;
  number: number | null;
}

/**
 * Tracks a GitHub Actions workflow run.
 */
export interface WorkflowRunTracking {
  url: string | null;
  id: number | null;
  status: WorkflowRunStatus | null;
  conclusion: WorkflowRunConclusion;
}

/**
 * Overall pipeline state tracked by AKS Desktop.
 * Must be serializable for persistence (PRD Section 6.4: resume after restart).
 */
export interface PipelineState {
  deploymentState: PipelineDeploymentState;
  config: PipelineConfig | null;

  // Repo readiness (Step B)
  repoReadiness: RepoReadiness | null;

  // Setup PR tracking (Step C)
  setupPr: PRTracking;

  // Agent trigger tracking (Step D)
  triggerIssue: IssueTracking;

  // Generated PR tracking (Step E — created by Copilot agent)
  generatedPr: PRTracking;

  // Workflow run tracking (Step F)
  workflowRun: WorkflowRunTracking;

  // Deployment tracking (Step F)
  deployment: {
    podStatus: string | null;
    serviceEndpoint: string | null;
    healthSummary: string | null;
  };

  // The last non-Failed state, used by RETRY to resume from the right point
  lastSuccessfulState: PipelineDeploymentState | null;

  // Error
  error: string | null;

  // Timestamps
  createdAt: string | null;
  updatedAt: string | null;
}
