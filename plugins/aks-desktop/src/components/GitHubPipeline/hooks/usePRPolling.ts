// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback } from 'react';
import { getPullRequest, getStatusChecks } from '../../../utils/github/github-api';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 240; // 240 * 15s = 1 hour

/**
 * Return type for the {@link usePRPolling} hook.
 */
interface UsePRPollingResult {
  /** PR state: open, closed, or null if not yet fetched. */
  prStatus: { state: string; merged: boolean; mergeable: boolean | null } | null;
  /** Whether the PR has been merged. */
  isMerged: boolean;
  /** Whether the PR was closed without merging. */
  isClosed: boolean;
  /** Whether polling timed out waiting for the PR to be resolved. */
  isTimedOut: boolean;
  /** CI/CD status checks on the PR. */
  statusChecks: Array<{ name: string; status: string; conclusion: string | null }> | null;
  /** Error message, if any. */
  error: string | null;
  /** Stops polling manually. */
  stopPolling: () => void;
}

/** Internal composite type returned by each poll cycle. */
interface PRPollData {
  prStatus: { state: string; merged: boolean; mergeable: boolean | null };
  statusChecks: Array<{ name: string; status: string; conclusion: string | null }> | null;
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
  enabled: boolean
): UsePRPollingResult => {
  const isEnabled = !!(octokit && prNumber && enabled);

  const pollFn = useCallback(async (): Promise<PRPollData | null> => {
    if (!octokit || !prNumber) return null;
    const result = await getPullRequest(octokit, owner, repo, prNumber);
    let statusChecks: PRPollData['statusChecks'] = null;
    if (result.state === 'open') {
      try {
        statusChecks = await getStatusChecks(octokit, owner, repo, result.headSha);
      } catch {
        console.error('Failed to fetch status checks');
      }
    }
    return {
      prStatus: { state: result.state, merged: result.merged, mergeable: result.mergeable },
      statusChecks,
    };
  }, [octokit, owner, repo, prNumber]);

  const shouldStop = useCallback(
    (result: PRPollData): boolean => result.prStatus.merged || result.prStatus.state === 'closed',
    []
  );

  const { data, isTimedOut, error, stopPolling } = usePolling<PRPollData>({
    enabled: isEnabled,
    intervalMs: POLL_INTERVAL_MS,
    maxPolls: MAX_POLLS,
    pollFn,
    shouldStop,
  });

  const prStatus = data?.prStatus ?? null;
  const isMerged = data?.prStatus.merged ?? false;
  const isClosed = !!(data?.prStatus.state === 'closed' && !isMerged);
  const statusChecks = data?.statusChecks ?? null;

  return { prStatus, isMerged, isClosed, isTimedOut, statusChecks, error, stopPolling };
};
