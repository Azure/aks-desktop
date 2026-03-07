// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useRef } from 'react';
import { listWorkflowRunJobs, listWorkflowRuns } from '../../../utils/github/github-api';
import { AGENT_DISCOVERY_MAX_POLLS, POLLING_INTERVAL_MS } from '../constants';
import { usePolling } from './usePolling';

/** Name pattern for the Copilot Coding Agent's workflow run (event type "dynamic"). */
const COPILOT_RUN_PATTERN = /copilot/i;

/** Name pattern for the step where the agent does its actual work. */
const PROCESSING_STEP_PATTERN = /^Processing Request/;

export type AgentPhaseStatus = 'pending' | 'active' | 'done';

export interface AgentPhase {
  id: string;
  label: string;
  status: AgentPhaseStatus;
}

export interface AgentWorkflowProgress {
  /** Whether the workflow run has been discovered. */
  runFound: boolean;
  /** High-level phases showing what the agent is doing. */
  phases: AgentPhase[];
  /** ISO timestamp when the "Processing Request" step started (for elapsed time). */
  agentStartedAt: string | null;
}

interface AgentPollData {
  /** Whether the "Processing Request" step has started (agent is doing real work). */
  agentWorking: boolean;
  /** When "Processing Request" started, if available. */
  agentStartedAt: string | null;
}

/**
 * Builds the two-phase progress list:
 * 1. "Setting up environment" — active while workflow setup runs, done when agent starts working
 * 2. "Copilot agent is working" — active while the agent analyzes, generates, and tests
 */
function buildPhases(isEnabled: boolean, agentWorking: boolean): AgentPhase[] {
  const setupStatus: AgentPhaseStatus = agentWorking ? 'done' : isEnabled ? 'active' : 'pending';
  const workingStatus: AgentPhaseStatus = agentWorking ? 'active' : 'pending';

  return [
    { id: 'setup', label: 'Setting up environment', status: setupStatus },
    {
      id: 'working',
      label: 'Analyzing repo, generating Dockerfile, K8s manifests, and workflow',
      status: workingStatus,
    },
  ];
}

/**
 * Polls for the Copilot agent's workflow run to provide phase-level progress.
 *
 * The Copilot Coding Agent pushes all file changes only when it marks the
 * draft PR as ready, so we can't track granular file-level progress.
 * Instead we track two phases: environment setup and agent working.
 * An elapsed time is provided so the UI can show how long the agent has
 * been working (typically 10–25 minutes).
 */
export function useAgentWorkflowProgress(
  octokit: Octokit | null,
  owner: string,
  repo: string,
  enabled: boolean
): AgentWorkflowProgress {
  const isEnabled = !!(octokit && owner && repo && enabled);
  const runIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      runIdRef.current = null;
    }
  }, [isEnabled]);

  const pollFn = useCallback(async (): Promise<AgentPollData | null> => {
    if (!octokit) return null;

    if (runIdRef.current === null) {
      const runs = await listWorkflowRuns(octokit, owner, repo, { per_page: 5 });
      const active = runs.filter(r => r.status === 'in_progress' || r.status === 'queued');
      const activeRun = active.find(r => COPILOT_RUN_PATTERN.test(r.name)) ?? active[0] ?? null;
      if (!activeRun) return null;
      runIdRef.current = activeRun.id;
    }

    let agentWorking = false;
    let agentStartedAt: string | null = null;
    try {
      const jobs = await listWorkflowRunJobs(octokit, owner, repo, runIdRef.current);
      const allSteps = jobs.flatMap(j => j.steps);
      const processingStep = allSteps.find(s => PROCESSING_STEP_PATTERN.test(s.name));
      if (processingStep && processingStep.status !== 'queued') {
        agentWorking = true;
        agentStartedAt = processingStep.started_at ?? null;
      }
    } catch {
      // non-critical — progress display only
    }

    return { agentWorking, agentStartedAt };
  }, [octokit, owner, repo]);

  const shouldStop = useCallback(() => false, []);

  const { data } = usePolling<AgentPollData>({
    enabled: isEnabled,
    intervalMs: POLLING_INTERVAL_MS,
    maxPolls: AGENT_DISCOVERY_MAX_POLLS,
    pollFn,
    shouldStop,
  });

  const phases = buildPhases(isEnabled, data?.agentWorking ?? false);

  return {
    runFound: data !== null,
    phases,
    agentStartedAt: data?.agentStartedAt ?? null,
  };
}
