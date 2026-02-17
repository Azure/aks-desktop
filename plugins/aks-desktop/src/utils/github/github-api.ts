// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import type { RepoReadiness, WorkflowRunConclusion, WorkflowRunStatus } from '../../types/github';
import { GITHUB_APP_INSTALL_URL } from './github-auth';

/**
 * Wraps an unknown error with context, preserving the original via `Error.cause`.
 */
function apiError(context: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const wrapped = new Error(`${context}: ${message}`);
  (wrapped as { cause?: unknown }).cause = error;
  return wrapped;
}

/**
 * Encodes a Unicode string as base64 using TextEncoder.
 * Replaces the deprecated `btoa(unescape(encodeURIComponent(str)))` pattern.
 */
function unicodeToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isHttpError(error: unknown, status: number): boolean {
  return (
    error instanceof Error && 'status' in error && (error as { status: number }).status === status
  );
}

export const createOctokitClient = (token: string): Octokit => {
  return new Octokit({ auth: token });
};

export const getCurrentUser = async (
  octokit: Octokit
): Promise<{ login: string; avatarUrl: string }> => {
  try {
    const { data } = await octokit.users.getAuthenticated();
    return { login: data.login, avatarUrl: data.avatar_url };
  } catch (error) {
    throw apiError('Failed to get current user', error);
  }
};

export const getRepo = async (
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ defaultBranch: string; fullName: string }> => {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return { defaultBranch: data.default_branch, fullName: data.full_name };
  } catch (error) {
    throw apiError(`Failed to get repo ${owner}/${repo}`, error);
  }
};

/**
 * Checks if a file exists at a given path on a specific branch.
 * Returns true if the file exists, false if it returns 404.
 */
const fileExists = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<boolean> => {
  try {
    await octokit.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });
    return true;
  } catch (error) {
    if (isHttpError(error, 404)) {
      return false;
    }
    throw error;
  }
};

/**
 * Checks repo readiness for the Copilot agent (Step B).
 * Verifies setup workflow and agent config exist on the default branch.
 * Note: There is no reliable public API to detect Copilot Coding Agent
 * enablement. The `copilot` assignee is a special handle that only works
 * during issue creation, not via the assignees endpoint. We skip the check
 * and let issue creation surface any errors.
 */
export const checkRepoReadiness = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  defaultBranch?: string
): Promise<RepoReadiness> => {
  try {
    const [hasSetupWorkflow, hasAgentConfig] = await Promise.all([
      fileExists(octokit, owner, repo, '.github/workflows/copilot-setup-steps.yml', defaultBranch),
      fileExists(octokit, owner, repo, '.github/agents/containerization.agent.md', defaultBranch),
    ]);

    return { hasSetupWorkflow, hasAgentConfig };
  } catch (error) {
    throw apiError(`Failed to check repo readiness for ${owner}/${repo}`, error);
  }
};

/**
 * Checks if the GitHub App is installed on a specific repo.
 * Uses GET /user/installations (scoped to the issuing app for user-to-server tokens)
 * then checks accessible repos for each installation.
 *
 * Returns { installed, installUrl } where installUrl is the app installation page
 * (returned when not installed).
 */
export const checkAppInstallation = async (
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ installed: boolean; installUrl: string | null }> => {
  try {
    const { data } = await octokit.apps.listInstallationsForAuthenticatedUser();

    for (const installation of data.installations) {
      // Skip installations for other accounts — only check those matching the target owner
      if (
        installation.account &&
        'login' in installation.account &&
        installation.account.login !== owner
      ) {
        continue;
      }
      try {
        const repos = await octokit.paginate(
          octokit.apps.listInstallationReposForAuthenticatedUser,
          { installation_id: installation.id, per_page: 100 },
          response => response.data
        );
        if (repos.some(r => r.full_name === `${owner}/${repo}`)) {
          return { installed: true, installUrl: null };
        }
      } catch (err) {
        // Skip if we don't have permission to enumerate repos for this installation (403/404),
        // but rethrow unexpected errors (rate limiting, server errors).
        if (isHttpError(err, 403) || isHttpError(err, 404)) {
          continue;
        }
        throw err;
      }
    }

    return { installed: false, installUrl: GITHUB_APP_INSTALL_URL };
  } catch (error) {
    throw apiError(`Failed to check app installation for ${owner}/${repo}`, error);
  }
};

export const getDefaultBranchSha = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<string> => {
  try {
    const { data } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return data.object.sha;
  } catch (error) {
    throw apiError(`Failed to get SHA for ${owner}/${repo}#${branch}`, error);
  }
};

export const createBranch = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  sha: string
): Promise<void> => {
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });
  } catch (error) {
    throw apiError(`Failed to create branch ${branchName} in ${owner}/${repo}`, error);
  }
};

/**
 * Creates or updates a file in a repository.
 * If `sha` is provided, the file is updated (required for existing files).
 */
export const createOrUpdateFile = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<void> => {
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      // GitHub's Contents API requires base64-encoded content.
      content: unicodeToBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    });
  } catch (error) {
    throw apiError(`Failed to create/update file ${path} in ${owner}/${repo}`, error);
  }
};

export const createPullRequest = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<{ number: number; url: string }> => {
  try {
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });
    return { number: data.number, url: data.html_url };
  } catch (error) {
    throw apiError(`Failed to create PR in ${owner}/${repo}`, error);
  }
};

export const getPullRequest = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{
  merged: boolean;
  state: string;
  url: string;
  mergeable: boolean | null;
  headSha: string;
}> => {
  try {
    const { data } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    return {
      merged: data.merged,
      state: data.state,
      url: data.html_url,
      mergeable: data.mergeable ?? null,
      headSha: data.head.sha,
    };
  } catch (error) {
    throw apiError(`Failed to get PR #${prNumber} in ${owner}/${repo}`, error);
  }
};

