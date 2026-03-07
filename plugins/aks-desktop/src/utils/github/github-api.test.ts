// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PIPELINE_WORKFLOW_FILENAME } from '../../components/GitHubPipeline/constants';

const mockSodiumFns = vi.hoisted(() => {
  const fns = {
    from_base64: vi.fn(),
    from_string: vi.fn(),
    crypto_box_seal: vi.fn(),
    to_base64: vi.fn(),
  };
  return fns;
});

vi.mock('libsodium-wrappers', () => {
  const sodium = {
    ready: Promise.resolve(),
    from_base64: (...args: unknown[]) => mockSodiumFns.from_base64(...args),
    from_string: (...args: unknown[]) => mockSodiumFns.from_string(...args),
    crypto_box_seal: (...args: unknown[]) => mockSodiumFns.crypto_box_seal(...args),
    to_base64: (...args: unknown[]) => mockSodiumFns.to_base64(...args),
    base64_variants: { ORIGINAL: 0 },
  };
  return { ...sodium, default: sodium };
});

const mockOctokit = {
  users: { getAuthenticated: vi.fn() },
  repos: {
    get: vi.fn(),
    getContent: vi.fn(),
    createOrUpdateFileContents: vi.fn(),
    listForAuthenticatedUser: vi.fn(),
  },
  git: {
    getRef: vi.fn(),
    createRef: vi.fn(),
  },
  pulls: {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
  },
  issues: { create: vi.fn(), get: vi.fn() },
  apps: {
    listInstallationsForAuthenticatedUser: vi.fn(),
    listInstallationReposForAuthenticatedUser: vi.fn(),
  },
  actions: {
    listWorkflowRunsForRepo: vi.fn(),
    listWorkflowRuns: vi.fn(),
    getWorkflowRun: vi.fn(),
    listJobsForWorkflowRun: vi.fn(),
    createWorkflowDispatch: vi.fn(),
    getRepoPublicKey: vi.fn(),
    createOrUpdateRepoSecret: vi.fn(),
  },
  checks: {
    listForRef: vi.fn(),
  },
  request: vi.fn(),
  paginate: Object.assign(vi.fn(), { iterator: vi.fn() }),
};

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => mockOctokit),
}));

import {
  assignIssueToCopilot,
  checkAppInstallation,
  checkRepoReadiness,
  createBranch,
  createIssue,
  createOctokitClient,
  createOrUpdateFile,
  createOrUpdateRepoSecret,
  createPullRequest,
  dispatchWorkflow,
  findLinkedPullRequest,
  getCurrentUser,
  getDefaultBranchSha,
  getIssue,
  getPullRequest,
  getRepo,
  getRepoPublicKey,
  getStatusChecks,
  getWorkflowRun,
  listPullRequests,
  listUserRepos,
  listWorkflowRunJobs,
  listWorkflowRuns,
  setRepoSecrets,
} from './github-api';

