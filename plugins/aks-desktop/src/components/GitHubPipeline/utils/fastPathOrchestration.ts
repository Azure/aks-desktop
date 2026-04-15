// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import {
  createBranch,
  createCopilotAssignedIssue,
  createOrUpdateFile,
  createPullRequest,
  deleteBranch,
  getDefaultBranchSha,
} from '../../../utils/github/github-api';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import {
  AGENT_CONFIG_PATH,
  COPILOT_SETUP_STEPS_PATH,
  MANIFESTS_DIR,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
import type { PipelineConfig, PRTracking } from '../types';
import { pushAgentConfigFiles } from './agentTemplates';
import { deriveAcrName } from './deriveAcrName';
import {
  generateDeploymentManifest,
  generateDeployWorkflow,
  generateServiceManifest,
} from './fastPathTemplates';

export interface FastPathPRConfig {
  /** Validated cluster, namespace, ACR, and GitHub repo metadata for the target app. */
  pipelineConfig: PipelineConfig;
  /** Repo-relative path to the selected Dockerfile (e.g. `src/web/Dockerfile`). */
  dockerfilePath: string;
  /** Build context directory passed to `docker build` (e.g. `./src/web`). */
  buildContextPath: string;
  /** Container-level resource/probe/security settings the generated manifests inherit. */
  containerConfig: ContainerConfig;
  /** When true, also pushes Copilot agent config files for async review. */
  withAsyncAgent?: boolean;
}

/**
 * Creates a single PR containing the deploy workflow + K8s manifests.
 * On failure, attempts to clean up the created branch.
 */
export async function createFastPathPR(
  octokit: Octokit,
  config: FastPathPRConfig
): Promise<PRTracking> {
  const { pipelineConfig, dockerfilePath, buildContextPath, containerConfig, withAsyncAgent } =
    config;
  const { owner, repo, defaultBranch } = pipelineConfig.repo;
  const branchName = `aks-project/fast-path-${pipelineConfig.appName}-${Date.now()}`;
  const acrName = deriveAcrName(pipelineConfig);

  const sha = await getDefaultBranchSha(octokit, owner, repo, defaultBranch);
  await createBranch(octokit, owner, repo, branchName, sha);

  try {
    const workflowYaml = generateDeployWorkflow({
      appName: pipelineConfig.appName,
      clusterName: pipelineConfig.clusterName,
      resourceGroup: pipelineConfig.resourceGroup,
      namespace: pipelineConfig.namespace,
      acrName,
      dockerfilePath,
      buildContextPath,
      defaultBranch,
    });

    const manifestConfig = {
      appName: pipelineConfig.appName,
      namespace: pipelineConfig.namespace,
      acrName,
      repoOwner: owner,
      repoName: repo,
    };

    const deploymentYaml = generateDeploymentManifest(manifestConfig, containerConfig);
    const serviceYaml = generateServiceManifest(manifestConfig, containerConfig);

    await Promise.all([
      createOrUpdateFile(
        octokit,
        owner,
        repo,
        `.github/workflows/${PIPELINE_WORKFLOW_FILENAME}`,
        workflowYaml,
        `Add AKS deploy workflow for ${pipelineConfig.appName}`,
        branchName
      ),
      createOrUpdateFile(
        octokit,
        owner,
        repo,
        `${MANIFESTS_DIR}/deployment.yaml`,
        deploymentYaml,
        `Add Kubernetes deployment manifest for ${pipelineConfig.appName}`,
        branchName
      ),
      createOrUpdateFile(
        octokit,
        owner,
        repo,
        `${MANIFESTS_DIR}/service.yaml`,
        serviceYaml,
        `Add Kubernetes service manifest for ${pipelineConfig.appName}`,
        branchName
      ),
    ]);

    if (withAsyncAgent) {
      await pushAgentConfigFiles(octokit, owner, repo, branchName, pipelineConfig);
    }

    const pr = await createPullRequest(
      octokit,
      owner,
      repo,
      `Deploy ${pipelineConfig.appName} to AKS`,
      [
        '## AKS Desktop — Fast Path Deploy',
        '',
        'This PR adds a deterministic deployment pipeline for this application.',
        '',
        '### Files added',
        `- \`.github/workflows/${PIPELINE_WORKFLOW_FILENAME}\` — Build + deploy workflow`,
        '- `deploy/kubernetes/deployment.yaml` — Kubernetes Deployment manifest',
        '- `deploy/kubernetes/service.yaml` — Kubernetes Service manifest',
        ...(withAsyncAgent
          ? [
              `- \`${COPILOT_SETUP_STEPS_PATH}\` — Agent environment setup`,
              `- \`${AGENT_CONFIG_PATH}\` — Agent instructions for improvement review`,
            ]
          : []),
        '',
        '### AKS Configuration',
        `- **Cluster**: ${pipelineConfig.clusterName}`,
        `- **Resource Group**: ${pipelineConfig.resourceGroup}`,
        `- **Namespace**: ${pipelineConfig.namespace}`,
        `- **Dockerfile**: ${dockerfilePath}`,
        '',
        '---',
        '_Created by AKS Desktop (Fast Path)_',
      ].join('\n'),
      branchName,
      defaultBranch
    );

    return { url: pr.url, number: pr.number, merged: false };
  } catch (err) {
    try {
      await deleteBranch(octokit, owner, repo, branchName);
    } catch (cleanupErr) {
      console.warn(`Failed to clean up branch ${branchName}:`, cleanupErr);
    }
    throw err;
  }
}

export interface AsyncAgentReviewConfig {
  /** GitHub repo owner. */
  owner: string;
  /** GitHub repo name. */
  repo: string;
  /** Default branch the generated PR merged into (context for the issue body). */
  defaultBranch: string;
  /** Deployed app name — used in the issue title and body. */
  appName: string;
  /** Kubernetes namespace the app was deployed to. */
  namespace: string;
  /** AKS cluster name — displayed in the issue body for reviewer context. */
  clusterName: string;
  /** Repo-relative Dockerfile path to include in the "what to review" section. */
  dockerfilePath: string;
  /** Repo-relative manifests directory to include in the "what to review" section. */
  manifestsPath: string;
}

/**
 * Creates a GitHub issue asking Copilot to review and improve the Dockerfile
 * and K8s manifests. Scoped to Dockerfile + manifests only — explicitly
 * excludes the workflow file.
 *
 * Returns the issue URL for display in the post-deploy banner.
 */
export async function triggerAsyncAgentReview(
  octokit: Octokit,
  config: AsyncAgentReviewConfig
): Promise<string> {
  const { owner, repo, defaultBranch } = config;

  const issueBody = [
    '## Context',
    '',
    `This application (**${config.appName}**) has been deployed to AKS using an auto-generated pipeline.`,
    `The Dockerfile, K8s manifests, and GitHub Actions workflow are functional but were generated from templates.`,
    'Please review and suggest improvements.',
    '',
    '```yaml',
    '# Current deployment state',
    `dockerfilePath: "${config.dockerfilePath}"`,
    `manifestsPath: "${config.manifestsPath}"`,
    `workflowPath: ".github/workflows/${PIPELINE_WORKFLOW_FILENAME}"`,
    '',
    '# App info',
    `appName: "${config.appName}"`,
    `namespace: "${config.namespace}"`,
    `cluster: "${config.clusterName}"`,
    '',
    '# What to review',
    'reviewScope:',
    '  - dockerfile   # multi-stage optimization, caching, security',
    '  - manifests    # resource sizing, probe paths, security context',
    '```',
    '',
    '## Instructions',
    '',
    '1. Analyze the existing Dockerfile for optimization opportunities',
    '2. Review K8s manifests for best practices',
    '3. **Do NOT modify the GitHub Actions workflow**',
    '4. Open a single PR with all suggested improvements',
    '5. Include clear explanations for each change in the PR description',
  ].join('\n');

  const issue = await createCopilotAssignedIssue(
    octokit,
    owner,
    repo,
    `Review and improve deployment configuration for ${config.appName}`,
    issueBody,
    defaultBranch
  );

  return issue.url;
}
