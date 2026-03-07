// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import {
  assignIssueToCopilot,
  createBranch,
  createIssue,
  createOrUpdateFile,
  createPullRequest,
  getDefaultBranchSha,
  setRepoSecrets,
} from '../../../utils/github/github-api';
import {
  AGENT_CONFIG_PATH,
  COPILOT_SETUP_STEPS_PATH,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
import type { IssueTracking, PipelineConfig, PRTracking } from '../types';
import {
  generateAgentConfig,
  generateBranchName,
  getActiveEnvVars,
  SETUP_WORKFLOW_CONTENT,
  validatePipelineConfig,
} from './agentTemplates';
import { getProbeConfigs, renderProbeYaml } from './probeHelpers';
import { escapeYamlValue } from './yamlUtils';

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

  const sha = await getDefaultBranchSha(octokit, owner, repo, defaultBranch);

  await createBranch(octokit, owner, repo, branchName, sha);

  try {
    const agentConfig = generateAgentConfig(config);

    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      COPILOT_SETUP_STEPS_PATH,
      SETUP_WORKFLOW_CONTENT,
      'Add Copilot setup workflow for containerization agent',
      branchName
    );

    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      AGENT_CONFIG_PATH,
      agentConfig,
      `Add containerization agent config for ${config.appName}`,
      branchName
    );

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
        `- \`${COPILOT_SETUP_STEPS_PATH}\` — environment setup for the agent`,
        `- \`${AGENT_CONFIG_PATH}\` — agent instructions for containerization + AKS deployment`,
        '',
        '### What happens after merge',
        'The Copilot Coding Agent will analyze this repository and create a follow-up PR with:',
        '- A best-practice Dockerfile',
        '- Kubernetes manifests in `/deploy/kubernetes/`',
        `- \`.github/workflows/${PIPELINE_WORKFLOW_FILENAME}\` (deployment workflow)`,
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
  } catch (err) {
    // Best-effort cleanup: delete the branch we just created to avoid dangling refs
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
    } catch (cleanupErr) {
      console.warn(`Failed to clean up branch ${branchName}:`, cleanupErr);
    }
    throw err;
  }
};

/**
 * Converts an env var key to a GitHub Actions secret name.
 * Prefixes with `APP_ENV_` and converts to UPPER_SNAKE_CASE.
 */
export const toEnvSecretName = (key: string): string =>
  `APP_ENV_${key
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')}`;

/**
 * Creates GitHub Actions repository secrets for sensitive pipeline values (Step D-pre).
 *
 * Stores Azure credentials and user-defined environment variables as encrypted
 * repository secrets so they never appear in issue bodies or agent config files.
 */
export const createPipelineSecrets = async (
  octokit: Octokit,
  config: PipelineConfig
): Promise<void> => {
  const { owner, repo } = config.repo;

  const secrets: Record<string, string> = {
    AZURE_CLIENT_ID: config.identityId,
    AZURE_TENANT_ID: config.tenantId,
    AZURE_SUBSCRIPTION_ID: config.subscriptionId,
  };

  const envVars = getActiveEnvVars(config);
  for (const { key, value } of envVars) {
    secrets[toEnvSecretName(key)] = value;
  }

  await setRepoSecrets(octokit, owner, repo, secrets);
};

/**
 * Creates an issue with the AKS config payload and assigns it to Copilot (Step D).
 * Uses a two-step approach:
 *   1. Create the issue (without assignees — `copilot` is not a valid assignee)
 *   2. Assign `copilot-swe-agent[bot]` via the assignees endpoint with `agent_assignment`
 *
 * Sensitive values (Azure credentials, env var values) are stored as GitHub
 * repository secrets by `createPipelineSecrets` before this function is called.
 * The issue body references secret names instead of plaintext values.
 *
 * Called automatically after the setup PR merge is detected.
 */
