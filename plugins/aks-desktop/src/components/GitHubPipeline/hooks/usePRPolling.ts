// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { useCallback, useRef } from 'react';
import type { GitHubRunConclusion, GitHubRunStatus } from '../../../types/github';
import { getPullRequest, getStatusChecks } from '../../../utils/github/github-api';
import { isGitHubSessionCurrent } from '../../../utils/github/github-session';
import { POLLING_INTERVAL_MS, PR_POLLING_MAX_POLLS } from '../constants';
import { usePolling } from './usePolling';

type PRState = 'open' | 'closed';

export interface UsePRPollingResult {
  prStatus: { state: PRState; merged: boolean; mergeable: boolean | null } | null;
  isMerged: boolean;
  isClosed: boolean;
  isTimedOut: boolean;
  statusChecks: Array<{
    name: string;
    status: GitHubRunStatus;
    conclusion: GitHubRunConclusion;
  }> | null;
  error: string | null;
  stopPolling: () => void;
}

/** Internal composite type returned by each poll cycle. */
interface PRPollData {
  prStatus: { state: PRState; merged: boolean; mergeable: boolean | null };
  statusChecks: Array<{
    name: string;
    status: GitHubRunStatus;
    conclusion: GitHubRunConclusion;
  }> | null;
}

/**
 * Polls a PR's merge/close status at a fixed interval.
 * Stops automatically when the PR is merged, closed, or polling times out.
 *
 * @param octokit - Authenticated Octokit client. Pass null to disable.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param prNumber - PR number to poll. Pass null to disable.
 * @param enabled - Master toggle; set false to pause polling.
 */
export const usePRPolling = (
  octokit: Octokit | null,
  owner: string,
  repo: string,
  prNumber: number | null,
  enabled: boolean,
  sessionVersion: number
): UsePRPollingResult => {
  const isEnabled = !!(octokit && prNumber && enabled);
  const resetKey = JSON.stringify([sessionVersion, owner, repo, prNumber]);
  const identityRef = useRef(resetKey);
  identityRef.current = resetKey;

  const pollFn = useCallback(async (): Promise<PRPollData | null> => {
    const current = () =>
      identityRef.current === resetKey && isGitHubSessionCurrent(sessionVersion);
    if (!octokit || !prNumber || !current()) return null;
    const result = await getPullRequest(octokit, owner, repo, prNumber);
    if (!current()) return null;
    let statusChecks: PRPollData['statusChecks'] = null;
    if (result.state === 'open') {
      try {
        statusChecks = await getStatusChecks(octokit, owner, repo, result.headSha);
      } catch {
        if (!current()) return null;
        console.error('Failed to fetch status checks');
      }
    }
    if (!current()) return null;
    return {
      prStatus: { state: result.state, merged: result.merged, mergeable: result.mergeable },
      statusChecks,
    };
  }, [octokit, owner, repo, prNumber, resetKey, sessionVersion]);

  const shouldStop = useCallback(
    (result: PRPollData): boolean => result.prStatus.merged || result.prStatus.state === 'closed',
    []
  );

  const { data, isTimedOut, error, stopPolling } = usePolling<PRPollData>({
    enabled: isEnabled,
    resetKey,
    intervalMs: POLLING_INTERVAL_MS,
    maxPolls: PR_POLLING_MAX_POLLS,
    pollFn,
    shouldStop,
  });

  const prStatus = data?.prStatus ?? null;
  const isMerged = data?.prStatus.merged ?? false;
  const isClosed = !!(data?.prStatus.state === 'closed' && !isMerged);
  const statusChecks = data?.statusChecks ?? null;

  return { prStatus, isMerged, isClosed, isTimedOut, statusChecks, error, stopPolling };
};
