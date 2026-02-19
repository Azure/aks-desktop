// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';

const PIPELINE_STATE_PREFIX = 'aks-desktop:pipeline-state:';

/** States that indicate a pipeline has been fully configured. */
const CONFIGURED_STATES = new Set(['PipelineConfigured', 'Deployed', 'PipelineRunning']);

export interface PipelineStatusResult {
  isConfigured: boolean;
  repo: GitHubRepo | null;
}

/**
 * Checks localStorage for a configured pipeline.
 * Scans all pipeline state entries and returns the first one that is in a
 * configured/deployed state.
 */
export const usePipelineStatus = (): PipelineStatusResult => {
  const [result, setResult] = useState<PipelineStatusResult>({
    isConfigured: false,
    repo: null,
  });

  useEffect(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(PIPELINE_STATE_PREFIX)) continue;

        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const parsed = JSON.parse(raw);
        if (parsed && CONFIGURED_STATES.has(parsed.deploymentState) && parsed.config?.repo) {
          setResult({
            isConfigured: true,
            repo: parsed.config.repo,
          });
          return;
        }
      }
      setResult({ isConfigured: false, repo: null });
    } catch {
      setResult({ isConfigured: false, repo: null });
    }
  }, []);

  return result;
};
