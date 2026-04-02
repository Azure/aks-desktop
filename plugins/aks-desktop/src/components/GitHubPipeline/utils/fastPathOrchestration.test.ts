// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainerConfig, createValidConfig } from '../__fixtures__/pipelineConfig';

const { mockGetDefaultBranchSha, mockCreateBranch, mockCreateOrUpdateFile, mockCreatePullRequest } =
  vi.hoisted(() => ({
    mockGetDefaultBranchSha: vi.fn(),
    mockCreateBranch: vi.fn(),
    mockCreateOrUpdateFile: vi.fn(),
    mockCreatePullRequest: vi.fn(),
  }));

vi.mock('../../../utils/github/github-api', () => ({
  getDefaultBranchSha: mockGetDefaultBranchSha,
  createBranch: mockCreateBranch,
  createOrUpdateFile: mockCreateOrUpdateFile,
  createPullRequest: mockCreatePullRequest,
}));

const { mockGenerateDeployWorkflow, mockGenerateDeploymentManifest, mockGenerateServiceManifest } =
  vi.hoisted(() => ({
    mockGenerateDeployWorkflow: vi.fn(() => 'workflow-yaml'),
    mockGenerateDeploymentManifest: vi.fn(() => 'deployment-yaml'),
    mockGenerateServiceManifest: vi.fn(() => 'service-yaml'),
  }));

vi.mock('./fastPathTemplates', () => ({
  generateDeployWorkflow: mockGenerateDeployWorkflow,
  generateDeploymentManifest: mockGenerateDeploymentManifest,
  generateServiceManifest: mockGenerateServiceManifest,
}));

import { createFastPathPR, type FastPathPRConfig } from './fastPathOrchestration';

const mockRequest = vi.fn();
const mockOctokit = { request: mockRequest } as unknown as Octokit;

const validConfig = createValidConfig({
  acrLoginServer: 'acrprod.azurecr.io',
});

const baseFastPathConfig: FastPathPRConfig = {
  pipelineConfig: validConfig,
  dockerfilePath: './Dockerfile',
  buildContextPath: '.',
  containerConfig: createContainerConfig(),
};

describe('fastPathOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultBranchSha.mockResolvedValue('sha123');
    mockCreateBranch.mockResolvedValue(undefined);
    mockCreateOrUpdateFile.mockResolvedValue(undefined);
    mockCreatePullRequest.mockResolvedValue({
      number: 10,
      url: 'https://github.com/testuser/my-repo/pull/10',
    });
  });

  describe('createFastPathPR', () => {
    it('should create branch from default branch SHA', async () => {
      await createFastPathPR(mockOctokit, baseFastPathConfig);

      expect(mockGetDefaultBranchSha).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'main'
      );
      expect(mockCreateBranch).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        expect.stringContaining('aks-project/fast-path-my-app-'),
        'sha123'
      );
    });

    it('should push workflow + deployment + service manifests', async () => {
      await createFastPathPR(mockOctokit, baseFastPathConfig);

      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(3);
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        '.github/workflows/deploy-to-aks.yml',
        'workflow-yaml',
        expect.any(String),
        expect.any(String)
      );
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'deploy/kubernetes/deployment.yaml',
        'deployment-yaml',
        expect.any(String),
        expect.any(String)
      );
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'deploy/kubernetes/service.yaml',
        'service-yaml',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should call template generators with correct config', async () => {
      await createFastPathPR(mockOctokit, baseFastPathConfig);

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          appName: 'my-app',
          clusterName: 'my-cluster',
          resourceGroup: 'my-rg',
          namespace: 'production',
          acrName: 'acrprod',
          dockerfilePath: './Dockerfile',
          buildContextPath: '.',
          defaultBranch: 'main',
        })
      );
      expect(mockGenerateDeploymentManifest).toHaveBeenCalledWith(
        expect.objectContaining({
          appName: 'my-app',
          namespace: 'production',
          acrName: 'acrprod',
          repoOwner: 'testuser',
          repoName: 'my-repo',
        }),
        baseFastPathConfig.containerConfig
      );
    });

    it('should open PR with descriptive body', async () => {
      const result = await createFastPathPR(mockOctokit, baseFastPathConfig);

      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        expect.stringContaining('my-app'),
        expect.stringContaining('deploy-to-aks.yml'),
        expect.stringContaining('aks-project/fast-path-my-app-'),
        'main'
      );
      expect(result).toEqual({
        url: 'https://github.com/testuser/my-repo/pull/10',
        number: 10,
        merged: false,
      });
    });

    it('should clean up branch on failure', async () => {
      mockCreateOrUpdateFile.mockRejectedValueOnce(new Error('push failed'));

      await expect(createFastPathPR(mockOctokit, baseFastPathConfig)).rejects.toThrow(
        'push failed'
      );

      expect(mockRequest).toHaveBeenCalledWith(
        'DELETE /repos/{owner}/{repo}/git/refs/{ref}',
        expect.objectContaining({
          owner: 'testuser',
          repo: 'my-repo',
          ref: expect.stringContaining('heads/aks-project/fast-path-my-app-'),
        })
      );
    });

    it('should derive ACR name from acrLoginServer', async () => {
      await createFastPathPR(mockOctokit, baseFastPathConfig);

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ acrName: 'acrprod' })
      );
    });

    it('should derive ACR name from acrResourceId when no login server', async () => {
      const configWithResourceId = createValidConfig({
        acrLoginServer: undefined,
        acrResourceId:
          '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/myacr',
      });

      await createFastPathPR(mockOctokit, {
        ...baseFastPathConfig,
        pipelineConfig: configWithResourceId,
      });

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ acrName: 'myacr' })
      );
    });

    it('should throw when ACR name cannot be derived', async () => {
      const configNoAcr = createValidConfig({
        acrLoginServer: undefined,
        acrResourceId: undefined,
      });

      await expect(
        createFastPathPR(mockOctokit, {
          ...baseFastPathConfig,
          pipelineConfig: configNoAcr,
        })
      ).rejects.toThrow('ACR');
    });
  });
});
