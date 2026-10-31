// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ACR_BUILD_SCRIPT_PATH,
  getAcrBuildFiles,
} from '../../plugins/aks-desktop/src/components/GitHubPipeline/utils/acrTasks/acrTaskRunner';
import {
  createOctokitClient,
  createOrUpdateFile,
} from '../../plugins/aks-desktop/src/utils/github/github-api';
import { verifyRuntimePublication } from './acr-publication';

const config = { repository: 'example/sandbox', branch: 'aksd-acr-e2e-publication' };
const bundle = getAcrBuildFiles();
const entries = Object.entries(bundle);
const target = ACR_BUILD_SCRIPT_PATH;
const blobSha = (content: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest('hex');
const httpError = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

interface Call {
  method: string;
  path: string;
  sha?: unknown;
  content?: string;
}
interface Content {
  path: string;
  type: string;
  sha: string;
  encoding: string;
  content: string;
}

function fixture(existing = false) {
  const files = new Map<string, string>(existing ? entries : []);
  const calls: Call[] = [];
  const writes: Call[] = [];
  const state = {
    defaultBranch: 'main',
    fullName: config.repository,
    fail: (_call: Call): Error | undefined => undefined,
    afterWrite: (_call: Call): void => {},
    read: (_call: Call, file: Content): Content => file,
  };
  const octokit = createOctokitClient('unused-local-test-token');
  // Only the transport is replaced: both production publishing helpers run unchanged.
  octokit.hook.wrap('request', async (_request, options) => {
    assert.equal(options.owner, 'example');
    assert.equal(options.repo, 'sandbox');
    const response = (data: unknown) => ({ status: 200, url: options.url, headers: {}, data });
    if (options.url === '/repos/{owner}/{repo}') {
      assert.equal(options.method, 'GET');
      return response({ full_name: state.fullName, default_branch: state.defaultBranch });
    }
    assert.equal(options.url, '/repos/{owner}/{repo}/contents/{path}');
    assert.ok(typeof options.path === 'string' && Object.hasOwn(bundle, options.path));
    const path = options.path;
    const call: Call = { method: options.method, path, sha: options.sha };
    if (options.method === 'PUT') {
      assert.equal(options.branch, config.branch);
      assert.ok(typeof options.content === 'string');
      call.content = Buffer.from(options.content, 'base64').toString('utf8');
    } else {
      assert.equal(options.method, 'GET');
      assert.equal(options.ref, config.branch);
    }
    calls.push(call);
    const error = state.fail(call);
    if (error) throw error;
    const current = files.get(path);
    if (call.method === 'GET') {
      if (current === undefined) throw httpError('Not found', 404);
      return response(
        state.read(call, {
          path,
          type: 'file',
          sha: blobSha(current),
          encoding: 'base64',
          content: Buffer.from(current)
            .toString('base64')
            .match(/.{1,60}/g)!
            .join('\n'),
        })
      );
    }
    if (options.sha !== (current === undefined ? undefined : blobSha(current))) {
      throw httpError('Write requires current SHA', 409);
    }
    assert.ok(call.content !== undefined);
    files.set(path, call.content);
    writes.push(call);
    state.afterWrite(call);
    return response({ content: { path, sha: blobSha(call.content) } });
  });
  return { octokit, files, calls, writes, state };
}

for (const existing of [false, true]) {
  test(`production publication installs, reruns and restores outdated runtime (existing=${existing})`, async () => {
    const { octokit, files, writes } = fixture(existing);
    await verifyRuntimePublication(octokit, config);
    assert.deepEqual(Object.fromEntries(files), bundle);
    assert.equal(writes.length, entries.length * 3 + 1);
    for (const write of writes.slice(0, entries.length)) {
      assert.equal(write.sha, existing ? blobSha(bundle[write.path]) : undefined);
    }
    for (const write of writes.slice(entries.length)) assert.ok(write.sha);
    const outdated = writes[entries.length * 2];
    assert.equal(outdated.path, target);
    assert.notEqual(outdated.content, bundle[target]);
    const restored = writes[entries.length * 2 + 1];
    assert.equal(restored.path, target);
    assert.equal(restored.sha, blobSha(outdated.content!));
    assert.equal(restored.content, bundle[target]);
  });
}

test('the real Contents writer rejects missing or outdated SHA for existing runtime', async () => {
  const { octokit, writes } = fixture(true);
  for (const sha of [undefined, '0'.repeat(40)]) {
    await assert.rejects(
      createOrUpdateFile(
        octokit,
        'example',
        'sandbox',
        target,
        bundle[target],
        'test',
        config.branch,
        sha
      ),
      /Write requires current SHA/
    );
  }
  assert.equal(writes.length, 0);
  await verifyRuntimePublication(octokit, config);
});

test('invalid repository or non-sandbox branch fails before any GitHub request', async () => {
  const { octokit } = fixture();
  octokit.hook.wrap('request', async () => {
    throw new Error('Must not request');
  });
  for (const invalid of [
    { ...config, repository: 'example/sandbox/extra' },
    { ...config, branch: 'main' },
    { ...config, branch: 'aksd-acr-e2e/../main' },
  ]) {
    await assert.rejects(verifyRuntimePublication(octokit, invalid), /Expected|dedicated/);
  }
});

test('repository metadata mismatch and an actual default sandbox branch fail before writes', async () => {
  for (const change of ['repository', 'default']) {
    const { octokit, state, writes } = fixture();
    if (change === 'repository') state.fullName = 'other/repository';
    else state.defaultBranch = config.branch;
    await assert.rejects(
      verifyRuntimePublication(octokit, config),
      /Repository mismatch|default branch/
    );
    assert.equal(writes.length, 0);
  }
});

for (const method of ['GET', 'PUT']) {
  test(`production publisher propagates ${method} errors without treating them as missing files`, async () => {
    const { octokit, state, writes } = fixture();
    state.fail = call => (call.method === method ? httpError('Access denied', 403) : undefined);
    await assert.rejects(verifyRuntimePublication(octokit, config), /Access denied/);
    assert.equal(writes.length, 0);
  });
}

test('an unchanged-bundle rerun write failure cannot pass acceptance', async () => {
  const { octokit, state, writes } = fixture();
  state.fail = call =>
    writes.length === entries.length && call.method === 'PUT'
      ? httpError('Rerun denied', 409)
      : undefined;
  await assert.rejects(verifyRuntimePublication(octokit, config), /Rerun denied/);
  assert.equal(writes.length, entries.length);
});

test('a publisher lookup failure after the outdated write is repaired and still rejects', async () => {
  const { octokit, state, files, writes } = fixture();
  const failure = httpError('Lookup unavailable', 503);
  let reads = 0;
  state.fail = call => {
    if (writes.length === entries.length * 2 + 1 && call.method === 'GET' && call.path === target) {
      if (++reads === 2) return failure;
    }
    return undefined;
  };
  await assert.rejects(verifyRuntimePublication(octokit, config), error => error === failure);
  assert.deepEqual(Object.fromEntries(files), bundle);
  assert.equal(writes.at(-1)?.sha, blobSha(writes[entries.length * 2].content!));
});

test('an accepted outdated write with a lost response is repaired without masking failure', async () => {
  const { octokit, state, files } = fixture();
  state.afterWrite = call => {
    if (call.content !== bundle[call.path]) throw new Error('Response lost');
  };
  await assert.rejects(verifyRuntimePublication(octokit, config), /Response lost/);
  assert.deepEqual(Object.fromEntries(files), bundle);
});

test('repair refuses to overwrite an unexpected concurrent runtime change', async () => {
  const { octokit, state, files, writes } = fixture();
  let corrupted = false;
  state.afterWrite = call => {
    if (!corrupted && call.path === target && writes.length === entries.length * 2 + 2) {
      files.set(target, '# Still outdated\n');
      corrupted = true;
    }
  };
  await assert.rejects(verifyRuntimePublication(octokit, config), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /Runtime content mismatch/);
    assert.match(error.errors[1].message, /refusing to overwrite/);
    return true;
  });
  assert.ok(corrupted);
  assert.equal(files.get(target), '# Still outdated\n');
  assert.equal(writes.length, entries.length * 3 + 1);
});

test('repair failure explicitly aggregates the original publisher failure', async () => {
  const { octokit, state, files, writes } = fixture();
  const failure = httpError('Lookup unavailable', 503);
  let reads = 0;
  state.fail = call => {
    if (writes.length !== entries.length * 2 + 1 || call.path !== target) return undefined;
    if (call.method === 'GET' && ++reads === 2) return failure;
    if (call.method === 'PUT') return httpError('Repair denied', 403);
    return undefined;
  };
  await assert.rejects(verifyRuntimePublication(octokit, config), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], failure);
    assert.match(error.errors[1].message, /Repair denied/);
    return true;
  });
  assert.notEqual(files.get(target), bundle[target]);
});

for (const field of ['path', 'encoding', 'sha', 'content'] as const) {
  test(`bundle verification rejects an incorrect Contents response ${field}`, async () => {
    const { octokit, state, writes } = fixture();
    state.read = (_call, file) => {
      if (writes.length === entries.length) {
        return { ...file, [field]: field === 'sha' ? '0'.repeat(40) : 'incorrect' };
      }
      return file;
    };
    await assert.rejects(verifyRuntimePublication(octokit, config), /Runtime|runtime/);
    assert.equal(writes.length, entries.length);
  });
}
