// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback } from 'react';
import { findLinkedPullRequest, getIssue } from '../../../utils/github/github-api';
import { AGENT_DISCOVERY_MAX_POLLS, POLLING_INTERVAL_MS } from '../constants';
import { usePolling } from './usePolling';

interface UseAgentPRDiscoveryResult {
  prUrl: string | null;
  prNumber: number | null;
  prMerged: boolean;
  /** PR number of a draft PR the agent is still working on. */
  draftPrNumber: number | null;
  issueClosed: boolean;
  isTimedOut: boolean;
  error: string | null;
  stopPolling: () => void;
}

/** Internal type returned by each poll cycle. */
interface AgentPRPollData {
  prUrl: string | null;
  prNumber: number | null;
  merged: boolean;
  draftPrNumber: number | null;
  issueClosed: boolean;
}

/**
 * Polls for a PR created by the Copilot Coding Agent.
 *
 * Detection strategy:
 * 1. **Issue timeline** (primary): Queries the trigger issue's timeline for
 *    cross-referenced PRs. This is deterministic — the agent's PR references
 *    the trigger issue, creating a timeline event.
 * 2. **Issue status** (termination signal): If no linked PR is found and the
 *    issue is closed, the agent completed without creating a PR.
 *
 * @param octokit - Authenticated Octokit client. Pass null to disable.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param enabled - Master toggle; set false to pause polling.
 * @param issueNumber - The trigger issue number used to find the linked PR.
 */
export const useAgentPRDiscovery = (
  octokit: Octokit | null,
  owner: string,
  repo: string,
  enabled: boolean,
  issueNumber?: number | null
): UseAgentPRDiscoveryResult => {
  const isEnabled = !!(octokit && owner && repo && issueNumber && enabled);

  const pollFn = useCallback(async (): Promise<AgentPRPollData | null> => {
    if (!octokit || !issueNumber) return null;

    try {
      const linked = await findLinkedPullRequest(octokit, owner, repo, issueNumber);
      if (linked) {
        if (!linked.draft) {
          return {
            prUrl: linked.url,
            prNumber: linked.number,
            merged: linked.merged,
            draftPrNumber: null,
            issueClosed: false,
          };
        }
        return {
          prUrl: null,
          prNumber: null,
          merged: false,
          draftPrNumber: linked.number,
          issueClosed: false,
        };
      }
    } catch (err) {
      console.warn('Failed to query issue timeline:', err);
    }

    try {
      const issue = await getIssue(octokit, owner, repo, issueNumber);
      if (issue.state === 'closed') {
        return {
          prUrl: null,
          prNumber: null,
          merged: false,
          draftPrNumber: null,
          issueClosed: true,
        };
      }
    } catch (err) {
      console.warn('Failed to check issue status:', err);
    }

    return null;
  }, [octokit, owner, repo, issueNumber]);

  const shouldStop = useCallback(
    (result: AgentPRPollData): boolean => !!(result.prNumber || result.issueClosed),
    []
  );

  const { data, isTimedOut, error, stopPolling } = usePolling<AgentPRPollData>({
    enabled: isEnabled,
    intervalMs: POLLING_INTERVAL_MS,
    maxPolls: AGENT_DISCOVERY_MAX_POLLS,
    pollFn,
    shouldStop,
  });

  const prUrl = data?.prUrl ?? null;
  const prNumber = data?.prNumber ?? null;
  const prMerged = data?.merged ?? false;
  const draftPrNumber = data?.draftPrNumber ?? null;
  const issueClosed = data?.issueClosed ?? false;

  return {
    prUrl,
    prNumber,
    prMerged,
    draftPrNumber,
    issueClosed,
    isTimedOut,
    error,
    stopPolling,
  };
};
