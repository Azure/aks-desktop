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

  it('does not write or start a later artifact after cancellation during a read', async () => {
    const controller = new AbortController();
    getContent.mockImplementationOnce(async () => {
      controller.abort(new Error('interrupted read'));
      return { data: { type: 'file', sha: 'current' } };
    });
    await expect(
      publishAcrBuildFiles(octokit, 'owner', 'repo', 'target', {}, controller.signal)
    ).rejects.toThrow('interrupted read');
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('awaits an accepted write but does not publish further artifacts after cancellation', async () => {
    const controller = new AbortController();
    writeFile.mockImplementationOnce(async () => {
      controller.abort(new Error('interrupted write'));
    });
    await expect(
      publishAcrBuildFiles(octokit, 'owner', 'repo', 'target', {}, controller.signal)
    ).rejects.toThrow('interrupted write');
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
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

  it('uses the verified update precondition instead of replacing a concurrently edited file', async () => {
    const path = Object.keys(getAcrBuildFiles())[0];
    getContent.mockResolvedValue({ data: { type: 'file', sha: 'concurrent-edit' } });
    await expect(
      publishAcrBuildFiles(octokit, 'owner', 'repo', 'target', { [path]: 'verified-marker' })
    ).rejects.toThrow('changed since verification');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('does not recreate a file removed after its SHA was verified', async () => {
    const path = Object.keys(getAcrBuildFiles())[0];
    await expect(
      publishAcrBuildFiles(octokit, 'owner', 'repo', 'target', { [path]: 'verified-marker' })
    ).rejects.toThrow('changed since verification');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('passes the verified SHA to the conditional Contents write', async () => {
    const path = Object.keys(getAcrBuildFiles())[0];
    getContent.mockImplementation(async ({ path: file }) => ({
      data: { type: 'file', sha: file === path ? 'verified-marker' : 'other' },
    }));
    await publishAcrBuildFiles(octokit, 'owner', 'repo', 'target', { [path]: 'verified-marker' });
    expect(writeFile.mock.calls[0].at(-1)).toBe('verified-marker');
  });
});
