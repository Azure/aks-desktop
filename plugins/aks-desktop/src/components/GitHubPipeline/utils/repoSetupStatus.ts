// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { getDefaultBranchSha } from '../../../utils/github/github-api';
import { AGENT_CONFIG_PATH, COPILOT_SETUP_STEPS_PATH } from '../constants';
import type { PipelineConfig } from '../types';
import { getAcrBuildFiles } from './acrTasks/acrTaskRunner';
import { isAgentConfigCurrent, isSetupWorkflowCurrent, readSetupFile } from './agentTemplates';

/**
 * Verifies the generated deployment contract, compatible setup workflow and complete runtime on the
 * deployment branch. Runtime content is the version fingerprint; a filename alone is insufficient.
 * All files are read at one commit, and a moving branch is never reported as current.
 * Other agent instructions may be customized. Lookup failures deliberately propagate to the caller.
 */
export async function getRepoSetupStatus(
  octokit: Octokit,
  config: PipelineConfig
): Promise<{ isCurrent: boolean }> {
  const { owner, repo, defaultBranch } = config.repo;
  const commitSha = await getDefaultBranchSha(octokit, owner, repo, defaultBranch);
  const expectedFiles = {
    ...(config.acrLoginServer || config.acrResourceId ? getAcrBuildFiles() : {}),
  };
  const [agent, workflow, ...matches] = await Promise.all([
    readSetupFile(octokit, owner, repo, AGENT_CONFIG_PATH, commitSha),
    readSetupFile(octokit, owner, repo, COPILOT_SETUP_STEPS_PATH, commitSha),
    ...Object.entries(expectedFiles).map(async ([path, content]) => {
      const file = await readSetupFile(octokit, owner, repo, path, commitSha);
      return file?.content === content;
    }),
  ]);
  const currentSha = await getDefaultBranchSha(octokit, owner, repo, defaultBranch);
  if (currentSha !== commitSha) {
    throw new Error('Repository branch changed during setup verification. Please retry.');
  }
  return {
    isCurrent:
      matches.every(Boolean) &&
      !!agent &&
      !!workflow &&
      isSetupWorkflowCurrent(workflow.content) &&
      isAgentConfigCurrent(agent.content, config),
  };
}
