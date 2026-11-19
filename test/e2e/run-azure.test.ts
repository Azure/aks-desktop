// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { ChildProcess, spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { INTERRUPTION_MESSAGE, INTERRUPTION_READY } from './acr-interruption';
import { parseSuite, runAzure, runSuite, stopChild } from './run-azure';

const root = path.resolve(__dirname, '../..');
const env = {
  AKSD_E2E_REPOSITORY: 'example/sandbox',
  AKSD_E2E_BRANCH: 'aksd-acr-e2e',
  AKSD_E2E_ACR_RESOURCE_ID:
    '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test-rg/providers/Microsoft.ContainerRegistry/registries/testregistry',
  AKSD_E2E_ACR_LOGIN_SERVER: 'testregistry.azurecr.io',
  AKSD_E2E_EXCLUSIVE_REGISTRY: '1',
};

function driver() {
  const calls: Array<{
    binary: string;
    args: string[];
    options: SpawnOptions;
    child: ChildProcess & { messages: unknown[] };
    signals: NodeJS.Signals[];
  }> = [];
  const launch = ((
    binary: string,
    argsOrOptions: string[] | SpawnOptions = [],
    options: SpawnOptions = {}
  ) => {
    const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
    options = Array.isArray(argsOrOptions) ? options : argsOrOptions;
    const signals: NodeJS.Signals[] = [];
    const messages: unknown[] = [];
    const child = Object.assign(new ChildProcess(), {
      connected: true,
      messages,
      send: (message: unknown, callback?: () => void) => {
        messages.push(message);
        callback?.();
        return true;
      },
      kill: (signal: NodeJS.Signals) => {
        signals.push(signal);
        return true;
      },
    });
    calls.push({ binary, args, options, child, signals });
    return child;
  }) as typeof spawn;
  return { calls, launch };
}

test('suite parser defaults to all and accepts explicit suite selectors', () => {
  assert.equal(parseSuite([]), 'all');
  for (const suite of ['rest', 'acr', 'all']) {
    assert.equal(parseSuite(['--suite', suite]), suite);
    assert.equal(parseSuite([`--suite=${suite}`]), suite);
  }
});

test('suite parser rejects unknown, missing, duplicate and contradictory arguments', () => {
  for (const args of [
    ['rest'],
    ['--unknown'],
    ['--suite'],
    ['--suite='],
    ['--suite', 'other'],
    ['--suite', 'rest', '--suite', 'acr'],
    ['--suite=all', '--suite=rest'],
    ['--suite', 'rest', '--unknown'],
    ['--', '--suite', 'acr'],
  ]) {
    assert.throws(() => parseSuite(args), /Usage: npm run test:e2e:azure/);
  }
});

test('invalid selected configuration fails before starting any child, even for all', async () => {
  for (const args of [[], ['--suite', 'all'], ['--suite', 'acr']]) {
    for (const invalid of [
      {},
      { ...env, AKSD_E2E_EXCLUSIVE_REGISTRY: '0' },
      { ...env, AKSD_E2E_BRANCH: 'main' },
      { ...env, AKSD_E2E_ACR_LOGIN_SERVER: 'https://other.azurecr.io' },
      { ...env, AKSD_E2E_ACR_RESOURCE_ID: 'invalid' },
    ]) {
      const { launch, calls } = driver();
      await assert.rejects(runAzure(args, invalid, launch));
      assert.equal(calls.length, 0);
    }
  }
  const { launch, calls } = driver();
  await assert.rejects(runAzure(['--suite', 'rest', '--suite', 'acr'], env, launch), /Usage/);
  assert.equal(calls.length, 0);
});

