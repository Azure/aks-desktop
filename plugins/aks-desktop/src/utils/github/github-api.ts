// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import {
  AGENT_CONFIG_PATH,
  COPILOT_SETUP_STEPS_PATH,
  PIPELINE_WORKFLOW_FILENAME,
} from '../../components/GitHubPipeline/constants';
import type {
  GitHubRunConclusion,
  GitHubRunStatus,
  RepoReadiness,
  WorkflowRunConclusion,
  WorkflowRunStatus,
} from '../../types/github';
import { GITHUB_APP_INSTALL_URL } from './github-auth';

type ErrorWithCause = Error & { cause?: unknown };

/**
 * Wraps an unknown error with context, preserving the original via `Error.cause`.
 */
function apiError(context: string, error: unknown): ErrorWithCause {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const wrapped = new Error(`${context}: ${message}`) as ErrorWithCause;
  wrapped.cause = error;
  return wrapped;
}

/**
 * Encodes a Unicode string as base64 using TextEncoder.
 * Replaces the deprecated `btoa(unescape(encodeURIComponent(str)))` pattern.
 */
function unicodeToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binary);
}

function isHttpError(error: unknown, status: number): boolean {
  return (
    error instanceof Error && 'status' in error && (error as { status: number }).status === status
  );
}

/** Creates an authenticated Octokit REST client for GitHub API calls. */
export function createOctokitClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

/** Fetches the authenticated user's login and avatar URL. */
export async function getCurrentUser(
  octokit: Octokit
): Promise<{ login: string; avatarUrl: string }> {
  try {
    const { data } = await octokit.users.getAuthenticated();
    return { login: data.login, avatarUrl: data.avatar_url };
  } catch (error) {
    throw apiError('Failed to get current user', error);
  }
}

/** Fetches a repository's default branch name and full name. */
export async function getRepo(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ defaultBranch: string; fullName: string }> {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return { defaultBranch: data.default_branch, fullName: data.full_name };
  } catch (error) {
    throw apiError(`Failed to get repo ${owner}/${repo}`, error);
  }
}

/**
 * Checks if a file exists at a given path on a specific branch.
 * Returns true if the file exists, false if it returns 404.
 */
async function fileExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<boolean> {
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
}

/**
 * Checks repo readiness for the Copilot agent (Step B).
 * Verifies setup workflow and agent config exist on the default branch.
 * Note: There is no reliable public API to detect Copilot Coding Agent
 * enablement. The `copilot` assignee is a special handle that only works
 * during issue creation, not via the assignees endpoint. We skip the check
 * and let issue creation surface any errors.
 */
export async function checkRepoReadiness(
  octokit: Octokit,
  owner: string,
  repo: string,
  defaultBranch?: string
): Promise<RepoReadiness> {
  try {
    const [hasSetupWorkflow, hasAgentConfig, hasDeployWorkflow] = await Promise.all([
      fileExists(octokit, owner, repo, COPILOT_SETUP_STEPS_PATH, defaultBranch),
      fileExists(octokit, owner, repo, AGENT_CONFIG_PATH, defaultBranch),
      fileExists(
        octokit,
        owner,
        repo,
        `.github/workflows/${PIPELINE_WORKFLOW_FILENAME}`,
        defaultBranch
      ),
    ]);

    return { hasSetupWorkflow, hasAgentConfig, hasDeployWorkflow };
  } catch (error) {
    throw apiError(`Failed to check repo readiness for ${owner}/${repo}`, error);
  }
}

/**
 * Checks if the GitHub App is installed on a specific repo.
 * Uses GET /user/installations (scoped to the issuing app for user-to-server tokens)
 * then checks accessible repos for each installation.
 *
 * Returns { installed, installUrl } where installUrl is the app installation page
 * (returned when not installed).
 */
export async function checkAppInstallation(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ installed: boolean; installUrl: string | null }> {
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
          response => {
            const data = response.data;
            // Octokit's paginate types flatten `.data`, but the runtime response
            // nests repos under `.data.repositories`. Check the real shape.
            if (data && typeof data === 'object' && 'repositories' in data) {
              return (data as { repositories: typeof data }).repositories;
            }
            return data;
          }
        );
        if (Array.isArray(repos) && repos.some(r => r?.full_name === `${owner}/${repo}`)) {
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
}

/** Returns the SHA of the tip commit on the given branch. */
export async function getDefaultBranchSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
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
}

/** Creates a new branch in the repository from the given SHA. */
export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  sha: string
): Promise<void> {
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
}

/**
 * Creates or updates a file in a repository.
 * If `sha` is provided, the file is updated (required for existing files).
 */
export async function createOrUpdateFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<void> {
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
}

