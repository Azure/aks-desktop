// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAcrBuildFiles } from './acrTasks/acrTaskRunner';
import { publishAcrBuildFiles } from './publishAcrBuildFiles';

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock('../../../utils/github/github-api', () => ({ createOrUpdateFile: writeFile }));
const octokit = new Octokit();
const getContent = vi.fn();

describe('publishAcrBuildFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(octokit.repos, 'getContent').mockImplementation(getContent);
    writeFile.mockResolvedValue(undefined);
    getContent.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
  });

  it('creates missing files only after a target-branch 404', async () => {
    await publishAcrBuildFiles(octokit, 'owner', 'repo', 'target');

    for (const [path, content] of Object.entries(getAcrBuildFiles())) {
      expect(getContent).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        path,
        ref: 'target',
      });
      expect(writeFile).toHaveBeenCalledWith(
        octokit,
        'owner',
        'repo',
        path,
        content,
        expect.any(String),
        'target',
        undefined
      );
    }
  });

  it("replaces outdated inherited runtime content using each file's current SHA", async () => {
    getContent.mockImplementation(async ({ path }) => ({
      data: { type: 'file', sha: `old:${path}`, content: 'outdated-runtime' },
    }));

    await publishAcrBuildFiles(octokit, 'owner', 'repo', 'target');

    for (const [path, content] of Object.entries(getAcrBuildFiles())) {
      expect(writeFile).toHaveBeenCalledWith(
        octokit,
        'owner',
        'repo',
        path,
        content,
        expect.any(String),
        'target',
        `old:${path}`
      );
    }
  });

  it.each([403, 500])(
    'propagates lookup HTTP %s without treating it as a missing file',
    async status => {
      const error = Object.assign(new Error('Lookup failed'), { status });
      getContent.mockRejectedValue(error);

      await expect(publishAcrBuildFiles(octokit, 'owner', 'repo', 'target')).rejects.toBe(error);
      expect(writeFile).not.toHaveBeenCalled();
    }
  );

  it.each([
    [],
    { type: 'dir', sha: 'directory' },
    { type: 'symlink', sha: 'link' },
    { type: 'file', sha: '' },
  ])('rejects a non-file or invalid target before writing (%o)', async data => {
    getContent.mockResolvedValue({ data });

    await expect(publishAcrBuildFiles(octokit, 'owner', 'repo', 'target')).rejects.toThrow(
      'not a regular file'
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('surfaces write conflicts and stops before overwriting any further artifacts', async () => {
    const error = Object.assign(new Error('SHA changed'), { status: 409 });
    writeFile.mockRejectedValueOnce(error);

    await expect(publishAcrBuildFiles(octokit, 'owner', 'repo', 'target')).rejects.toBe(error);
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});
