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

test('GitHub timeout does not consume the separate ACR recovery budget', async () => {
  const { client, evidence, actions, acr } = fixture();
  client.findWorkflow = async () => undefined;
  let reads = 0;
  client.runs = async () => (++reads < 3 ? [] : [acr]);
  await assert.rejects(
    cleanupDispatched(client, evidence, new Set(), 100, 0),
    /Unresolved dispatch/
  );
  assert.equal(reads, 3);
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
  const digest = `sha256:${'b'.repeat(64)}`;
  acr.images = [{ repository: evidence.imageName, tag: evidence.fixtureSha!, digest }];
  evidence.githubRun = github;
  evidence.acrRun = acr;
  await cleanupDispatched(client, evidence, new Set());
  assert.deepEqual(actions, [`delete:rest29-test:${evidence.fixtureSha}`]);
  assert.equal(evidence.verdict, 'failed');
});

test('cleanup refuses image deletion without a run-reported immutable digest', async () => {
  const { client, evidence, github, acr, actions } = fixture();
  github.status = 'completed';
  acr.status = 'Succeeded';
  acr.images = [{ repository: evidence.imageName, tag: evidence.fixtureSha! }];
  await assert.rejects(cleanupDispatched(client, evidence, new Set()), /Unresolved dispatch/);
  assert.ok(!actions.some(action => action.startsWith('delete:')));
  assert.match(evidence.cleanupErrors.join(), /Missing immutable output digest/);
});

test('cleanup does not cancel a GitHub run whose fixture identity changed', async () => {
  const { client, evidence, github, actions } = fixture();
  github.sha = 'b'.repeat(40);
  evidence.githubRun = github;
  await assert.rejects(cleanupDispatched(client, evidence, new Set()), /Unresolved dispatch/);
  assert.ok(!actions.includes('cancel-github'));
  assert.ok(actions.includes('cancel-acr'));
  assert.match(evidence.cleanupErrors.join(), /fixture mismatch/);
});

test('cleanup never cancels a registry run present before the dispatch', async () => {
  const { client, evidence, acr, actions } = fixture();
  evidence.acrRun = acr;
  await assert.rejects(
    cleanupDispatched(client, evidence, new Set([acr.id])),
    /Unresolved dispatch/
  );
  assert.ok(!actions.includes('cancel-acr'));
  assert.match(evidence.cleanupErrors.join(), /pre-dispatch ACR run/);
});

test('fresh run identity is checked before requesting ACR cancellation', async () => {
  const { client, evidence, acr, actions } = fixture();
  evidence.acrRun = acr;
  client.run = async () => ({ ...acr, id: 'unrelated' });
  await assert.rejects(cleanupDispatched(client, evidence, new Set()), /Unresolved dispatch/);
  assert.ok(!actions.includes('cancel-acr'));
  assert.match(evidence.cleanupErrors.join(), /run mismatch/);
});

test('unexpected output artifacts are preserved and reported as cleanup errors', async () => {
  const { client, evidence, github, acr, actions } = fixture();
  github.status = 'completed';
  acr.status = 'Succeeded';
  acr.images = [{ repository: 'unrelated', tag: 'keep', digest: `sha256:${'b'.repeat(64)}` }];
  evidence.acrRun = acr;
  await assert.rejects(cleanupDispatched(client, evidence, new Set()), /Unresolved dispatch/);
  assert.ok(!actions.some(action => action.startsWith('delete:')));
  assert.match(evidence.cleanupErrors.join(), /unowned artifacts/);
});

test('recovery records fresh terminal snapshots without changing the failed verdict', async () => {
  const { client, evidence, github, acr } = fixture();
  client.workflow = async () => ({ ...github, status: 'completed', conclusion: 'cancelled' });
  client.run = async () => ({ ...acr, status: 'Canceled' });
  await cleanupDispatched(client, evidence, new Set());
  assert.equal(evidence.githubRun?.status, 'completed');
  assert.equal(evidence.acrRun?.status, 'Canceled');
  assert.equal(evidence.verdict, 'failed');
});