export const getStatusChecks = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<Array<{ name: string; status: string; conclusion: string | null }>> => {
  try {
    const { data } = await octokit.checks.listForRef({
      owner,
      repo,
      ref,
      per_page: 100,
    });

    return data.check_runs.map(run => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? null,
    }));
  } catch (error) {
    throw apiError(`Failed to get status checks for ref ${ref} in ${owner}/${repo}`, error);
  }
};

/**
 * Creates an issue (used for agent task trigger in Step D).
 */
export const createIssue = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  assignees: string[]
): Promise<{ number: number; url: string }> => {
  try {
    const { data } = await octokit.issues.create({
      owner,
      repo,
      title,
      body,
      assignees,
    });
    return { number: data.number, url: data.html_url };
  } catch (error) {
    throw apiError(`Failed to create issue in ${owner}/${repo}`, error);
  }
};

/**
 * Assigns the Copilot Coding Agent to an existing issue.
 * Uses the `copilot-swe-agent[bot]` handle and the `agent_assignment` field
 * which specifies the target repo and base branch for the agent.
 *
 * @see https://docs.github.com/copilot/using-github-copilot/coding-agent/asking-copilot-to-create-a-pull-request
 */
export const assignIssueToCopilot = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  baseBranch: string
): Promise<void> => {
  try {
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/assignees', {
      owner,
      repo,
      issue_number: issueNumber,
      assignees: ['copilot-swe-agent[bot]'],
      agent_assignment: {
        target_repo: `${owner}/${repo}`,
        base_branch: baseBranch,
      },
    });
  } catch (error) {
    throw apiError(
      `Failed to assign Copilot agent to issue #${issueNumber} in ${owner}/${repo}`,
      error
    );
  }
};

export const listPullRequests = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  options?: {
    state?: 'open' | 'closed' | 'all';
    head?: string;
    base?: string;
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: 'asc' | 'desc';
    per_page?: number;
  }
): Promise<
  Array<{ number: number; title: string; url: string; merged: boolean; user: string }>
> => {
  try {
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: options?.state ?? 'open',
      ...(options?.head ? { head: options.head } : {}),
      ...(options?.base ? { base: options.base } : {}),
      ...(options?.sort ? { sort: options.sort } : {}),
      ...(options?.direction ? { direction: options.direction } : {}),
      ...(options?.per_page ? { per_page: options.per_page } : {}),
    });
    return data.map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      merged: pr.merged_at !== null,
      user: pr.user?.login ?? '',
    }));
  } catch (error) {
    throw apiError(`Failed to list PRs in ${owner}/${repo}`, error);
  }
};

export const listWorkflowRuns = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  options?: {
    branch?: string;
    event?: string;
    status?: WorkflowRunStatus;
    per_page?: number;
    /** Workflow file name (e.g. 'deploy-to-aks.yml') to filter runs. */
    workflowFileName?: string;
  }
): Promise<
  Array<{
    id: number;
    url: string;
    status: WorkflowRunStatus | null;
    conclusion: WorkflowRunConclusion;
    name: string;
  }>
> => {
  try {
    const commonParams = {
      owner,
      repo,
      ...(options?.branch ? { branch: options.branch } : {}),
      ...(options?.event ? { event: options.event } : {}),
      ...(options?.status ? { status: options.status } : {}),
      per_page: options?.per_page ?? 10,
    };
    const { data } = options?.workflowFileName
      ? await octokit.actions.listWorkflowRuns({
          ...commonParams,
          workflow_id: options.workflowFileName,
        })
      : await octokit.actions.listWorkflowRunsForRepo(commonParams);
    return data.workflow_runs.map(run => ({
      id: run.id,
      url: run.html_url,
      status: run.status as WorkflowRunStatus | null,
      conclusion: run.conclusion as WorkflowRunConclusion,
      name: run.name ?? '',
    }));
  } catch (error) {
    throw apiError(`Failed to list workflow runs in ${owner}/${repo}`, error);
  }
};

export const getWorkflowRun = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number
): Promise<{
  id: number;
  url: string;
  status: WorkflowRunStatus | null;
  conclusion: WorkflowRunConclusion;
  name: string;
}> => {
  try {
    const { data } = await octokit.actions.getWorkflowRun({
      owner,
      repo,
      run_id: runId,
    });
    return {
      id: data.id,
      url: data.html_url,
      status: data.status as WorkflowRunStatus | null,
      conclusion: data.conclusion as WorkflowRunConclusion,
      name: data.name ?? '',
    };
  } catch (error) {
    throw apiError(`Failed to get workflow run ${runId} in ${owner}/${repo}`, error);
  }
};

/**
 * Dispatches a workflow run via the workflow_dispatch event.
 * Used for the "Redeploy" action.
 */
export const dispatchWorkflow = async (
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  ref: string
): Promise<void> => {
  try {
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref,
    });
  } catch (error) {
    throw apiError(`Failed to dispatch workflow ${workflowId} in ${owner}/${repo}`, error);
  }
};

export const listUserRepos = async (
  octokit: Octokit,
  options?: { sort?: 'created' | 'updated' | 'pushed' | 'full_name'; per_page?: number }
): Promise<
  Array<{
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
  }>
> => {
  try {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: options?.sort ?? 'pushed',
      per_page: options?.per_page ?? 30,
      type: 'all',
    });
    return data.map(repo => ({
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
    }));
  } catch (error) {
    throw apiError('Failed to list user repos', error);
  }
};
