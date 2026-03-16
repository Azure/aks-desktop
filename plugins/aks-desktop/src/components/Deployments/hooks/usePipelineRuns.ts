// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import type { Octokit } from '@octokit/rest';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitHubRepo, WorkflowRunConclusion, WorkflowRunStatus } from '../../../types/github';
import { listWorkflowRuns } from '../../../utils/github/github-api';
import { PIPELINE_WORKFLOW_FILENAME } from '../../GitHubPipeline/constants';

export interface PipelineRun {
  id: number;
  name: string;
  status: WorkflowRunStatus | null;
  conclusion: WorkflowRunConclusion;
  url: string;
  createdAt: string;
}

export interface UsePipelineRunsResult {
  runs: PipelineRun[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches recent workflow runs for configured pipeline repos.
 * Supports multiple repos — merges runs from all repos sorted by recency.
 */
export const usePipelineRuns = (
  octokit: Octokit | null,
  repos: GitHubRepo[]
): UsePipelineRunsResult => {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable repos reference — only changes when the repo list actually changes
  const repoKey = JSON.stringify(repos.map(r => [r.owner, r.repo]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRepos = useMemo(() => repos, [repoKey]);

  const fetchRuns = useCallback(
    async (signal: { cancelled: boolean }) => {
      if (!octokit || stableRepos.length === 0) return;

      setLoading(true);
      setError(null);
      const results = await Promise.allSettled(
        stableRepos.map(repo =>
          listWorkflowRuns(octokit, repo.owner, repo.repo, {
            workflowFileName: PIPELINE_WORKFLOW_FILENAME,
            per_page: 5,
          })
        )
      );
      if (signal.cancelled) return;
      const allRuns: PipelineRun[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allRuns.push(...result.value);
        }
      }
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length === results.length && results.length > 0) {
        setError(t('Failed to load pipeline runs'));
      } else if (failures.length > 0) {
        console.warn(`Pipeline runs: ${failures.length}/${results.length} repos failed to load`);
        setError(null); // Partial success — show what we have
      }
      allRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setRuns(allRuns.slice(0, 10));
      setLoading(false);
    },
    [octokit, stableRepos]
  );

  useEffect(() => {
    const signal = { cancelled: false };
    fetchRuns(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [fetchRuns]);

  return { runs, loading, error };
};
