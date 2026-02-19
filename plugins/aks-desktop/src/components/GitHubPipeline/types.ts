// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type {
  GitHubRepo,
  RepoReadiness,
  WorkflowRunConclusion,
  WorkflowRunStatus,
} from '../../types/github';
import type { ContainerConfig } from '../DeployWizard/hooks/useContainerConfiguration';

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
  | 'AgentTaskCreating' // Creating issue + assigning to Copilot
  | 'AgentRunning' // Copilot agent is working, waiting for generated PR
  | 'GeneratedPRAwaitingMerge' // Agent created the deployment PR, awaiting user merge
  | 'PipelineConfigured' // Pipeline setup complete (configure-only mode — no auto-deploy)
  | 'PipelineRunning' // Deployment workflow running after merge
  | 'Deployed' // Deployment successful
  | 'Failed'; // Any step failed

export interface GitHubAuthState {
  isAuthenticated: boolean;
  isRestoring: boolean;
  isAuthorizingBrowser: boolean;
  /** Expires ~8 hours. */
  token: string | null;
  /** Expires ~6 months. */
  refreshToken: string | null;
  /** ISO timestamp. */
  expiresAt: string | null;
  username: string | null;
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

  // Container configuration from the deploy wizard (passed to agent for manifest generation)
  containerConfig?: ContainerConfig;

  // GitHub-specific (not part of agent payload — used by AKS Desktop internally)
  repo: GitHubRepo;
}

export interface PRTracking {
  url: string | null;
  number: number | null;
  merged: boolean;
}

export interface IssueTracking {
  url: string | null;
  number: number | null;
}

export interface WorkflowRunTracking {
  url: string | null;
  id: number | null;
  status: WorkflowRunStatus | null;
  conclusion: WorkflowRunConclusion | null;
}

export interface DeploymentTracking {
  podStatus: string | null;
  serviceEndpoint: string | null;
  healthSummary: string | null;
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
  deployment: DeploymentTracking;

  // The last non-Failed state, used by RETRY to resume from the right point
  lastSuccessfulState: PipelineDeploymentState | null;

  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