export const triggerCopilotAgent = async (
  octokit: Octokit,
  config: PipelineConfig
): Promise<IssueTracking> => {
  const { owner, repo, defaultBranch } = config.repo;

  const validation = validatePipelineConfig(config);
  if (!validation.isValid) {
    throw new Error(`Invalid pipeline config: ${validation.errors.join(', ')}`);
  }

  // PRD Section 6.3: payload in a single fenced block to reduce ambiguity.
  // Sensitive values are NOT included — they are stored as GitHub secrets.
  const cc = config.containerConfig;
  const envVars = getActiveEnvVars(config);

  const issueBody = [
    '```yaml',
    '# AKS Configuration',
    `cluster: "${escapeYamlValue(config.clusterName)}"`,
    `resourceGroup: "${escapeYamlValue(config.resourceGroup)}"`,
    `namespace: "${escapeYamlValue(config.namespace)}"`,
    '',
    '# Azure credentials are stored as GitHub repository secrets:',
    '# secrets.AZURE_CLIENT_ID, secrets.AZURE_TENANT_ID, secrets.AZURE_SUBSCRIPTION_ID',
    '',
    '# Application',
    `appName: "${escapeYamlValue(config.appName)}"`,
    cc?.containerImage ? `containerImage: "${escapeYamlValue(cc.containerImage)}"` : null,
    `serviceType: "${escapeYamlValue(config.serviceType)}"`,
    cc ? `targetPort: ${cc.targetPort}` : null,
    cc?.useCustomServicePort ? `servicePort: ${cc.servicePort}` : null,
    cc ? `replicas: ${cc.replicas}` : null,
    config.ingressEnabled !== undefined ? `ingressEnabled: ${config.ingressEnabled}` : null,
    config.ingressHost ? `ingressHost: "${escapeYamlValue(config.ingressHost)}"` : null,
    config.imageReference ? `imageReference: "${escapeYamlValue(config.imageReference)}"` : null,
    config.port ? `port: ${config.port}` : null,
    cc?.enableResources
      ? [
          '',
          '# Resource Limits',
          `cpuRequest: "${escapeYamlValue(cc.cpuRequest)}"`,
          `cpuLimit: "${escapeYamlValue(cc.cpuLimit)}"`,
          `memoryRequest: "${escapeYamlValue(cc.memoryRequest)}"`,
          `memoryLimit: "${escapeYamlValue(cc.memoryLimit)}"`,
        ].join('\n')
      : null,
    envVars.length > 0
      ? [
          '',
          '# Environment Variables (values stored as GitHub secrets)',
          'envVars:',
          ...envVars.map(
            e => `  - key: "${escapeYamlValue(e.key)}"\n    secretRef: "${toEnvSecretName(e.key)}"`
          ),
        ].join('\n')
      : null,
    cc
      ? [
          '',
          '# Health Probes',
          ...getProbeConfigs(cc).flatMap(probe => renderProbeYaml(probe)),
        ].join('\n')
      : null,
    cc?.enableHpa
      ? [
          '',
          '# Horizontal Pod Autoscaler',
          'hpa:',
          `  enabled: true`,
          `  minReplicas: ${cc.hpaMinReplicas}`,
          `  maxReplicas: ${cc.hpaMaxReplicas}`,
          `  targetCPU: ${cc.hpaTargetCpu}`,
        ].join('\n')
      : null,
    cc && (cc.runAsNonRoot || cc.readOnlyRootFilesystem || cc.allowPrivilegeEscalation === false)
      ? [
          '',
          '# Security Context',
          cc.runAsNonRoot !== undefined ? `runAsNonRoot: ${cc.runAsNonRoot}` : null,
          cc.readOnlyRootFilesystem !== undefined
            ? `readOnlyRootFilesystem: ${cc.readOnlyRootFilesystem}`
            : null,
          cc.allowPrivilegeEscalation !== undefined
            ? `allowPrivilegeEscalation: ${cc.allowPrivilegeEscalation}`
            : null,
        ]
          .filter(line => line !== null)
          .join('\n')
      : null,
    cc && (cc.enablePodAntiAffinity || cc.enableTopologySpreadConstraints)
      ? [
          '',
          '# Affinity',
          `podAntiAffinity: ${cc.enablePodAntiAffinity}`,
          `topologySpreadConstraints: ${cc.enableTopologySpreadConstraints}`,
        ].join('\n')
      : null,
    '```',
  ]
    .filter(line => line !== null)
    .join('\n');

  const issue = await createIssue(
    octokit,
    owner,
    repo,
    'Generate AKS deployment pipeline',
    issueBody,
    []
  );

  await assignIssueToCopilot(octokit, owner, repo, issue.number, defaultBranch);

  return { url: issue.url, number: issue.number };
};
