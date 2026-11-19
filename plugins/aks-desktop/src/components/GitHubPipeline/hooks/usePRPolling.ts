// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitHubRunConclusion, GitHubRunStatus } from '../../../types/github';
import { getPullRequest, getStatusChecks } from '../../../utils/github/github-api';
import { POLLING_INTERVAL_MS, PR_POLLING_MAX_POLLS } from '../constants';

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
  enabled: boolean
): UsePRPollingResult => {
  const isEnabled = !!(octokit && prNumber && enabled);
  const session = useMemo(
    () => ({ stopped: false, timer: null as ReturnType<typeof setTimeout> | null }),
    [octokit, owner, repo, prNumber, isEnabled]
  );
  const [snapshot, setSnapshot] = useState<{
    session: typeof session;
    data: PRPollData | null;
    error: string | null;
    isTimedOut: boolean;
  } | null>(null);

  const stopPolling = useCallback(() => {
    session.stopped = true;
    if (session.timer) clearTimeout(session.timer);
  }, [session]);

  useEffect(() => {
    if (!isEnabled || !octokit || !prNumber) return;
    let cancelled = false;
    let polls = 0;
    session.stopped = false;
    setSnapshot(null);
    const poll = async () => {
      if (cancelled || session.stopped) return;
      polls++;
      try {
        const result = await getPullRequest(octokit, owner, repo, prNumber);
        if (cancelled || session.stopped) return;
        let statusChecks: PRPollData['statusChecks'] = null;
        if (result.state === 'open') {
          try {
            statusChecks = await getStatusChecks(octokit, owner, repo, result.headSha);
          } catch (err) {
            console.error('Failed to fetch status checks:', err);
          }
        }
        if (cancelled || session.stopped) return;
        setSnapshot({
          session,
          data: {
            prStatus: { state: result.state, merged: result.merged, mergeable: result.mergeable },
            statusChecks,
          },
          error: null,
          isTimedOut: false,
        });
        if (result.merged || result.state === 'closed') {
          stopPolling();
          return;
        }
      } catch (err) {
        if (cancelled || session.stopped) return;
        console.error('Polling error:', err);
        setSnapshot(previous => ({
          session,
          data: previous?.session === session ? previous.data : null,
          error: err instanceof Error ? err.message : 'Polling failed',
          isTimedOut: false,
        }));
      }
      if (cancelled || session.stopped) return;
      if (polls >= PR_POLLING_MAX_POLLS) {
        setSnapshot(previous =>
          previous?.session === session ? { ...previous, isTimedOut: true } : previous
        );
        stopPolling();
      } else {
        session.timer = setTimeout(poll, POLLING_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [octokit, owner, repo, prNumber, isEnabled, session, stopPolling]);

  // Hide old PR results during render, before effects can reset the next session.
  const current = isEnabled && snapshot?.session === session ? snapshot : null;
  const data = current?.data;
  const isTimedOut = current?.isTimedOut ?? false;
  const error = current?.error ?? null;
  const prStatus = data?.prStatus ?? null;
  const isMerged = data?.prStatus.merged ?? false;
  const isClosed = !!(data?.prStatus.state === 'closed' && !isMerged);
  const statusChecks = data?.statusChecks ?? null;

  return { prStatus, isMerged, isClosed, isTimedOut, statusChecks, error, stopPolling };
};