test('REST selects only read-only transport tests, not mutating live suites', async () => {
  const originalGuard = process.env.AZ_LIVE_TESTS;
  const parentEnv = {
    AZ_LIVE_TESTS: '0',
    AZ_LIVE_SUBSCRIPTION: 'existing-subscription',
  };
  const { launch, calls } = driver();
  const pending = runAzure(['--suite', 'rest'], parentEnv, launch);
  assert.equal(calls.length, 1);
  const { binary, args, options, child } = calls[0];
  const plugin = path.join(root, 'plugins/aks-desktop');
  assert.equal(binary, process.execPath);
  assert.equal(args[0], path.join(plugin, 'node_modules/vitest/vitest.mjs'));
  assert.deepEqual(args.slice(1, 6), ['run', '-c', 'vitest.config.ts', '--project', 'unit']);
  assert.deepEqual(args.slice(6), ['src/utils/azure/az-http.live.test.ts']);
  assert.equal(options.cwd, plugin);
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.detached, process.platform !== 'win32');
  assert.deepEqual(options.env, { ...parentEnv, AZ_LIVE_TESTS: '1' });
  assert.deepEqual(parentEnv, {
    AZ_LIVE_TESTS: '0',
    AZ_LIVE_SUBSCRIPTION: 'existing-subscription',
  });
  assert.equal(process.env.AZ_LIVE_TESTS, originalGuard);
  child.emit('close', 0, null);
  assert.deepEqual(await pending, { code: 0, signal: null });
});

test('ACR accepts a DNL login host and uses Node+tsx with the canonical child guard', async () => {
  const dnlEnv = {
    ...env,
    AKSD_E2E_ACR_LOGIN_SERVER: 'testregistry-a1b2c3d4e5f6g7h8.azurecr.io',
  };
  const { launch, calls } = driver();
  const pending = runAzure(['--suite=acr'], dnlEnv, launch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].binary, process.execPath);
  assert.deepEqual(calls[0].args, [
    '--import',
    pathToFileURL(require.resolve('tsx')).href,
    'test/e2e/acr.live.test.ts',
  ]);
  assert.equal(calls[0].options.cwd, root);
  assert.deepEqual(calls[0].options.stdio, ['inherit', 'inherit', 'inherit', 'ipc']);
  assert.deepEqual(calls[0].options.env, { ...dnlEnv, AZ_LIVE_TESTS: '1' });
  assert.equal('AZ_LIVE_TESTS' in dnlEnv, false);
  calls[0].child.emit('close', 0, null);
  assert.deepEqual(await pending, { code: 0, signal: null });
});

test('the production ACR launch uses an ESM loader URL and starts safely without live opt-in', async () => {
  const { launch, calls } = driver();
  const pending = runAzure(['--suite', 'acr'], env, launch);
  const invocation = calls[0];
  invocation.child.emit('close', 0, null);
  await pending;
  assert.ok(
    invocation.args[1].startsWith('file:'),
    'ESM loader paths must be file URLs on every platform'
  );

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: '',
    AZ_LIVE_TESTS: '0',
  };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(invocation.binary, invocation.args, {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SKIP/);
  assert.doesNotMatch(result.stderr, /ERR_UNSUPPORTED_ESM_URL_SCHEME/);
});

test('all runs REST then ACR sequentially and reports progress', async t => {
  const messages: string[] = [];
  t.mock.method(console, 'log', (message: string) => messages.push(message));
  const { launch, calls } = driver();
  const pending = runAzure([], env, launch);
  assert.equal(calls.length, 1);
  calls[0].child.emit('close', 0, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.at(-1), 'test/e2e/acr.live.test.ts');
  calls[1].child.emit('close', 0, null);
  assert.deepEqual(await pending, { code: 0, signal: null });
  assert.deepEqual(messages, [
    '[azure live] Starting rest suite',
    '[azure live] Completed rest suite; see test results for passes and skips',
    '[azure live] Starting acr suite',
    '[azure live] Completed acr suite; see test results for passes and skips',
  ]);
});

test('child failures and signals propagate without starting a later suite', async () => {
  for (const result of [
    { code: 17, signal: null },
    { code: null, signal: 'SIGTERM' },
    { code: null, signal: null },
  ]) {
    const { launch, calls } = driver();
    const pending = runAzure([], env, launch);
    calls[0].child.emit('close', result.code, result.signal);
    assert.deepEqual(await pending, result);
    assert.equal(calls.length, 1);
  }
});

test('spawn failures reject and remove signal handlers', async () => {
  const before = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => process.listenerCount(signal));
  const { launch, calls } = driver();
  const pending = runAzure([], env, launch);
  calls[0].child.emit('error', new Error('test spawn failure'));
  await assert.rejects(pending, /test spawn failure/);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => process.listenerCount(signal)),
    before
  );
});

