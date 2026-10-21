// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupDispatched,
  waitForAcrRun,
  type AcrRun,
  type Evidence,
  type WorkflowRun,
} from './acr-workflow';

function fixture() {
  const github: WorkflowRun = {
    id: 1,
    sha: 'a'.repeat(40),
    status: 'in_progress',
    conclusion: null,
    url: 'https://github.com/example/sandbox/actions/runs/1',
  };
  const acr: AcrRun = { id: 'one', status: 'Running', images: [] };
  const evidence: Evidence = {
    scenario: 'cancel',
    generatorRevision: 'source',
    generatorDirty: true,
    imageName: 'rest29-test',
    fixtureSha: github.sha,
    verdict: 'failed',
    cleanupErrors: [],
  };
  const actions: string[] = [];
  const client = {
    findWorkflow: async (): Promise<WorkflowRun | undefined> => github,
    workflow: async () => github,
    runs: async (): Promise<AcrRun[]> => [acr],
    run: async () => acr,
    cancelWorkflow: async () => {
      actions.push('cancel-github');
      github.status = 'completed';
    },
    cancelAcr: async () => {
      actions.push('cancel-acr');
      acr.status = 'Canceled';
    },
    deleteImage: async (image: string) => {
      actions.push(`delete:${image}`);
    },
  };
  return { github, acr, evidence, actions, client };
}

test('accepted dispatch recovery waits for delayed GitHub and ACR visibility', async () => {
  const { client, evidence, actions, github, acr } = fixture();
  let githubReads = 0;
  let acrReads = 0;
  client.findWorkflow = async () => (++githubReads < 3 ? undefined : github);
  client.runs = async () => (++acrReads < 3 ? [] : [acr]);
  await cleanupDispatched(client, evidence, new Set(), 200, 0);
  assert.equal(githubReads, 3);
  assert.equal(acrReads, 3);
  assert.deepEqual(actions, ['cancel-github', 'cancel-acr']);
  assert.equal(evidence.verdict, 'failed');
});

test('ACR discovery keeps polling when the workflow completes before the run listing is visible', async () => {
  const { client, github, acr } = fixture();
  let reads = 0;
  client.runs = async () => {
    github.status = 'completed';
    return ++reads < 3 ? [] : [acr];
  };

  assert.equal((await waitForAcrRun(client, new Set(), Date.now() + 200, 0)).id, acr.id);
  assert.equal(github.status, 'completed');
  assert.equal(reads, 3);
});

test('ACR discovery reports its deadline instead of succeeding with an absent run', async () => {
  const { client } = fixture();
  let reads = 0;
  client.runs = async () => {
    reads++;
    return [];
  };

  await assert.rejects(waitForAcrRun(client, new Set(), Date.now() + 5, 0), /Timed out/);
  assert.ok(reads > 1);
});

test('unresolved accepted dispatch fails cleanup and prevents treating the sandbox as idle', async () => {
  const { client, evidence, actions } = fixture();
  client.findWorkflow = async () => undefined;
  client.runs = async () => [];
  await assert.rejects(cleanupDispatched(client, evidence, new Set(), 5, 0), /Unresolved dispatch/);
  assert.equal(evidence.cleanupErrors.length, 2);
  assert.match(evidence.cleanupErrors.join(), /Timed out/);
  assert.deepEqual(actions, []);
});

test('cleanup still recovers an ACR run after GitHub dispatch discovery times out', async () => {
  const { client, evidence, actions } = fixture();
  client.findWorkflow = async () => undefined;
  await assert.rejects(cleanupDispatched(client, evidence, new Set(), 5, 0), /Unresolved dispatch/);
  assert.deepEqual(actions, ['cancel-acr']);
});

test('cleanup refuses to act before the test verdict is recorded', async () => {
  const { client, evidence, actions } = fixture();
  evidence.verdict = undefined;
  await assert.rejects(cleanupDispatched(client, evidence, new Set()), /Record the verdict/);
  assert.deepEqual(actions, []);
});

test('ambiguous ACR work is not cancelled and cleanup is marked unresolved', async () => {
  const { client, evidence, actions, acr } = fixture();
  client.runs = async () => [acr, { ...acr, id: 'unrelated' }];
  await assert.rejects(cleanupDispatched(client, evidence, new Set()), /Unresolved dispatch/);
  assert.match(evidence.cleanupErrors.join(), /exclusive-registry/);
  assert.ok(!actions.includes('cancel-acr'));
});

test('terminal test images are removed by exact SHA without changing a failed verdict', async () => {
  const { client, evidence, github, acr, actions } = fixture();
  github.status = 'completed';
  acr.status = 'Succeeded';
  acr.images = [{ repository: evidence.imageName, tag: evidence.fixtureSha! }];
  evidence.githubRun = github;
  evidence.acrRun = acr;
  await cleanupDispatched(client, evidence, new Set());
  assert.deepEqual(actions, [`delete:rest29-test:${evidence.fixtureSha}`]);
  assert.equal(evidence.verdict, 'failed');
});
