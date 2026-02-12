// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import {
  assignIssueToCopilot,
  createBranch,
  createIssue,
  createOrUpdateFile,
  createPullRequest,
  getDefaultBranchSha,
} from '../../../utils/github/github-api';
import type { IssueTracking, PipelineConfig, PRTracking } from '../types';
import {
  generateAgentConfig,
  generateBranchName,
  SETUP_WORKFLOW_CONTENT,
  validatePipelineConfig,
} from './agentTemplates';

/**
 * Creates the setup PR that adds Copilot agent config files to the repo (Step C).
 * Creates a branch, pushes copilot-setup-steps.yml and containerization.agent.md,
 * then opens a PR against the default branch.
 */
export const createSetupPR = async (
  octokit: Octokit,
  config: PipelineConfig
): Promise<PRTracking> => {
  const { owner, repo, defaultBranch } = config.repo;
  const branchName = generateBranchName(config.appName);

  // 1. Get default branch SHA
  const sha = await getDefaultBranchSha(octokit, owner, repo, defaultBranch);

  // 2. Create new branch
  await createBranch(octokit, owner, repo, branchName, sha);

  // 3. Generate file contents
  const agentConfig = generateAgentConfig(config);

  // 4. Push copilot-setup-steps.yml
  await createOrUpdateFile(
    octokit,
    owner,
    repo,
    '.github/workflows/copilot-setup-steps.yml',
    SETUP_WORKFLOW_CONTENT,
    'Add Copilot setup workflow for containerization agent',
    branchName
  );

  // 5. Push containerization.agent.md
  await createOrUpdateFile(
    octokit,
    owner,
    repo,
    '.github/agents/containerization.agent.md',
    agentConfig,
    `Add containerization agent config for ${config.appName}`,
    branchName
  );

  // 6. Create setup PR
  const pr = await createPullRequest(
    octokit,
    owner,
    repo,
    `Enable AKS deployment agent for ${config.appName}`,
    [
      '## AKS Desktop — Containerization Agent Setup',
      '',
      'This PR adds the GitHub Copilot Coding Agent configuration for containerizing and deploying this application to AKS.',
      '',
      '### What gets added',
      '- `.github/workflows/copilot-setup-steps.yml` — environment setup for the agent',
      '- `.github/agents/containerization.agent.md` — agent instructions for containerization + AKS deployment',
      '',
      '### What happens after merge',
      'The Copilot Coding Agent will analyze this repository and create a follow-up PR with:',
      '- A best-practice Dockerfile',
      '- Kubernetes manifests in `/deploy/kubernetes/`',
      '- `.github/workflows/deploy-to-aks.yml` (deployment workflow)',
      '- Optional `/deploy/README.md`',
      '',
      '### AKS Configuration',
      `- **Cluster**: ${config.clusterName}`,
      `- **Resource Group**: ${config.resourceGroup}`,
      `- **Namespace**: ${config.namespace}`,
      '',
      '---',
      '_Created by AKS Desktop_',
    ].join('\n'),
    branchName,
    defaultBranch
  );

  return { url: pr.url, number: pr.number, merged: false };
};

/**
 * Creates an issue with the AKS config payload and assigns it to Copilot (Step D).
 * Uses a two-step approach:
 *   1. Create the issue (without assignees — `copilot` is not a valid assignee)
 *   2. Assign `copilot-swe-agent[bot]` via the assignees endpoint with `agent_assignment`
 *
 * Called automatically after the setup PR merge is detected.
 */
export const triggerCopilotAgent = async (
  octokit: Octokit,
  config: PipelineConfig
): Promise<IssueTracking> => {
  const { owner, repo, defaultBranch } = config.repo;

  // Validate inputs before constructing issue payload (PRD Section 9)
  const validation = validatePipelineConfig(config);
  if (!validation.isValid) {
    throw new Error(`Invalid pipeline config: ${validation.errors.join(', ')}`);
  }

  // PRD Section 6.3: payload in a single fenced block to reduce ambiguity
  const issueBody = [
    '```yaml',
    `cluster: ${config.clusterName}`,
    `resourceGroup: ${config.resourceGroup}`,
    `namespace: ${config.namespace}`,
    `tenantId: ${config.tenantId}`,
    `identityId: ${config.identityId}`,
    `subscriptionId: ${config.subscriptionId}`,
    `appName: ${config.appName}`,
    `serviceType: ${config.serviceType}`,
    config.ingressEnabled !== undefined ? `ingressEnabled: ${config.ingressEnabled}` : null,
    config.ingressHost ? `ingressHost: ${config.ingressHost}` : null,
    config.imageReference ? `imageReference: ${config.imageReference}` : null,
    config.port ? `port: ${config.port}` : null,
    '```',
  ]
    .filter(Boolean)
    .join('\n');

  // Step 1: Create the issue without assignees
  const issue = await createIssue(
    octokit,
    owner,
    repo,
    'Generate AKS deployment pipeline',
    issueBody,
    []
  );

  // Step 2: Assign Copilot Coding Agent via the dedicated assignees endpoint
  await assignIssueToCopilot(octokit, owner, repo, issue.number, defaultBranch);

  return { url: issue.url, number: issue.number };
};