test('interrupts stop the active child, prevent later suites and remove signal handlers', async () => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const before = process.listenerCount(signal);
    const { launch, calls } = driver();
    const pending = runAzure([], env, launch);
    assert.equal(process.listenerCount(signal), before + 1);
    process.emit(signal);
    assert.deepEqual(calls[0].signals, [signal]);
    calls[0].child.emit('close', 0, null);
    assert.deepEqual(await pending, { code: 0, signal });
    assert.deepEqual(calls[0].signals, [signal]);
    assert.equal(calls.length, 1);
    assert.equal(process.listenerCount(signal), before);
  }
});

test('POSIX REST interruption terminates only the owned suite process group', async t => {
  if (process.platform === 'win32') return t.skip('POSIX process groups only');
  const killed: Array<[number, NodeJS.Signals | number | undefined]> = [];
  t.mock.method(process, 'kill', (pid: number, signal?: NodeJS.Signals | number) => {
    killed.push([pid, signal]);
    return true;
  });
  for (const parentInterrupted of [false, true]) {
    const { launch, calls } = driver();
    const pending = runAzure([], env, launch);
    Object.assign(calls[0].child, { pid: 12345 });
    if (parentInterrupted) process.emit('SIGTERM');
    calls[0].child.emit('close', null, 'SIGTERM');
    assert.deepEqual(await pending, { code: null, signal: 'SIGTERM' });
    assert.equal(calls.length, 1);
  }
  assert.deepEqual(killed, [[-12345, 'SIGTERM']]);
});

test('ACR interruption uses IPC on both platforms and repeated signals preserve recovery', async () => {
  for (const platform of ['win32', 'darwin'] as const) {
    const { launch, calls } = driver();
    const killed: unknown[] = [];
    const pending = runSuite([], root, env, launch, {
      cooperative: true,
      platform,
      terminate: child => killed.push(child),
    });

    assert.deepEqual(calls[0].options.stdio, ['inherit', 'inherit', 'inherit', 'ipc']);
    process.emit('SIGINT');
    process.emit('SIGTERM');
    assert.deepEqual(calls[0].child.messages, [{ type: INTERRUPTION_MESSAGE, signal: 'SIGINT' }]);
    assert.deepEqual(calls[0].signals, []);
    assert.deepEqual(killed, []);
    calls[0].child.emit('close', 1, null);
    assert.deepEqual(await pending, { code: 1, signal: 'SIGINT' });
    assert.deepEqual(killed, [], 'never kill a PID after its child has closed');
  }
});

test('ACR runAzure launch requests cooperative interruption rather than killing its child', async () => {
  const { launch, calls } = driver();
  const pending = runAzure(['--suite', 'acr'], env, launch);
  process.emit('SIGINT');
  assert.deepEqual(calls[0].child.messages, [{ type: INTERRUPTION_MESSAGE, signal: 'SIGINT' }]);
  assert.deepEqual(calls[0].signals, []);
  calls[0].child.emit('close', 1, null);
  assert.deepEqual(await pending, { code: 1, signal: 'SIGINT' });
});

test('interruption during startup is re-delivered after the suite installs its handler', async () => {
  const { launch, calls } = driver();
  const pending = runSuite([], root, env, launch, { cooperative: true });
  process.emit('SIGTERM');
  calls[0].child.emit('message', { type: INTERRUPTION_READY });
  assert.deepEqual(calls[0].child.messages, [
    { type: INTERRUPTION_MESSAGE, signal: 'SIGTERM' },
    { type: INTERRUPTION_MESSAGE, signal: 'SIGTERM' },
  ]);
  calls[0].child.emit('close', 1, null);
  assert.deepEqual(await pending, { code: 1, signal: 'SIGTERM' });
});

test('unresponsive cooperative suite is escalated only after its bounded grace', async () => {
  const { launch, calls } = driver();
  const killed: unknown[] = [];
  const pending = runSuite([], root, env, launch, {
    cooperative: true,
    graceMs: 20,
    terminate: child => {
      killed.push(child);
      calls[0].child.emit('close', null, 'SIGKILL');
    },
  });

  process.emit('SIGTERM');
  assert.deepEqual(killed, []);
  assert.deepEqual(await pending, { code: null, signal: 'SIGTERM' });
  assert.deepEqual(killed, [calls[0].child]);
});

