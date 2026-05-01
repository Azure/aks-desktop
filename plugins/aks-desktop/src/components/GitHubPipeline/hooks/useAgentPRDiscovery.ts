// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback } from 'react';
import {
  findLinkedPullRequest,
  getIssue,
  listIssueComments,
} from '../../../utils/github/github-api';
import { AGENT_DISCOVERY_MAX_POLLS, POLLING_INTERVAL_MS } from '../constants';
import { usePolling } from './usePolling';

/** Reason classification for an agent run that closed without producing a PR. */
export type AgentFailureReason = 'token-limit' | 'unknown';

interface UseAgentPRDiscoveryResult {
  prUrl: string | null;
  prNumber: number | null;
  prMerged: boolean;
  /** PR number of a draft PR the agent is still working on. */
  draftPrNumber: number | null;
  issueClosed: boolean;
  /** Set when issueClosed is true and we could classify the failure from issue comments. */
  failureReason: AgentFailureReason | null;
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
  failureReason: AgentFailureReason | null;
}

/**
 * Detects the Copilot evaluator's prompt-token-limit error in issue comments.
 * The runtime posts a failure message containing the literal API error string,
 * e.g. `prompt token count of 70921 exceeds the limit of 64000`.
 */
const TOKEN_LIMIT_PATTERN = /prompt token count of \d+ exceeds the limit/i;

function classifyFailureFromComments(comments: Array<{ body: string }>): AgentFailureReason {
  for (const c of comments) {
    if (TOKEN_LIMIT_PATTERN.test(c.body)) return 'token-limit';
  }
  return 'unknown';
}

/**
 * Polls for a PR created by the Copilot Coding Agent.
 *
 * Detection strategy:
 * 1. **Issue timeline** (primary): Queries the trigger issue's timeline for
 *    cross-referenced PRs. This is deterministic — the agent's PR references
 *    the trigger issue, creating a timeline event.
 * 2. **Issue status** (termination signal): If no linked PR is found and the
 *    issue is closed, the agent completed without creating a PR. In that
 *    case we also fetch issue comments to classify the failure (e.g. the
 *    Copilot evaluator hitting its 64k token cap).
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
            failureReason: null,
          };
        }
        return {
          prUrl: null,
          prNumber: null,
          merged: false,
          draftPrNumber: linked.number,
          issueClosed: false,
          failureReason: null,
        };
      }
    } catch (err) {
      console.warn('Failed to query issue timeline:', err);
    }

    try {
      const issue = await getIssue(octokit, owner, repo, issueNumber);
      if (issue.state === 'closed') {
        let failureReason: AgentFailureReason = 'unknown';
        try {
          const comments = await listIssueComments(octokit, owner, repo, issueNumber);
          failureReason = classifyFailureFromComments(comments);
        } catch (err) {
          // Comment fetch is best-effort; default to 'unknown'.
          console.warn('Failed to fetch issue comments for failure classification:', err);
        }
        return {
          prUrl: null,
          prNumber: null,
          merged: false,
          draftPrNumber: null,
          issueClosed: true,
          failureReason,
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
  const failureReason = data?.failureReason ?? null;

  return {
    prUrl,
    prNumber,
    prMerged,
    draftPrNumber,
    issueClosed,
    failureReason,
    isTimedOut,
    error,
    stopPolling,
  };
};
