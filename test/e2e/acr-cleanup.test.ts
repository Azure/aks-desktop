// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServices,
  LiveTestPermissionError,
  parseAcrRun,
  RegistryArtifactNotFoundError,
  type Command,
} from './acr-services';
import { readConfig, WORKFLOW_PATH } from './acr-workflow';

const config = readConfig({
  AKSD_E2E_REPOSITORY: 'example/sandbox',
  AKSD_E2E_BRANCH: 'aksd-acr-e2e',
  AKSD_E2E_ACR_RESOURCE_ID:
    '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test-rg/providers/Microsoft.ContainerRegistry/registries/testregistry',
  AKSD_E2E_ACR_LOGIN_SERVER: 'testregistry.azurecr.io',
  AKSD_E2E_EXCLUSIVE_REGISTRY: '1',
});
const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const image = `rest29-owned:${sha}`;
const immutable = `rest29-owned@${digest}`;

function registry() {
  const images = new Map<string, Record<string, unknown>>([
    [image, { digest }],
    [immutable, { digest, tags: [sha] }],
  ]);
  const deletes: string[] = [];
  const state = {
    readError: undefined as Error | undefined,
    retainAfterDelete: false,
    afterDelete: () => {},
  };
  const execute: Command = async (binary, args) => {
    assert.equal(binary, 'az');
    assert.deepEqual(args.slice(0, 2), ['acr', 'repository']);
    const target = args[args.indexOf('--image') + 1];
    if (args[2] === 'show') {
      if (state.readError) throw state.readError;
      if (!images.has(target)) throw new RegistryArtifactNotFoundError('MANIFEST_UNKNOWN');
      return JSON.stringify(images.get(target));
    }
    assert.equal(args[2], 'delete');
    assert.ok(args.includes('--yes'));
    deletes.push(target);
    if (!state.retainAfterDelete) {
      for (const [key, value] of images) if (value.digest === digest) images.delete(key);
    }
    state.afterDelete();
    return '';
  };
  return { client: createServices(config, '/unused', execute), images, deletes, state };
}

test('image cleanup deletes only the run-reported digest and verifies tag/digest absence', async () => {
  const { client, images, deletes } = registry();
  await client.deleteImage(image, digest);
  assert.deepEqual(deletes, [immutable]);
  assert.equal(images.size, 0);
});

test('repeating cleanup of an already absent image is an explicit safe no-op', async () => {
  const { client, deletes } = registry();
  await client.deleteImage(image, digest);
  await client.deleteImage(image, digest);
  assert.deepEqual(deletes, [immutable]);
});

test('cleanup refuses a manifest shared with any unowned alias', async () => {
  const { client, images, deletes } = registry();
  images.set(immutable, { digest, tags: [sha, 'keep-this-tag'] });
  await assert.rejects(client.deleteImage(image, digest), /other tags/);
  assert.deepEqual(deletes, []);
});

test('a mutable fixture tag cannot redirect deletion to another digest', async () => {
  const { client, images, deletes } = registry();
  images.set(image, { digest: `sha256:${'c'.repeat(64)}` });
  await assert.rejects(client.deleteImage(image, digest), /tag changed/);
  assert.deepEqual(deletes, []);
});

test('cleanup does not follow a tag rebound after the owned digest was deleted', async () => {
  const { client, images, deletes, state } = registry();
  state.afterDelete = () => images.set(image, { digest: `sha256:${'c'.repeat(64)}` });
  await assert.rejects(client.deleteImage(image, digest), /tag remains or changed/);
  assert.deepEqual(deletes, [immutable]);
  assert.equal(images.get(image)?.digest, `sha256:${'c'.repeat(64)}`);
});

test('a successful deletion response is insufficient if the artifact remains', async () => {
  const { client, state } = registry();
  state.retainAfterDelete = true;
  await assert.rejects(client.deleteImage(image, digest), /digest remains/);
});

for (const error of [new LiveTestPermissionError('Forbidden'), new Error('HTTP 500')]) {
  test(`cleanup never treats ${error.name} as an absent image`, async () => {
    const { client, deletes, state } = registry();
    state.readError = error;
    await assert.rejects(client.deleteImage(image, digest), value => value === error);
    assert.deepEqual(deletes, []);
  });
}

for (const metadata of [
  { digest, tags: 'invalid' },
  { digest, tags: [42] },
  { digest: `sha256:${'c'.repeat(64)}`, tags: [sha] },
]) {
  test(`invalid ownership metadata fails closed: ${JSON.stringify(metadata)}`, async () => {
    const { client, images, deletes } = registry();
    images.set(immutable, metadata);
    await assert.rejects(client.deleteImage(image, digest));
    assert.deepEqual(deletes, []);
  });
}

test('run parsing preserves the immutable digest needed for cleanup', () => {
  assert.deepEqual(
    parseAcrRun({
      properties: {
        runId: 'ca1',
        status: 'Succeeded',
        outputImages: [{ repository: 'rest29-owned', tag: sha, digest }],
      },
    }).images,
    [{ repository: 'rest29-owned', tag: sha, digest }]
  );
  assert.throws(() => parseAcrRun({ properties: { runId: '../other', status: 'Running' } }));
});

for (const [field, value] of [
  ['id', 999],
  ['head_sha', 'c'.repeat(40)],
  ['head_branch', 'main'],
  ['path', '.github/workflows/production.yml'],
  ['event', 'push'],
] as const) {
  test(`GitHub cancellation refuses an unrelated ${field}`, async () => {
    const calls: string[][] = [];
    const execute: Command = async (_binary, args) => {
      calls.push(args);
      return JSON.stringify({
        id: 123,
        head_sha: sha,
        head_branch: config.branch,
        path: WORKFLOW_PATH,
        event: 'workflow_dispatch',
        status: 'in_progress',
        [field]: value,
      });
    };
    await assert.rejects(
      createServices(config, '/unused', execute).cancelWorkflow(123, sha),
      /Refusing cancellation/
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('GET'));
  });
}

test('GitHub cancellation reads and verifies the owned fixture before posting', async () => {
  const calls: string[][] = [];
  const execute: Command = async (_binary, args) => {
    calls.push(args);
    return JSON.stringify({
      id: 123,
      head_sha: sha,
      head_branch: config.branch,
      path: WORKFLOW_PATH,
      event: 'workflow_dispatch',
      status: 'in_progress',
    });
  };
  await createServices(config, '/unused', execute).cancelWorkflow(123, sha);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('GET'));
  assert.ok(calls[1].includes('POST'));
});

test('a verified workflow that completed during cleanup is not cancelled again', async () => {
  const calls: string[][] = [];
  const execute: Command = async (_binary, args) => {
    calls.push(args);
    return JSON.stringify({
      id: 123,
      head_sha: sha,
      head_branch: config.branch,
      path: WORKFLOW_PATH,
      event: 'workflow_dispatch',
      status: 'completed',
    });
  };
  await createServices(config, '/unused', execute).cancelWorkflow(123, sha);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('GET'));
});

test('unsafe run identifiers are rejected before any remote operation', async () => {
  const client = createServices(config, '/unused', async () => {
    throw new Error('Must not execute');
  });
  for (const id of ['..', '../other', 'runs/other', '']) {
    await assert.rejects(client.cancelAcr(id), /Invalid ACR run ID/);
    await assert.rejects(client.run(id), /Invalid ACR run ID/);
  }
});