test('Windows escalation targets only the owned PID tree and has a command timeout', () => {
  const { launch, calls } = driver();
  launch('', [], {});
  Object.assign(calls[0].child, { pid: 12345 });
  let invocation: unknown[] = [];
  stopChild(calls[0].child, 'SIGKILL', 'win32', ((...args: unknown[]) => {
    invocation = args;
    return { status: 0 };
  }) as typeof spawnSync);
  assert.match(String(invocation[0]), /\\System32\\taskkill\.exe$/);
  assert.deepEqual(invocation[1], ['/pid', '12345', '/T', '/F']);
  assert.equal((invocation[2] as { timeout: number }).timeout, 5000);
});

test('REST interruption rejects the suite rather than throwing from the signal handler', async () => {
  const { launch, calls } = driver();
  const failure = new Error('owned child termination failed');
  const pending = runSuite([], root, {}, launch);
  calls[0].child.kill = () => {
    throw failure;
  };
  const rejected = assert.rejects(pending, error => error === failure);
  assert.doesNotThrow(() => process.emit('SIGINT'));
  await rejected;
});

test('Windows termination ignores a known exited child and an exit during taskkill', () => {
  for (const phase of ['before', 'during']) {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 12345 });
    if (phase === 'before') Object.defineProperty(child, 'exitCode', { value: 0 });
    let invocations = 0;
    const terminate = ((..._args: unknown[]) => {
      invocations++;
      Object.defineProperty(child, 'signalCode', { value: 'SIGINT' });
      return { status: 128, error: new Error('process already exited') };
    }) as typeof spawnSync;
    assert.doesNotThrow(() => stopChild(child, 'SIGTERM', 'win32', terminate));
    assert.equal(invocations, phase === 'before' ? 0 : 1);
  }
});

test('Windows termination confirms a missing PID before the blocked exit event is delivered', () => {
  const child = new ChildProcess();
  Object.defineProperty(child, 'pid', { value: 12345 });
  let probes = 0;
  assert.doesNotThrow(() =>
    stopChild(
      child,
      'SIGTERM',
      'win32',
      () => ({ status: 128 }),
      pid => {
        assert.equal(pid, child.pid);
        probes++;
        throw Object.assign(new Error('process not found'), { code: 'ESRCH' });
      }
    )
  );
  assert.equal(probes, 1);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
});

test('Windows termination retains errors for a live or inaccessible child PID', () => {
  for (const code of [undefined, 'EPERM']) {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 12345 });
    const failure = new Error('taskkill failed');
    assert.throws(
      () =>
        stopChild(
          child,
          'SIGTERM',
          'win32',
          () => ({ status: 1, error: failure }),
          () => {
            if (code) throw Object.assign(new Error('probe denied'), { code });
          }
        ),
      error => error === failure
    );
  }
});

test('root scripts stay opt-in and ACR uses only the canonical guard', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:e2e:azure'], 'tsx test/e2e/run-azure.ts');
  assert.equal(pkg.scripts['test:e2e:acr'], 'npm run test:e2e:azure -- --suite acr');
  for (const script of ['test:build', 'test:e2e:acr:helpers']) {
    assert.ok(pkg.scripts[script].includes('test/e2e/run-azure.test.ts'));
    assert.doesNotMatch(pkg.scripts[script], /AZ_LIVE_TESTS|run-azure\.ts|acr\.live\.test\.ts/);
  }
  const source = readFileSync(path.join(__dirname, 'acr.live.test.ts'), 'utf8');
  assert.match(source, /process\.env\.AZ_LIVE_TESTS !== '1'/);
  assert.doesNotMatch(source, /RUN_AKS_DESKTOP_E2E|AZURE_LIVE_TESTS/);
  assert.match(source, /npm run test:e2e:azure -- --suite acr/);
});

test('CLI rejects missing default-suite configuration before any cloud command with empty PATH', () => {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: '' };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('AKSD_E2E_')) delete childEnv[key];
  }
  delete childEnv.AZ_LIVE_TESTS;
  const result = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(require.resolve('tsx')).href, path.join(__dirname, 'run-azure.ts')],
    { cwd: root, env: childEnv, encoding: 'utf8', timeout: 10_000 }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing E2E configuration/);
  assert.doesNotMatch(result.stdout, /Starting .* suite/);
});

test('importing the runner does not launch tools or validate live configuration', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(require.resolve('tsx')).href,
      '-e',
      "require('./test/e2e/run-azure.ts')",
    ],
    {
      cwd: root,
      env: { PATH: '', AZ_LIVE_TESTS: '1' },
      encoding: 'utf8',
      timeout: 10_000,
    }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
