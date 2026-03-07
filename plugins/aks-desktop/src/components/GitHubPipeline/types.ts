// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { GitHubRepo, RepoReadiness } from '../../types/github';
import type { ContainerConfig } from '../DeployWizard/hooks/useContainerConfiguration';

/**
 * Deployment state machine states per PRD Section 6.4.
 * States marked (*) are transient — the UI passes through them automatically.
 * Add new states here — the union type is derived automatically.
 */
export const DEPLOYMENT_STATES = [
  'Configured',
  'GitHubAuthorizationNeeded',
  'AppInstallationNeeded',
  'CheckingRepo', // (*)
  'WorkloadIdentitySetup', // (*)
  'ReadyForSetup', // (*)
  'SetupPRCreating',
  'SetupPRAwaitingMerge',
  'AgentTaskCreating',
  'AgentRunning',
  'GeneratedPRAwaitingMerge',
  'PipelineConfigured',
  'PipelineRunning',
  'Deployed',
  'Failed',
] as const;

export type PipelineDeploymentState = (typeof DEPLOYMENT_STATES)[number];

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
  tenantId: string;
  identityId: string;
  subscriptionId: string;
  clusterName: string;
  resourceGroup: string;
  namespace: string;
  appName: string;
  serviceType: 'ClusterIP' | 'LoadBalancer';
  imageReference?: string;
  ingressEnabled?: boolean;
  ingressHost?: string;
  port?: number;
  containerConfig?: ContainerConfig;
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

/**
 * Overall pipeline state tracked by AKS Desktop.
 * Must be serializable for persistence (PRD Section 6.4: resume after restart).
 */
export interface PipelineState {
  deploymentState: PipelineDeploymentState;
  config: PipelineConfig | null;
  repoReadiness: RepoReadiness | null;
  setupPr: PRTracking;
  triggerIssue: IssueTracking;
  generatedPr: PRTracking;
  serviceEndpoint: string | null;
  lastSuccessfulState: PipelineDeploymentState | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
