// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { on, once } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createOctokitClient } from '../../plugins/aks-desktop/src/utils/github/github-api';
import { requestDeadline } from './acr-interruption';
import { waitFor } from './acr-workflow';
import { runSuite } from './run-azure';

test('real Octokit fetch receives fresh request deadlines and honors timeout/caller abort', async () => {
  const client = createOctokitClient('offline-test-token');
  client.hook.before('request', options => requestDeadline(options, 20));
  const signals: AbortSignal[] = [];
  const fetchRequest: typeof fetch = async (_url, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    signals.push(signal);
    if (signals.length <= 2) {
      return new Response('{}', {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
    });
  };
  const request = (signal?: AbortSignal) =>
    client.request('GET /user', { request: { fetch: fetchRequest, signal } });
  await request();
  await request();
  assert.notEqual(signals[0], signals[1]);
  // Keep the process alive while AbortSignal.timeout's unref'ed timer expires.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(request(), /timeout|aborted/i);
    assert.equal(signals[2].aborted, true);
    const caller = new AbortController();
    const pending = request(caller.signal);
    await new Promise(resolve => setImmediate(resolve));
    caller.abort(new Error('caller cancelled'));
    await assert.rejects(pending, /caller cancelled/);
    assert.equal(signals[3].aborted, true);
    assert.notEqual(signals[3], caller.signal);
    const alreadyAborted = AbortSignal.abort(new Error('already cancelled'));
    await assert.rejects(request(alreadyAborted), /already cancelled/);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('normal polling aborts a pending sleep without another read', async () => {
  const controller = new AbortController();
  let reads = 0;
  const pending = waitFor(
    'offline probe',
    async () => ++reads,
    () => false,
    Date.now() + 60_000,
    60_000,
    controller.signal
  );
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('interrupted'));
  await assert.rejects(pending, /abort/i);
  assert.equal(reads, 1);
});

test('Octokit calls without request options do not inherit an earlier request deadline', async () => {
  const signals: AbortSignal[] = [];
  const fetchRequest: typeof fetch = async (_url, init) => {
    assert.ok(init?.signal);
    signals.push(init.signal);
    if (init.signal.aborted) throw init.signal.reason;
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  const client = createOctokitClient('offline-test-token');
  client.request = client.request.defaults({ request: { fetch: fetchRequest } });
  client.hook.before('request', options => requestDeadline(options, 15));
  await client.request('GET /user');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(signals[0].aborted, true);
  await client.request('GET /user');
  assert.notEqual(signals[0], signals[1]);
  assert.equal(signals[1].aborted, false);
  assert.equal(client.request.endpoint.DEFAULTS.request?.signal, undefined);
});

test('aborted normal work awaits its active reader before entering recovery', async () => {
  const controller = new AbortController();
  let finish!: () => void;
  let settled = false;
  const pending = waitFor(
    'accepted write',
    () =>
      new Promise<number>(resolve => {
        finish = () => resolve(1);
      }),
    () => true,
    Date.now() + 60_000,
    0,
    controller.signal
  ).finally(() => {
    settled = true;
  });
  controller.abort(new Error('interrupted'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  finish();
  await assert.rejects(pending, /interrupted/);
});

test('real offline child survives IPC/OS interruption, recovers accepted work and fails', async t => {
  const root = path.resolve(__dirname, '../..');
  const outputDir = path.join(root, 'out', `acr-interruption-test-${randomUUID()}`);
  await fs.mkdir(outputDir, { recursive: true });
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  for (const stage of ['early', 'publication', 'dispatch', 'probe', 'cleanup']) {
    const evidenceFile = path.join(outputDir, `${stage}.json`);
    const script = `
      const { liveInterruption } = require('./test/e2e/acr-interruption.ts');
      const { waitFor, cleanupDispatched } = require('./test/e2e/acr-workflow.ts');
      const interruption = liveInterruption();
      const { signal } = interruption;
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const stage = ${JSON.stringify(stage)};
      const evidence = { scenario:'cancel', generatorRevision:'offline', generatorDirty:false,
        imageName:'rest29-offline', fixtureSha:'a'.repeat(40), cleanupErrors:[] };
      let dispatched = false, cancelled = false, workflowReads = 0, acrReads = 0;
      let ready = false;
      const announce = () => { if (!ready) { ready=true; process.send('ready'); } };
      const github = () => ({ id:1, sha:evidence.fixtureSha,
        status:cancelled?'completed':'in_progress', conclusion:null, url:'offline' });
      const acr = () => ({ id:'one', status:cancelled?'Canceled':'Running', images:[] });
      const client = {
        findWorkflow:async () => ++workflowReads < 3 ? undefined : github(),
        workflow:async () => github(),
        runs:async () => ++acrReads < 3 ? [] : [acr()], run:async () => acr(),
        cancelWorkflow:async () => {
          if (stage === 'cleanup') { announce(); await pause(75); }
          cancelled=true; console.log('CANCELLED_OWNED_WORK');
        },
        cancelAcr:async () => { cancelled=true; },
        deleteImage:async () => { throw Error('unexpected image'); },
      };
      (async () => {
        try {
          if (stage === 'early') {
            announce();
            await waitFor('before publication', async () => false, Boolean, Date.now()+10000, 10000, signal);
          }
          if (stage === 'publication') { announce(); await pause(75); }
          signal.throwIfAborted();
          dispatched=true;
          console.log('DISPATCH');
          if (stage === 'dispatch') { announce(); await pause(75); }
          signal.throwIfAborted();
          if (stage === 'cleanup') throw Error('fixture failed');
          announce();
          await waitFor('probe', async () => false, Boolean, Date.now()+10000, 10000, signal);
        } catch (error) {
          evidence.verdict='failed'; evidence.error=String(error); process.exitCode=1;
        } finally {
          if (dispatched) await cleanupDispatched(client, evidence, new Set(), 200, 0);
          require('node:fs').writeFileSync(${JSON.stringify(
            evidenceFile
          )}, JSON.stringify(evidence));
          console.log('DURABLE_EVIDENCE:'+JSON.stringify(evidence));
          console.log('CLEANUP_COMPLETED');
          interruption.dispose();
          process.disconnect();
        }
      })().catch(error => { console.error(error); process.exitCode=1; });
    `;
    let child!: ReturnType<typeof spawn>;
    let output = '';
    const launch = ((binary, args, options) => {
      child = spawn(binary, args, {
        ...options,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      child.stdout!.on('data', data => {
        output += data;
      });
      child.stderr!.on('data', data => {
        output += data;
      });
      return child;
    }) as typeof spawn;
    const pending = runSuite(
      ['--import', pathToFileURL(require.resolve('tsx')).href, '-e', script],
      root,
      { ...process.env, PATH: '' },
      launch,
      { cooperative: true, graceMs: 10_000 }
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    let ready = false;
    try {
      for await (const [message] of on(child, 'message', {
        signal: AbortSignal.timeout(10_000),
        close: ['close'],
      })) {
        if (message === 'ready') {
          ready = true;
          break;
        }
      }
    } catch (error) {
      throw new Error(`Interruption fixture ${stage} did not become ready:\n${output}`, {
        cause: error,
      });
    }
    assert.ok(ready, `Interruption fixture ${stage} exited before readiness:\n${output}`);
    process.emit('SIGTERM');
    process.emit('SIGINT');
    if (process.platform !== 'win32') child.kill('SIGINT');
    const result = await pending;
    assert.deepEqual(result, { code: 1, signal: 'SIGTERM' }, output);
    assert.match(output, /CLEANUP_COMPLETED/);
    assert.match(output, /DURABLE_EVIDENCE:.*"verdict":"failed"/);
    assert.equal(JSON.parse(await fs.readFile(evidenceFile, 'utf8')).verdict, 'failed');
    const dispatched = !['early', 'publication'].includes(stage);
    assert.equal((output.match(/^DISPATCH$/gm) ?? []).length, dispatched ? 1 : 0);
    if (dispatched) assert.match(output, /CANCELLED_OWNED_WORK/);
  }
});

test('real unresponsive owned child is forcibly stopped after cooperative grace', async t => {
  let child!: ReturnType<typeof spawn>;
  const launch = ((binary, args, options) => {
    child = spawn(binary, args, {
      ...options,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    return child;
  }) as typeof spawn;
  const pending = runSuite(
    ['-e', "process.on('message',()=>{});process.send('ready');setInterval(()=>{},1000)"],
    path.resolve(__dirname, '../..'),
    { ...process.env, PATH: '' },
    launch,
    { cooperative: true, graceMs: 30 }
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  await once(child, 'message', { signal: AbortSignal.timeout(10_000) });
  process.emit('SIGTERM');
  assert.equal(child.signalCode, null, 'the first signal must allow cooperative recovery');
  const result = await pending;
  assert.equal(result.signal, 'SIGTERM');
  assert.notEqual(result.code, 0);
  assert.ok(child.signalCode || child.exitCode !== 0);
});
