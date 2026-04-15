// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import {
  createBranch,
  createOrUpdateFile,
  createPullRequest,
  getDefaultBranchSha,
} from '../../../utils/github/github-api';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { PIPELINE_WORKFLOW_FILENAME } from '../constants';
import type { PipelineConfig, PRTracking } from '../types';
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
}

/**
 * Derives the ACR short name from PipelineConfig.
 * Tries acrLoginServer first ("myacr.azurecr.io" → "myacr"),
 * falls back to acrResourceId (".../registries/myacr" → "myacr").
 */
function deriveAcrName(config: PipelineConfig): string {
  if (config.acrLoginServer) {
    const name = config.acrLoginServer.split('.')[0];
    if (name) return name;
  }
  if (config.acrResourceId) {
    const segments = config.acrResourceId.split('/');
    const idx = segments.findIndex(s => s.toLowerCase() === 'registries');
    if (idx !== -1 && idx + 1 < segments.length && segments[idx + 1]) {
      return segments[idx + 1];
    }
  }
  throw new Error(
    'Cannot derive ACR name: neither acrLoginServer nor acrResourceId is set on PipelineConfig'
  );
}

/**
 * Creates a single PR containing the deploy workflow + K8s manifests.
 * On failure, attempts to clean up the created branch.
 */
export async function createFastPathPR(
  octokit: Octokit,
  config: FastPathPRConfig
): Promise<PRTracking> {
  const { pipelineConfig, dockerfilePath, buildContextPath, containerConfig } = config;
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

    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      `.github/workflows/${PIPELINE_WORKFLOW_FILENAME}`,
      workflowYaml,
      `Add AKS deploy workflow for ${pipelineConfig.appName}`,
      branchName
    );

    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      'deploy/kubernetes/deployment.yaml',
      deploymentYaml,
      `Add Kubernetes deployment manifest for ${pipelineConfig.appName}`,
      branchName
    );

    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      'deploy/kubernetes/service.yaml',
      serviceYaml,
      `Add Kubernetes service manifest for ${pipelineConfig.appName}`,
      branchName
    );

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
    // Best-effort cleanup: delete the branch to avoid dangling refs
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
}