/** Creates a pull request and returns its number and URL. */
export async function createPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<{ number: number; url: string }> {
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
}

/** Fetches a pull request's merge status, state, URL, mergeability, and head SHA. */
export async function getPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{
  merged: boolean;
  state: 'open' | 'closed';
  url: string;
  mergeable: boolean | null;
  headSha: string;
}> {
  try {
    const { data } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    return {
      merged: data.merged,
      state: data.state as 'open' | 'closed',
      url: data.html_url,
      mergeable: data.mergeable ?? null,
      headSha: data.head.sha,
    };
  } catch (error) {
    throw apiError(`Failed to get PR #${prNumber} in ${owner}/${repo}`, error);
  }
}

/** Lists check runs (status checks) for a given git ref. */
export async function getStatusChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<Array<{ name: string; status: GitHubRunStatus; conclusion: GitHubRunConclusion }>> {
  try {
    const { data } = await octokit.checks.listForRef({
      owner,
      repo,
      ref,
      per_page: 100,
    });

    return data.check_runs.map(run => ({
      name: run.name,
      status: run.status as GitHubRunStatus,
      conclusion: (run.conclusion ?? null) as GitHubRunConclusion,
    }));
  } catch (error) {
    throw apiError(`Failed to get status checks for ref ${ref} in ${owner}/${repo}`, error);
  }
}

/**
 * Fetches the repository's Actions public key (used to encrypt secrets).
 * @see https://docs.github.com/en/rest/actions/secrets#get-a-repository-public-key
 */
export async function getRepoPublicKey(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ key: string; keyId: string }> {
  try {
    const { data } = await octokit.actions.getRepoPublicKey({ owner, repo });
    return { key: data.key, keyId: data.key_id };
  } catch (error) {
    throw apiError(`Failed to get repo public key for ${owner}/${repo}`, error);
  }
}

/**
 * Creates or updates a single GitHub Actions repository secret.
 * The value is encrypted client-side using the repo's public key
 * via libsodium sealed box (crypto_box_seal).
 */
export async function createOrUpdateRepoSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  secretName: string,
  plaintext: string,
  publicKey: { key: string; keyId: string }
): Promise<void> {
  try {
    // Dynamic import to avoid loading libsodium until needed.
    // The default export holds the actual API; the namespace object does not.
    const sodiumModule = await import('libsodium-wrappers');
    const sodium = sodiumModule.default ?? sodiumModule;
    await sodium.ready;

    const keyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    const messageBytes = sodium.from_string(plaintext);
    const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
    const encryptedBase64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

    await octokit.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value: encryptedBase64,
      key_id: publicKey.keyId,
    });
  } catch (error) {
    throw apiError(`Failed to create/update secret ${secretName} in ${owner}/${repo}`, error);
  }
}

/**
 * Creates or updates multiple GitHub Actions repository secrets in batch.
 * Fetches the public key once and encrypts all values with it.
 */
export async function setRepoSecrets(
  octokit: Octokit,
  owner: string,
  repo: string,
  secrets: Record<string, string>
): Promise<void> {
  const entries = Object.entries(secrets).filter(([, value]) => value.trim());
  if (entries.length === 0) return;

  const publicKey = await getRepoPublicKey(octokit, owner, repo);
  await Promise.all(
    entries.map(([name, value]) =>
      createOrUpdateRepoSecret(octokit, owner, repo, name, value, publicKey)
    )
  );
}

/** Creates an issue (used for agent task trigger in Step D). */
export async function createIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  assignees: string[]
): Promise<{ number: number; url: string }> {
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
}

/**
 * Assigns the Copilot Coding Agent to an existing issue.
 * Uses the `copilot-swe-agent[bot]` handle and the `agent_assignment` field
 * which specifies the target repo and base branch for the agent.
 *
 * @see https://docs.github.com/copilot/using-github-copilot/coding-agent/asking-copilot-to-create-a-pull-request
 */
export async function assignIssueToCopilot(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  baseBranch: string
): Promise<void> {
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
}

/** Fetches an issue's current state by number. */
export async function getIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{ number: number; state: 'open' | 'closed'; url: string }> {
  try {
    const { data } = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return { number: data.number, state: data.state as 'open' | 'closed', url: data.html_url };
  } catch (error) {
    throw apiError(`Failed to get issue #${issueNumber} in ${owner}/${repo}`, error);
  }
}

/** Shape of a cross-reference event from the issue timeline API. */
interface TimelineCrossReference {
  event: 'cross-referenced';
  source: {
    issue: {
      number: number;
      html_url: string;
      state: 'open' | 'closed';
      pull_request?: { merged_at: string | null };
    };
  };
}

