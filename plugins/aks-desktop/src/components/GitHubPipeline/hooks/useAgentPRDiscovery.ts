// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback } from 'react';
import { listPullRequests } from '../../../utils/github/github-api';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 120; // 120 * 5s = 10 minutes

/**
 * GitHub bot usernames that may author PRs created by the Copilot Coding Agent.
 */
const COPILOT_BOT_USERS = ['copilot-swe-agent[bot]', 'copilot[bot]'];

/**
 * Return type for the {@link useAgentPRDiscovery} hook.
 */
interface UseAgentPRDiscoveryResult {
  /** The discovered PR URL, or null if not yet found. */
  prUrl: string | null;
  /** The discovered PR number, or null if not yet found. */
  prNumber: number | null;
  /** Whether the discovery timed out. */
  isTimedOut: boolean;
  /** Error message, if any. */
  error: string | null;
  /** Stops polling manually. */
  stopPolling: () => void;
  /** Triggers an immediate poll outside the normal interval schedule. */
  pollNow: () => void;
}

/** Internal type returned when the agent's PR is found. */
interface AgentPRPollData {
  prUrl: string;
  prNumber: number;
}

/**
 * Polls for a PR created by Copilot agent (copilot[bot]) whose title
 * contains the given appName.
 *
 * @param octokit - Authenticated Octokit client. Pass null to disable.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param appName - Application name to match in PR title.
 * @param enabled - Master toggle; set false to pause polling.
 */
export const useAgentPRDiscovery = (
  octokit: Octokit | null,
  owner: string,
  repo: string,
  appName: string,
  enabled: boolean
): UseAgentPRDiscoveryResult => {
  const isEnabled = !!(octokit && owner && repo && appName && enabled);

  const pollFn = useCallback(async (): Promise<AgentPRPollData | null> => {
    if (!octokit) return null;
    const prs = await listPullRequests(octokit, owner, repo, {
      state: 'open',
      sort: 'created',
      direction: 'desc',
      per_page: 10,
    });
    const agentPr = prs.find(
      pr => pr.title.includes(appName) && COPILOT_BOT_USERS.includes(pr.user)
    );
    if (agentPr) {
      return { prUrl: agentPr.url, prNumber: agentPr.number };
    }
    return null;
  }, [octokit, owner, repo, appName]);

  // Any non-null result means the PR was found — stop immediately
  const shouldStop = useCallback((): boolean => true, []);

  const { data, isTimedOut, error, stopPolling, pollNow } = usePolling<AgentPRPollData>({
    enabled: isEnabled,
    intervalMs: POLL_INTERVAL_MS,
    maxPolls: MAX_POLLS,
    pollFn,
    shouldStop,
  });

  return {
    prUrl: data?.prUrl ?? null,
    prNumber: data?.prNumber ?? null,
    isTimedOut,
    error,
    stopPolling,
    pollNow,
  };
};
