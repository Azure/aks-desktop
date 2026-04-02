// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateIssue, mockAssignIssueToCopilot } = vi.hoisted(() => ({
  mockCreateIssue: vi.fn(),
  mockAssignIssueToCopilot: vi.fn(),
}));

vi.mock('../../../utils/github/github-api', () => ({
  createIssue: mockCreateIssue,
  assignIssueToCopilot: mockAssignIssueToCopilot,
}));

import { triggerAsyncAgentReview } from './fastPathOrchestration';

const mockOctokit = {} as unknown as Octokit;

describe('triggerAsyncAgentReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateIssue.mockResolvedValue({
      number: 42,
      url: 'https://github.com/test/repo/issues/42',
    });
    mockAssignIssueToCopilot.mockResolvedValue(undefined);
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

    expect(mockCreateIssue).toHaveBeenCalledWith(
      mockOctokit,
      'test',
      'my-repo',
      expect.stringContaining('Review and improve'),
      expect.any(String),
      []
    );
    expect(mockAssignIssueToCopilot).toHaveBeenCalledWith(
      mockOctokit,
      'test',
      'my-repo',
      42,
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

    const issueBody = mockCreateIssue.mock.calls[0][4];
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

    const issueBody = mockCreateIssue.mock.calls[0][4];
    expect(issueBody).toContain('contoso-air');
    expect(issueBody).toContain('demo');
    expect(issueBody).toContain('aks-prod');
  });
});
