// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import type { Octokit } from '@octokit/rest';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitHubRepo, WorkflowRunConclusion, WorkflowRunStatus } from '../../../types/github';
import { listWorkflowRuns } from '../../../utils/github/github-api';
import { isGitHubSessionCurrent } from '../../../utils/github/github-session';
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

/** Account-scoped recent runs; disconnected views never retain the previous account's rows. */
export const usePipelineRuns = (
  octokit: Octokit | null,
  repos: GitHubRepo[],
  sessionVersion: number
): UsePipelineRunsResult => {
  const { t } = useTranslation();
  const repoKey = JSON.stringify(repos.map(repo => [repo.owner, repo.repo]));
  // Repository identity, not a freshly allocated equivalent array, owns this fetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: repoKey captures every repository field used by this hook.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRepos = useMemo(() => repos, [repoKey]);
  const key = JSON.stringify([sessionVersion, repoKey]);
  const latestKey = useRef(key);
  latestKey.current = key;
  const [model, setModel] = useState({
    key,
    runs: [] as PipelineRun[],
    loading: false,
    failed: false,
  });

  useEffect(() => {
    if (!octokit || !stableRepos.length || !isGitHubSessionCurrent(sessionVersion)) return;
    let active = true;
    const current = () =>
      active && latestKey.current === key && isGitHubSessionCurrent(sessionVersion);
    setModel({ key, runs: [], loading: true, failed: false });
    void Promise.allSettled(
      stableRepos.map(repo =>
        listWorkflowRuns(octokit, repo.owner, repo.repo, {
          workflowFileName: PIPELINE_WORKFLOW_FILENAME,
          per_page: 5,
        })
      )
    ).then(results => {
      if (!current()) return;
      const runs = results.flatMap(result => (result.status === 'fulfilled' ? result.value : []));
      const failures = results.filter(result => result.status === 'rejected').length;
      if (failures && failures < results.length)
        console.warn(`Pipeline runs: ${failures}/${results.length} repos failed to load`);
      runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setModel({
        key,
        runs: runs.slice(0, 10),
        loading: false,
        failed: failures === results.length,
      });
    });
    return () => {
      active = false;
    };
  }, [octokit, stableRepos, key, sessionVersion]);

  if (!octokit || !repos.length || !isGitHubSessionCurrent(sessionVersion))
    return { runs: [], loading: false, error: null };
  if (model.key !== key) return { runs: [], loading: true, error: null };
  return {
    runs: model.runs,
    loading: model.loading,
    error: model.failed ? t('Failed to load pipeline runs') : null,
  };
};