describe('github-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createOctokitClient', () => {
    it('should create an Octokit instance with the provided token', () => {
      const client = createOctokitClient('test-token');
      expect(client).toBeDefined();
    });
  });

  describe('getCurrentUser', () => {
    it('should return the authenticated user login and avatar', async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: 'testuser', avatar_url: 'https://example.com/avatar.png' },
      });

      const result = await getCurrentUser(mockOctokit as never);
      expect(result).toEqual({ login: 'testuser', avatarUrl: 'https://example.com/avatar.png' });
    });

    it('should throw a descriptive error on failure', async () => {
      mockOctokit.users.getAuthenticated.mockRejectedValue(new Error('Unauthorized'));

      await expect(getCurrentUser(mockOctokit as never)).rejects.toThrow(
        'Failed to get current user: Unauthorized'
      );
    });
  });

  describe('getRepo', () => {
    it('should return repo details', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: { default_branch: 'main', full_name: 'owner/repo' },
      });

      const result = await getRepo(mockOctokit as never, 'owner', 'repo');
      expect(result).toEqual({ defaultBranch: 'main', fullName: 'owner/repo' });
    });

    it('should throw on failure', async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error('Not Found'));

      await expect(getRepo(mockOctokit as never, 'owner', 'repo')).rejects.toThrow(
        'Failed to get repo owner/repo: Not Found'
      );
    });
  });

  describe('checkRepoReadiness', () => {
    it('should detect all files present', async () => {
      mockOctokit.repos.getContent.mockResolvedValue({ data: {} });

      const result = await checkRepoReadiness(mockOctokit as never, 'owner', 'repo', 'main');
      expect(result).toEqual({
        hasSetupWorkflow: true,
        hasAgentConfig: true,
        hasDeployWorkflow: true,
      });
    });

    it('should detect all files missing', async () => {
      const notFoundError = new Error('Not Found');
      Object.assign(notFoundError, { status: 404 });
      mockOctokit.repos.getContent.mockRejectedValue(notFoundError);

      const result = await checkRepoReadiness(mockOctokit as never, 'owner', 'repo', 'main');
      expect(result).toEqual({
        hasSetupWorkflow: false,
        hasAgentConfig: false,
        hasDeployWorkflow: false,
      });
    });

    it('should detect mixed file presence', async () => {
      const notFoundError = new Error('Not Found');
      Object.assign(notFoundError, { status: 404 });

      mockOctokit.repos.getContent
        .mockResolvedValueOnce({ data: {} }) // setup workflow exists
        .mockRejectedValueOnce(notFoundError) // agent config missing
        .mockRejectedValueOnce(notFoundError); // deploy workflow missing

      const result = await checkRepoReadiness(mockOctokit as never, 'owner', 'repo', 'main');
      expect(result).toEqual({
        hasSetupWorkflow: true,
        hasAgentConfig: false,
        hasDeployWorkflow: false,
      });
    });

    it('should propagate non-404 errors', async () => {
      mockOctokit.repos.getContent.mockRejectedValue(new Error('Server Error'));

      await expect(
        checkRepoReadiness(mockOctokit as never, 'owner', 'repo', 'main')
      ).rejects.toThrow('Failed to check repo readiness');
    });
  });

  describe('getDefaultBranchSha', () => {
    it('should return the SHA of the branch HEAD', async () => {
      mockOctokit.git.getRef.mockResolvedValue({
        data: { object: { sha: 'abc123' } },
      });

      const result = await getDefaultBranchSha(mockOctokit as never, 'owner', 'repo', 'main');
      expect(result).toBe('abc123');
      expect(mockOctokit.git.getRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'heads/main',
      });
    });
  });

  describe('createBranch', () => {
    it('should create a branch from a SHA', async () => {
      mockOctokit.git.createRef.mockResolvedValue({ data: {} });

      await createBranch(mockOctokit as never, 'owner', 'repo', 'feature-branch', 'abc123');
      expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'refs/heads/feature-branch',
        sha: 'abc123',
      });
    });

    it('should throw on failure', async () => {
      mockOctokit.git.createRef.mockRejectedValue(new Error('Reference already exists'));

      await expect(
        createBranch(mockOctokit as never, 'owner', 'repo', 'feature-branch', 'abc123')
      ).rejects.toThrow('Failed to create branch feature-branch in owner/repo');
    });
  });

  describe('createOrUpdateFile', () => {
    it('should create a file with base64-encoded content', async () => {
      mockOctokit.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} });

      await createOrUpdateFile(
        mockOctokit as never,
        'owner',
        'repo',
        'test.md',
        'Hello World',
        'Add test file',
        'feature-branch'
      );

      expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        path: 'test.md',
        message: 'Add test file',
        content: btoa('Hello World'),
        branch: 'feature-branch',
      });
    });

    it('should handle non-ASCII content', async () => {
      mockOctokit.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} });

      const nonAsciiContent = 'Deploy — production • résumé';
      await createOrUpdateFile(
        mockOctokit as never,
        'owner',
        'repo',
        'test.md',
        nonAsciiContent,
        'Add file with unicode',
        'feature-branch'
      );

      // Verify base64 encoding of Unicode content via TextEncoder
      const bytes = new TextEncoder().encode(nonAsciiContent);
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      const expectedBase64 = btoa(binary);
      expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expectedBase64,
        })
      );
    });

    it('should include sha when updating an existing file', async () => {
      mockOctokit.repos.createOrUpdateFileContents.mockResolvedValue({ data: {} });

      await createOrUpdateFile(
        mockOctokit as never,
        'owner',
        'repo',
        'test.md',
        'Updated',
        'Update test file',
        'feature-branch',
        'existing-sha'
      );

      expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({ sha: 'existing-sha' })
      );
    });
  });

  describe('createPullRequest', () => {
    it('should create a PR and return number and URL', async () => {
      mockOctokit.pulls.create.mockResolvedValue({
        data: { number: 42, html_url: 'https://github.com/owner/repo/pull/42' },
      });

      const result = await createPullRequest(
        mockOctokit as never,
        'owner',
        'repo',
        'Setup PR',
        'Body',
        'feature-branch',
        'main'
      );

      expect(result).toEqual({
        number: 42,
        url: 'https://github.com/owner/repo/pull/42',
      });
    });
  });

  describe('getPullRequest', () => {
    it('should return PR merge status with mergeable and headSha', async () => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          merged: true,
          state: 'closed',
          html_url: 'https://github.com/owner/repo/pull/42',
          mergeable: true,
          head: { sha: 'abc123' },
        },
      });

      const result = await getPullRequest(mockOctokit as never, 'owner', 'repo', 42);
      expect(result).toEqual({
        merged: true,
        state: 'closed',
        url: 'https://github.com/owner/repo/pull/42',
        mergeable: true,
        headSha: 'abc123',
      });
    });

    it('should return null mergeable when not available', async () => {
      mockOctokit.pulls.get.mockResolvedValue({
        data: {
          merged: false,
          state: 'open',
          html_url: 'https://github.com/owner/repo/pull/42',
          mergeable: null,
          head: { sha: 'def456' },
        },
      });

      const result = await getPullRequest(mockOctokit as never, 'owner', 'repo', 42);
      expect(result.mergeable).toBeNull();
      expect(result.headSha).toBe('def456');
    });
  });

  describe('getStatusChecks', () => {
    it('should return status checks for a ref', async () => {
      mockOctokit.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { name: 'build', status: 'completed', conclusion: 'success' },
            { name: 'test', status: 'in_progress', conclusion: null },
          ],
        },
      });

      const result = await getStatusChecks(mockOctokit as never, 'owner', 'repo', 'abc123');
      expect(result).toEqual([
        { name: 'build', status: 'completed', conclusion: 'success' },
        { name: 'test', status: 'in_progress', conclusion: null },
      ]);
      expect(mockOctokit.checks.listForRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'abc123',
        per_page: 100,
      });
    });

    it('should throw on failure', async () => {
      mockOctokit.checks.listForRef.mockRejectedValue(new Error('Not Found'));

      await expect(
        getStatusChecks(mockOctokit as never, 'owner', 'repo', 'abc123')
      ).rejects.toThrow('Failed to get status checks for ref abc123 in owner/repo');
    });
  });

  describe('createIssue', () => {
    it('should create an issue with assignees', async () => {
      mockOctokit.issues.create.mockResolvedValue({
        data: { number: 10, html_url: 'https://github.com/owner/repo/issues/10' },
      });

      const result = await createIssue(
        mockOctokit as never,
        'owner',
        'repo',
        'Task title',
        'Task body',
        ['copilot']
      );

      expect(result).toEqual({
        number: 10,
        url: 'https://github.com/owner/repo/issues/10',
      });
      expect(mockOctokit.issues.create).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        title: 'Task title',
        body: 'Task body',
        assignees: ['copilot'],
      });
    });
  });

  describe('getIssue', () => {
    it('should return issue details', async () => {
      mockOctokit.issues.get.mockResolvedValue({
        data: {
          number: 5,
          state: 'open',
          html_url: 'https://github.com/owner/repo/issues/5',
        },
      });

      const result = await getIssue(mockOctokit as never, 'owner', 'repo', 5);
      expect(result).toEqual({
        number: 5,
        state: 'open',
        url: 'https://github.com/owner/repo/issues/5',
      });
    });

    it('should throw on failure', async () => {
      mockOctokit.issues.get.mockRejectedValue(new Error('Not Found'));

      await expect(getIssue(mockOctokit as never, 'owner', 'repo', 5)).rejects.toThrow(
        'Failed to get issue #5 in owner/repo: Not Found'
      );
    });
  });

  describe('findLinkedPullRequest', () => {
    it('should return the first cross-referenced PR with draft status', async () => {
      mockOctokit.request.mockResolvedValue({
        data: [
          {
            event: 'cross-referenced',
            source: {
              issue: {
                number: 42,
                html_url: 'https://github.com/owner/repo/pull/42',
                state: 'open',
                pull_request: { merged_at: null },
              },
            },
          },
        ],
      });
      mockOctokit.pulls.get.mockResolvedValue({ data: { draft: false } });

      const result = await findLinkedPullRequest(mockOctokit as never, 'owner', 'repo', 5);
      expect(result).toEqual({
        number: 42,
        url: 'https://github.com/owner/repo/pull/42',
        merged: false,
        draft: false,
        state: 'open',
      });
    });

    it('should return null when no linked PR exists', async () => {
      mockOctokit.request.mockResolvedValue({ data: [] });

      const result = await findLinkedPullRequest(mockOctokit as never, 'owner', 'repo', 5);
      expect(result).toBeNull();
    });

    it('should throw on failure', async () => {
      mockOctokit.request.mockRejectedValue(new Error('Not Found'));

      await expect(findLinkedPullRequest(mockOctokit as never, 'owner', 'repo', 5)).rejects.toThrow(
        'Failed to find linked PR for issue #5 in owner/repo: Not Found'
      );
    });
  });

  describe('listPullRequests', () => {
    it('should list PRs with user and merge info', async () => {
      mockOctokit.pulls.list.mockResolvedValue({
        data: [
          {
            number: 1,
            title: 'PR 1',
            html_url: 'https://github.com/owner/repo/pull/1',
            merged_at: '2024-01-01T00:00:00Z',
            user: { login: 'author' },
          },
          {
            number: 2,
            title: 'PR 2',
            html_url: 'https://github.com/owner/repo/pull/2',
            merged_at: null,
            user: { login: 'other' },
          },
        ],
      });

      const result = await listPullRequests(mockOctokit as never, 'owner', 'repo');
      expect(result).toEqual([
        {
          number: 1,
          title: 'PR 1',
          url: 'https://github.com/owner/repo/pull/1',
          merged: true,
          user: 'author',
        },
        {
          number: 2,
          title: 'PR 2',
          url: 'https://github.com/owner/repo/pull/2',
          merged: false,
          user: 'other',
        },
      ]);
    });
  });

  describe('listWorkflowRuns', () => {
    it('should list workflow runs with status', async () => {
      mockOctokit.actions.listWorkflowRunsForRepo.mockResolvedValue({
        data: {
          workflow_runs: [
            {
              id: 100,
              html_url: 'https://github.com/owner/repo/actions/runs/100',
              status: 'completed',
              conclusion: 'success',
              name: 'Deploy',
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const result = await listWorkflowRuns(mockOctokit as never, 'owner', 'repo');
      expect(result).toEqual([
        {
          id: 100,
          url: 'https://github.com/owner/repo/actions/runs/100',
          status: 'completed',
          conclusion: 'success',
          name: 'Deploy',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]);
    });

    it('throws wrapped error on failure', async () => {
      mockOctokit.actions.listWorkflowRunsForRepo.mockRejectedValue(new Error('API error'));
      await expect(
        listWorkflowRuns(mockOctokit as unknown as Octokit, 'owner', 'repo')
      ).rejects.toThrow('Failed to list workflow runs in owner/repo: API error');
    });
  });

  describe('getWorkflowRun', () => {
    it('should get a specific workflow run', async () => {
      mockOctokit.actions.getWorkflowRun.mockResolvedValue({
        data: {
          id: 100,
          html_url: 'https://github.com/owner/repo/actions/runs/100',
          status: 'in_progress',
          conclusion: null,
          name: 'Deploy',
        },
      });

      const result = await getWorkflowRun(mockOctokit as never, 'owner', 'repo', 100);
      expect(result).toEqual({
        id: 100,
        url: 'https://github.com/owner/repo/actions/runs/100',
        status: 'in_progress',
        conclusion: null,
        name: 'Deploy',
      });
    });

    it('throws wrapped error on failure', async () => {
      mockOctokit.actions.getWorkflowRun.mockRejectedValue(new Error('Not found'));
      await expect(
        getWorkflowRun(mockOctokit as unknown as Octokit, 'owner', 'repo', 123)
      ).rejects.toThrow('Failed to get workflow run 123 in owner/repo: Not found');
    });
  });

  describe('listUserRepos', () => {
    function mockPaginateIterator(pages: Array<Array<Record<string, unknown>>>) {
      mockOctokit.paginate.iterator.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          for (const data of pages) {
            yield { data };
          }
        },
      });
    }

    it('should list repos with defaults', async () => {
      mockPaginateIterator([
        [
          {
            owner: { login: 'testuser', id: 1 },
            name: 'my-repo',
            full_name: 'testuser/my-repo',
            default_branch: 'main',
            id: 100,
          },
        ],
      ]);

      const result = await listUserRepos(mockOctokit as never);
      expect(result).toEqual([
        {
          owner: 'testuser',
          name: 'my-repo',
          fullName: 'testuser/my-repo',
          defaultBranch: 'main',
        },
      ]);
      expect(mockOctokit.paginate.iterator).toHaveBeenCalledWith(
        mockOctokit.repos.listForAuthenticatedUser,
        { sort: 'pushed', per_page: 100, type: 'all' }
      );
    });

    it('should pass custom options', async () => {
      mockPaginateIterator([[]]);

      await listUserRepos(mockOctokit as never, { sort: 'full_name', per_page: 100 });
      expect(mockOctokit.paginate.iterator).toHaveBeenCalledWith(
        mockOctokit.repos.listForAuthenticatedUser,
        { sort: 'full_name', per_page: 100, type: 'all' }
      );
    });

    it('should call onPage with accumulated repos after each page', async () => {
      mockPaginateIterator([
        [{ owner: { login: 'a' }, name: 'r1', full_name: 'a/r1', default_branch: 'main', id: 1 }],
        [{ owner: { login: 'b' }, name: 'r2', full_name: 'b/r2', default_branch: 'dev', id: 2 }],
      ]);

      const pageLengths: number[] = [];
      const onPage = vi.fn((repos: unknown[]) => pageLengths.push(repos.length));
      const result = await listUserRepos(mockOctokit as never, { onPage });

      expect(onPage).toHaveBeenCalledTimes(2);
      expect(pageLengths).toEqual([1, 2]);
      expect(result).toHaveLength(2);
    });
  });

  describe('checkAppInstallation', () => {
    it('should return installed: true when repo is found in installation', async () => {
      mockOctokit.apps.listInstallationsForAuthenticatedUser.mockResolvedValue({
        data: {
          installations: [{ id: 1, account: { login: 'owner' }, app_slug: 'aks-desktop-preview' }],
        },
      });
      mockOctokit.paginate.mockResolvedValue([{ full_name: 'owner/repo' }]);

      const result = await checkAppInstallation(mockOctokit as never, 'owner', 'repo');
      expect(result).toEqual({ installed: true, installUrl: null });
    });

    it('should return installed: false with install URL when repo is not found', async () => {
      mockOctokit.apps.listInstallationsForAuthenticatedUser.mockResolvedValue({
        data: {
          installations: [{ id: 1, account: { login: 'owner' }, app_slug: 'my-app' }],
        },
      });
      mockOctokit.paginate.mockResolvedValue([{ full_name: 'owner/other-repo' }]);

      const result = await checkAppInstallation(mockOctokit as never, 'owner', 'repo');
      expect(result).toEqual({
        installed: false,
        installUrl: 'https://github.com/apps/aks-desktop-preview/installations/new',
      });
    });

    it('should skip installations for other owners', async () => {
      mockOctokit.apps.listInstallationsForAuthenticatedUser.mockResolvedValue({
        data: {
          installations: [{ id: 1, account: { login: 'other-org' }, app_slug: 'my-app' }],
        },
      });

      const result = await checkAppInstallation(mockOctokit as never, 'owner', 'repo');
      expect(result.installed).toBe(false);
      expect(mockOctokit.paginate).not.toHaveBeenCalled();
    });

    it('should skip installations with 403/404 errors', async () => {
      mockOctokit.apps.listInstallationsForAuthenticatedUser.mockResolvedValue({
        data: {
          installations: [{ id: 1, account: { login: 'owner' }, app_slug: 'my-app' }],
        },
      });
      const forbiddenError = new Error('Forbidden');
      Object.assign(forbiddenError, { status: 403 });
      mockOctokit.paginate.mockRejectedValue(forbiddenError);

      const result = await checkAppInstallation(mockOctokit as never, 'owner', 'repo');
      expect(result.installed).toBe(false);
    });

    it('should throw on unexpected errors', async () => {
      mockOctokit.apps.listInstallationsForAuthenticatedUser.mockRejectedValue(
        new Error('Server Error')
      );

      await expect(checkAppInstallation(mockOctokit as never, 'owner', 'repo')).rejects.toThrow(
        'Failed to check app installation for owner/repo'
      );
    });

    it('returns not installed when no installations exist', async () => {
      mockOctokit.apps.listInstallationsForAuthenticatedUser.mockResolvedValue({
        data: { installations: [] },
      });
      const result = await checkAppInstallation(mockOctokit as unknown as Octokit, 'owner', 'repo');
      expect(result.installed).toBe(false);
      expect(result.installUrl).toBeTruthy();
    });
  });

  describe('assignIssueToCopilot', () => {
    it('should assign copilot agent to an issue', async () => {
      mockOctokit.request.mockResolvedValue({ data: {} });

      await assignIssueToCopilot(mockOctokit as never, 'owner', 'repo', 10, 'main');

      expect(mockOctokit.request).toHaveBeenCalledWith(
        'POST /repos/{owner}/{repo}/issues/{issue_number}/assignees',
        {
          owner: 'owner',
          repo: 'repo',
          issue_number: 10,
          assignees: ['copilot-swe-agent[bot]'],
          agent_assignment: {
            target_repo: 'owner/repo',
            base_branch: 'main',
          },
        }
      );
    });

    it('should throw on failure', async () => {
      mockOctokit.request.mockRejectedValue(new Error('Not Found'));

      await expect(
        assignIssueToCopilot(mockOctokit as never, 'owner', 'repo', 10, 'main')
      ).rejects.toThrow('Failed to assign Copilot agent to issue #10 in owner/repo');
    });
  });

  describe('dispatchWorkflow', () => {
    it('should dispatch a workflow run', async () => {
      mockOctokit.actions.createWorkflowDispatch.mockResolvedValue({ data: {} });

      await dispatchWorkflow(mockOctokit as never, 'owner', 'repo', 'deploy.yml', 'main');

      expect(mockOctokit.actions.createWorkflowDispatch).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        workflow_id: 'deploy.yml',
        ref: 'main',
      });
    });

    it('should throw on failure', async () => {
      mockOctokit.actions.createWorkflowDispatch.mockRejectedValue(new Error('Not Found'));

      await expect(
        dispatchWorkflow(mockOctokit as never, 'owner', 'repo', 'deploy.yml', 'main')
      ).rejects.toThrow('Failed to dispatch workflow deploy.yml in owner/repo');
    });

    it('throws wrapped error on failure with cause', async () => {
      mockOctokit.actions.createWorkflowDispatch.mockRejectedValue(new Error('Forbidden'));
      await expect(
        dispatchWorkflow(mockOctokit as unknown as Octokit, 'owner', 'repo', 'deploy.yml', 'main')
      ).rejects.toThrow('Failed to dispatch workflow deploy.yml in owner/repo: Forbidden');
    });
  });

  describe('listWorkflowRuns with workflowFileName', () => {
    it('should use listWorkflowRuns when workflowFileName is provided', async () => {
      mockOctokit.actions.listWorkflowRuns.mockResolvedValue({
        data: {
          workflow_runs: [
            {
              id: 200,
              html_url: 'https://github.com/owner/repo/actions/runs/200',
              status: 'completed',
              conclusion: 'success',
              name: 'Deploy',
              created_at: '2024-01-02T00:00:00Z',
            },
          ],
        },
      });

      const result = await listWorkflowRuns(mockOctokit as never, 'owner', 'repo', {
        workflowFileName: PIPELINE_WORKFLOW_FILENAME,
      });

      expect(result).toEqual([
        {
          id: 200,
          url: 'https://github.com/owner/repo/actions/runs/200',
          status: 'completed',
          conclusion: 'success',
          name: 'Deploy',
          createdAt: '2024-01-02T00:00:00Z',
        },
      ]);
      expect(mockOctokit.actions.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ workflow_id: PIPELINE_WORKFLOW_FILENAME })
      );
    });
  });

  describe('listWorkflowRunJobs', () => {
    it('should return jobs with steps', async () => {
      mockOctokit.actions.listJobsForWorkflowRun.mockResolvedValue({
        data: {
          jobs: [
            {
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              steps: [
                { name: 'Checkout', status: 'completed', conclusion: 'success', number: 1 },
                { name: 'Build', status: 'completed', conclusion: 'success', number: 2 },
              ],
            },
          ],
        },
      });

      const result = await listWorkflowRunJobs(mockOctokit as never, 'owner', 'repo', 123);
      expect(result).toEqual([
        {
          name: 'build',
          status: 'completed',
          conclusion: 'success',
          steps: [
            {
              name: 'Checkout',
              status: 'completed',
              conclusion: 'success',
              number: 1,
              started_at: null,
            },
            {
              name: 'Build',
              status: 'completed',
              conclusion: 'success',
              number: 2,
              started_at: null,
            },
          ],
        },
      ]);
    });

    it('should handle jobs with no steps', async () => {
      mockOctokit.actions.listJobsForWorkflowRun.mockResolvedValue({
        data: {
          jobs: [{ name: 'deploy', status: 'queued', conclusion: null, steps: undefined }],
        },
      });

      const result = await listWorkflowRunJobs(mockOctokit as never, 'owner', 'repo', 456);
      expect(result).toEqual([{ name: 'deploy', status: 'queued', conclusion: null, steps: [] }]);
    });

    it('should throw on failure', async () => {
      mockOctokit.actions.listJobsForWorkflowRun.mockRejectedValue(new Error('Not Found'));
      await expect(listWorkflowRunJobs(mockOctokit as never, 'owner', 'repo', 789)).rejects.toThrow(
        'Failed to list jobs'
      );
    });
  });

  describe('getRepoPublicKey', () => {
    it('should return the public key and key ID', async () => {
      mockOctokit.actions.getRepoPublicKey.mockResolvedValue({
        data: { key: 'base64-public-key', key_id: 'key-id-123' },
      });

      const result = await getRepoPublicKey(mockOctokit as unknown as Octokit, 'owner', 'repo');
      expect(result).toEqual({ key: 'base64-public-key', keyId: 'key-id-123' });
      expect(mockOctokit.actions.getRepoPublicKey).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('should throw on failure', async () => {
      mockOctokit.actions.getRepoPublicKey.mockRejectedValue(new Error('Not Found'));

      await expect(
        getRepoPublicKey(mockOctokit as unknown as Octokit, 'owner', 'repo')
      ).rejects.toThrow('Failed to get repo public key for owner/repo: Not Found');
    });
  });

  describe('createOrUpdateRepoSecret', () => {
    const publicKey = { key: 'base64-public-key', keyId: 'key-id-123' };

    beforeEach(() => {
      mockSodiumFns.from_base64.mockReturnValue(new Uint8Array([1, 2, 3]));
      mockSodiumFns.from_string.mockReturnValue(new Uint8Array([4, 5, 6]));
      mockSodiumFns.crypto_box_seal.mockReturnValue(new Uint8Array([7, 8, 9]));
      mockSodiumFns.to_base64.mockReturnValue('encrypted-base64');
    });

    it('should encrypt plaintext and create the secret', async () => {
      mockOctokit.actions.createOrUpdateRepoSecret.mockResolvedValue({ data: {} });

      await createOrUpdateRepoSecret(
        mockOctokit as unknown as Octokit,
        'owner',
        'repo',
        'MY_SECRET',
        'secret-value',
        publicKey
      );

      expect(mockSodiumFns.from_base64).toHaveBeenCalledWith('base64-public-key', 0);
      expect(mockSodiumFns.from_string).toHaveBeenCalledWith('secret-value');
      expect(mockSodiumFns.crypto_box_seal).toHaveBeenCalled();
      expect(mockOctokit.actions.createOrUpdateRepoSecret).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        secret_name: 'MY_SECRET',
        encrypted_value: 'encrypted-base64',
        key_id: 'key-id-123',
      });
    });

    it('should propagate errors from libsodium', async () => {
      mockSodiumFns.from_base64.mockImplementationOnce(() => {
        throw new Error('Invalid base64');
      });

      await expect(
        createOrUpdateRepoSecret(
          mockOctokit as unknown as Octokit,
          'owner',
          'repo',
          'MY_SECRET',
          'secret-value',
          publicKey
        )
      ).rejects.toThrow('Failed to create/update secret MY_SECRET in owner/repo: Invalid base64');
    });

    it('should propagate errors from Octokit', async () => {
      mockOctokit.actions.createOrUpdateRepoSecret.mockRejectedValue(new Error('Forbidden'));

      await expect(
        createOrUpdateRepoSecret(
          mockOctokit as unknown as Octokit,
          'owner',
          'repo',
          'MY_SECRET',
          'secret-value',
          publicKey
        )
      ).rejects.toThrow('Failed to create/update secret MY_SECRET in owner/repo: Forbidden');
    });
  });

  describe('setRepoSecrets', () => {
    it('should skip entirely when all secrets are empty', async () => {
      await setRepoSecrets(mockOctokit as unknown as Octokit, 'owner', 'repo', {
        EMPTY: '',
        WHITESPACE: '  ',
      });

      expect(mockOctokit.actions.getRepoPublicKey).not.toHaveBeenCalled();
    });

    it('should fetch public key when there are non-empty secrets', async () => {
      mockSodiumFns.from_base64.mockReturnValue(new Uint8Array([1, 2, 3]));
      mockSodiumFns.from_string.mockReturnValue(new Uint8Array([4, 5, 6]));
      mockSodiumFns.crypto_box_seal.mockReturnValue(new Uint8Array([7, 8, 9]));
      mockSodiumFns.to_base64.mockReturnValue('encrypted-base64');

      mockOctokit.actions.getRepoPublicKey.mockResolvedValue({
        data: { key: 'base64-public-key', key_id: 'key-id-123' },
      });
      mockOctokit.actions.createOrUpdateRepoSecret.mockResolvedValue({ data: {} });

      await setRepoSecrets(mockOctokit as unknown as Octokit, 'owner', 'repo', {
        SECRET_A: 'value-a',
        SECRET_B: '',
      });

      expect(mockOctokit.actions.getRepoPublicKey).toHaveBeenCalledTimes(1);
      expect(mockOctokit.actions.getRepoPublicKey).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });
    });

    it('should propagate errors from getRepoPublicKey', async () => {
      mockOctokit.actions.getRepoPublicKey.mockRejectedValue(new Error('Not Found'));

      await expect(
        setRepoSecrets(mockOctokit as unknown as Octokit, 'owner', 'repo', {
          SECRET: 'value',
        })
      ).rejects.toThrow('Failed to get repo public key');
    });
  });
});
