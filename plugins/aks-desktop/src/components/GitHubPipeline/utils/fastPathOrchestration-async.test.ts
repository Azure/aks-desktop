// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateCopilotAssignedIssue } = vi.hoisted(() => ({
  mockCreateCopilotAssignedIssue: vi.fn(),
}));

vi.mock('../../../utils/github/github-api', () => ({
  createCopilotAssignedIssue: mockCreateCopilotAssignedIssue,
}));

import { triggerAsyncAgentReview } from './fastPathOrchestration';

const mockOctokit = {} as unknown as Octokit;

describe('triggerAsyncAgentReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCopilotAssignedIssue.mockResolvedValue({
      number: 42,
      url: 'https://github.com/test/repo/issues/42',
    });
  });

  it('should create an issue and assign to Copilot', async () => {
    const result = await triggerAsyncAgentReview(mockOctokit, {
      owner: 'test',
      repo: 'my-repo',
      defaultBranch: 'main',
      appName: 'contoso-air',
      namespace: 'demo',
      clusterName: 'aks-prod',
      dockerfilePath: './Dockerfile',
      manifestsPath: './deploy/kubernetes/',
    });

    expect(mockCreateCopilotAssignedIssue).toHaveBeenCalledWith(
      mockOctokit,
      'test',
      'my-repo',
      expect.stringContaining('Review and improve'),
      expect.any(String),
      'main'
    );
    expect(result).toBe('https://github.com/test/repo/issues/42');
  });

  it('should scope review to Dockerfile and manifests', async () => {
    await triggerAsyncAgentReview(mockOctokit, {
      owner: 'test',
      repo: 'my-repo',
      defaultBranch: 'main',
      appName: 'contoso-air',
      namespace: 'demo',
      clusterName: 'aks-prod',
      dockerfilePath: './src/Dockerfile',
      manifestsPath: './deploy/kubernetes/',
    });

    const issueBody = mockCreateCopilotAssignedIssue.mock.calls[0][4];
    expect(issueBody).toContain('./src/Dockerfile');
    expect(issueBody).toContain('./deploy/kubernetes/');
    expect(issueBody).toContain('Do NOT modify the GitHub Actions workflow');
  });

  it('should include app context in issue body', async () => {
    await triggerAsyncAgentReview(mockOctokit, {
      owner: 'test',
      repo: 'my-repo',
      defaultBranch: 'main',
      appName: 'contoso-air',
      namespace: 'demo',
      clusterName: 'aks-prod',
      dockerfilePath: './Dockerfile',
      manifestsPath: './deploy/kubernetes/',
    });

    const issueBody = mockCreateCopilotAssignedIssue.mock.calls[0][4];
    expect(issueBody).toContain('contoso-air');
    expect(issueBody).toContain('demo');
    expect(issueBody).toContain('aks-prod');
  });
});
