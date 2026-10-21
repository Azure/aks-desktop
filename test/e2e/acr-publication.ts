// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  ACR_BUILD_SCRIPT_PATH,
  getAcrBuildFiles,
} from '../../plugins/aks-desktop/src/components/GitHubPipeline/utils/acrTasks/acrTaskRunner';
import { publishAcrBuildFiles } from '../../plugins/aks-desktop/src/components/GitHubPipeline/utils/publishAcrBuildFiles';
import {
  createOrUpdateFile,
  type createOctokitClient,
} from '../../plugins/aks-desktop/src/utils/github/github-api';
import type { Config } from './acr-workflow';

/** Authenticated GitHub client used by the production runtime publisher. */
type Octokit = ReturnType<typeof createOctokitClient>;

/**
 * Exercises production runtime publication on an existing non-default sandbox branch.
 * Checks repeated publication and repair of an intentionally stale runner, attempting repair
 * even after an ambiguous write failure. Leaves the published runtime and branch in place;
 * performs no workflow dispatch or Azure resource mutation.
 *
 * @param octokit Authenticated client with repository contents read/write access.
 * @param config Sandbox repository (`owner/name`) and dedicated `aksd-acr-e2e` branch.
 * @returns Resolves when publication, repeat publication and stale-file repair match the bundle.
 * @throws If sandbox guards, GitHub operations or content/SHA checks fail; an AggregateError
 * reports both the original failure and a failed final repair.
 */
export async function verifyRuntimePublication(
  octokit: Octokit,
  config: Pick<Config, 'repository' | 'branch'>
): Promise<void> {
  const { repository, branch } = config;
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/, 'Expected owner/repository');
  assert.match(branch, /^aksd-acr-e2e(?:[-/][a-z0-9-]+)?$/, 'Use a dedicated aksd-acr-e2e branch');
  const [owner, repo] = repository.split('/');
  const { data: metadata } = await octokit.repos.get({ owner, repo });
  assert.equal(metadata.full_name.toLowerCase(), repository.toLowerCase(), 'Repository mismatch');
  assert.notEqual(
    branch,
    metadata.default_branch,
    'Never publish runtime tests to the default branch'
  );

  const files = getAcrBuildFiles();
  assert.ok(Object.hasOwn(files, ACR_BUILD_SCRIPT_PATH), 'Missing known runtime artifact');
  const read = async (path: string) => {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    assert.ok(!Array.isArray(data) && data.type === 'file', `Not a runtime file: ${path}`);
    assert.equal(data.path, path, 'Runtime response path mismatch');
    assert.equal(data.encoding, 'base64', `Unexpected runtime encoding: ${path}`);
    assert.match(data.sha, /^[0-9a-f]{40}$/, `Missing runtime content SHA: ${path}`);
    const bytes = Buffer.from(data.content, 'base64');
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(data.sha, sha, `Runtime content SHA mismatch: ${path}`);
    return { sha: data.sha, content: bytes.toString('utf8') };
  };
  const verify = async () => {
    for (const [path, expected] of Object.entries(files)) {
      assert.equal((await read(path)).content, expected, `Runtime content mismatch: ${path}`);
    }
  };
  const publish = () => publishAcrBuildFiles(octokit, owner, repo, branch);

  await publish();
  await verify();
  await publish();
  await verify();

  const path = ACR_BUILD_SCRIPT_PATH;
  const current = await read(path);
  const outdated = '# Outdated runtime fixture for ACR publication acceptance.\n';
  let needsRepair = true;
  let failure: unknown;
  try {
    // Repair even if GitHub accepts this write but its response is lost.
    await createOrUpdateFile(
      octokit,
      owner,
      repo,
      path,
      outdated,
      'Exercise outdated ACR runtime',
      branch,
      current.sha
    );
    assert.equal((await read(path)).content, outdated, 'Outdated runtime was not installed');
    await publish();
    await verify();
    needsRepair = false;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (needsRepair) {
      try {
        const stale = await read(path);
        if (stale.content !== files[path]) {
          await createOrUpdateFile(
            octokit,
            owner,
            repo,
            path,
            files[path],
            'Repair ACR runtime acceptance fixture',
            branch,
            stale.sha
          );
        }
        assert.equal((await read(path)).content, files[path], 'Runtime repair failed');
      } catch (repairError) {
        throw new AggregateError(
          [failure, repairError],
          'Runtime publication failed; repair also failed'
        );
      }
    }
  }
}
