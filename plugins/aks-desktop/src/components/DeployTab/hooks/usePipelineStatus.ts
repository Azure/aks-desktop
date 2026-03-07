// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useMemo } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { ANNOTATION_PIPELINE_REPOS } from '../../GitHubPipeline/hooks/usePipelineAnnotationSync';
import {
  findPipelineReposForCluster,
  isValidGitHubRepo,
} from '../../GitHubPipeline/utils/pipelineStorage';

export interface PipelineStatusResult {
  isConfigured: boolean;
  repos: GitHubRepo[];
}

/**
 * Checks K8s namespace annotations for configured pipeline repos.
 * Falls back to localStorage for backward compatibility.
 *
 * Uses Headlamp's reactive `useGet` hook, so the result updates automatically
 * when the namespace resource changes (no polling needed).
 */
export const usePipelineStatus = (cluster: string, namespace: string): PipelineStatusResult => {
  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(namespace, undefined, {
    cluster,
  });

  const annotation =
    namespaceInstance?.jsonData?.metadata?.annotations?.[ANNOTATION_PIPELINE_REPOS];

  return useMemo(() => {
    if (annotation) {
      try {
        const repos: unknown = JSON.parse(annotation);
        if (
          Array.isArray(repos) &&
          repos.length > 0 &&
          repos.every((r): r is GitHubRepo => isValidGitHubRepo(r))
        ) {
          return { isConfigured: true, repos };
        }
      } catch {
        // fall through to localStorage
      }
    }

    const localRepos = findPipelineReposForCluster(cluster, namespace);
    if (localRepos.length > 0) {
      return { isConfigured: true, repos: localRepos };
    }

    return { isConfigured: false, repos: [] };
  }, [annotation, cluster, namespace]);
};
