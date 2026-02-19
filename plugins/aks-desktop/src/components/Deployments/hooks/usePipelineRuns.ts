// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useState } from 'react';
import type { WorkflowRunConclusion, WorkflowRunStatus } from '../../../types/github';
import { listWorkflowRuns } from '../../../utils/github/github-api';

export interface PipelineRun {
  id: number;
  name: string;
  status: WorkflowRunStatus | null;
  conclusion: WorkflowRunConclusion;
  url: string;
}

export interface UsePipelineRunsResult {
  runs: PipelineRun[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches recent workflow runs for a given repo's deploy-to-aks.yml workflow.
 * Returns the latest runs so the overview card can display pipeline activity.
 */
export const usePipelineRuns = (
  octokit: Octokit | null,
  owner: string | null,
  repo: string | null
): UsePipelineRunsResult => {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!octokit || !owner || !repo) return;

    setLoading(true);
    setError(null);
    try {
      const result = await listWorkflowRuns(octokit, owner, repo, {
        workflowFileName: 'deploy-to-aks.yml',
        per_page: 5,
      });
      setRuns(result);
    } catch (err) {
      console.error('Failed to fetch pipeline runs:', err);
      setError('Failed to load pipeline runs');
    } finally {
      setLoading(false);
    }
  }, [octokit, owner, repo]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  return { runs, loading, error };
};
