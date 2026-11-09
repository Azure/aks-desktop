// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { createOrUpdateFile } from '../../../utils/github/github-api';
import { getAcrBuildFiles } from './acrTasks/acrTaskRunner';

/**
 * Creates or updates each shared ACR runtime file on an existing branch using its current SHA.
 * Writes are sequential, not atomic; an error can leave earlier files published.
 *
 * @param octokit Authenticated client with repository contents write access.
 * @param owner GitHub repository owner.
 * @param repo GitHub repository name.
 * @param branch Existing target branch for the runtime files.
 * @returns Resolves when every runtime file has been published.
 * @throws If a runtime path is not a regular file, or a GitHub read/write fails other than a
 * missing-file read (404), which is treated as a create.
 */
export async function publishAcrBuildFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<void> {
  for (const [path, content] of Object.entries(getAcrBuildFiles())) {
    let sha: string | undefined;
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
      if (Array.isArray(data) || data.type !== 'file' || !data.sha) {
        throw new Error(`ACR runtime path ${path} is not a regular file on branch ${branch}`);
      }
      sha = data.sha;
    } catch (error) {
      if (!(error instanceof Error && 'status' in error && error.status === 404)) {
        throw error;
      }
    }
    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      path,
      content,
      'Add ACR Tasks build runtime',
      branch,
      sha
    );
  }
}