function isTimelineCrossReference(event: unknown): event is TimelineCrossReference {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as Record<string, unknown>;
  if (e.event !== 'cross-referenced') return false;
  const source = e.source as Record<string, unknown> | undefined;
  const issue = source?.issue as Record<string, unknown> | undefined;
  return (
    typeof issue?.number === 'number' &&
    typeof issue?.html_url === 'string' &&
    typeof issue?.state === 'string' &&
    issue?.pull_request !== undefined
  );
}

/**
 * Finds a pull request linked to a specific issue via the timeline API.
 * Returns the first cross-referenced PR (the agent's PR referencing the trigger issue).
 */
export async function findLinkedPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{
  number: number;
  url: string;
  merged: boolean;
  draft: boolean;
  state: 'open' | 'closed';
} | null> {
  try {
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/issues/{issue_number}/timeline',
      {
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      }
    );

    for (const event of data) {
      if (isTimelineCrossReference(event)) {
        const { issue } = event.source;
        // The timeline cross-reference doesn't include draft status,
        // so fetch the PR details to check.
        const { data: pr } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: issue.number,
        });
        return {
          number: issue.number,
          url: issue.html_url,
          merged: !!issue.pull_request?.merged_at,
          draft: pr.draft ?? false,
          state: issue.state,
        };
      }
    }

    return null;
  } catch (error) {
    throw apiError(`Failed to find linked PR for issue #${issueNumber} in ${owner}/${repo}`, error);
  }
}

/** Lists pull requests for a repository with optional filtering and sorting. */
export async function listPullRequests(
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
): Promise<Array<{ number: number; title: string; url: string; merged: boolean; user: string }>> {
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
      merged: !!pr.merged_at,
      user: pr.user?.login ?? '',
    }));
  } catch (error) {
    throw apiError(`Failed to list PRs in ${owner}/${repo}`, error);
  }
}

/** Lists recent workflow runs for a repository, optionally filtered by workflow file name. */
export async function listWorkflowRuns(
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
    createdAt: string;
  }>
> {
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
      createdAt: run.created_at,
    }));
  } catch (error) {
    throw apiError(`Failed to list workflow runs in ${owner}/${repo}`, error);
  }
}

/** Fetches a specific workflow run by ID. */
export async function getWorkflowRun(
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
}> {
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
}

/** Step-level status for a workflow run job. */
export interface WorkflowJobStep {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  number: number;
  started_at: string | null;
}

/** Job-level status for a workflow run. */
export interface WorkflowJob {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  steps: WorkflowJobStep[];
}

/** Lists jobs (with steps) for a specific workflow run. */
export async function listWorkflowRunJobs(
  octokit: Octokit,
  owner: string,
  repo: string,
  runId: number
): Promise<WorkflowJob[]> {
  try {
    const { data } = await octokit.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: runId,
    });
    return data.jobs.map(job => ({
      name: job.name,
      status: job.status as WorkflowJob['status'],
      conclusion: job.conclusion ?? null,
      steps: (job.steps ?? []).map(step => ({
        name: step.name,
        status: step.status as WorkflowJobStep['status'],
        conclusion: step.conclusion ?? null,
        number: step.number,
        started_at: step.started_at ?? null,
      })),
    }));
  } catch (error) {
    throw apiError(`Failed to list jobs for workflow run ${runId} in ${owner}/${repo}`, error);
  }
}

/**
 * Dispatches a workflow run via the workflow_dispatch event.
 * Optionally passes input parameters to parameterized workflows.
 */
export async function dispatchWorkflow(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>
): Promise<void> {
  try {
    await octokit.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflowId,
      ref,
      ...(inputs ? { inputs } : {}),
    });
  } catch (error) {
    throw apiError(`Failed to dispatch workflow ${workflowId} in ${owner}/${repo}`, error);
  }
}

export interface RepoListItem {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}

/** Lists repositories accessible to the authenticated user, with streaming page callbacks. */
export async function listUserRepos(
  octokit: Octokit,
  options?: {
    sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    per_page?: number;
    onPage?: (allReposSoFar: RepoListItem[]) => void;
  }
): Promise<RepoListItem[]> {
  try {
    const allRepos: RepoListItem[] = [];
    const iterator = octokit.paginate.iterator(octokit.repos.listForAuthenticatedUser, {
      sort: options?.sort ?? 'pushed',
      per_page: options?.per_page ?? 100,
      type: 'all',
    });
    for await (const { data } of iterator) {
      const page = data.map(repo => ({
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
      }));
      allRepos.push(...page);
      options?.onPage?.([...allRepos]);
    }
    return allRepos;
  } catch (error) {
    throw apiError('Failed to list user repos', error);
  }
}
