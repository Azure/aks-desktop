// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.join(__dirname, 'windows-ci.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "windows npm space & quote'-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const temp = path.join(root, "agent temp & quote'");
  fs.mkdirSync(temp);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'npm@12.0.1' }));
  const trace = path.join(root, 'calls.jsonl');
  const cli = path.join(root, 'bundled npm-cli.cjs');
  // External npm boundary only: use real child processes, paths and files, but
  // never download packages or build an installer during these tests.
  const pinned = `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync(process.env.TRACE, JSON.stringify({ phase: 'pinned', args, cli: process.argv[1], lifecycleCli: process.env.npm_execpath }) + '\\n');
    if (process.env.FAIL_AT === (args[1] || args[0])) process.exit(23);
    if (args[0] === '--version') console.log(process.env.FAKE_VERSION || '12.0.1');
    if (process.env.NESTED_NPM && args[0] === 'run') {
      const nested = require('node:child_process').spawnSync('npm --version', { shell: true, encoding: 'utf8' });
      if (nested.status !== 0) process.exit(nested.status || 1);
      require('node:assert/strict').equal(nested.stdout.trim(), '12.0.1');
    }
  `;
  fs.writeFileSync(cli, `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2);
    fs.appendFileSync(process.env.TRACE, JSON.stringify({ phase: 'bootstrap', args }) + '\\n');
    if (process.env.FAIL_AT === 'install') process.exit(23);
    const target = path.join(args[args.indexOf('--prefix') + 1], 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!process.env.MISSING_CLI) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, ${JSON.stringify(pinned)});
      const bin = path.join(args[args.indexOf('--prefix') + 1], 'node_modules', '.bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\\nexec "' + process.execPath + '" "' + target + '" "$@"\\n', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'npm.cmd'), '@"' + process.execPath + '" "' + target + '" %*\\r\\n');
    }
  `);
  // Any accidental dispatch through a PATH-resolved npm shim must fail.
  const poison = path.join(root, 'poison-bin');
  fs.mkdirSync(poison);
  fs.writeFileSync(path.join(poison, 'npm'), '#!/bin/sh\nexit 77\n', { mode: 0o755 });
  fs.writeFileSync(path.join(poison, 'npm.cmd'), '@exit /b 77\r\n');
  function run(overrides = {}, preload) {
    const result = spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), script], { cwd: root, encoding: 'utf8', env: {
      ...process.env, PATH: poison, npm_execpath: cli, AGENT_TEMPDIRECTORY: temp, TRACE: trace, ...overrides,
    } });
    const calls = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return { ...result, calls };
  }
  return { root, temp, run };
}

test('uses native paths and the verified CLI for install, build and distribution checks without PATH shims', t => {
  const { run, temp } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const [install, version, ...commands] = result.calls;
  assert.equal(install.phase, 'bootstrap');
  assert.deepEqual(install.args.slice(0, 2), ['install', '--prefix']);
  assert.equal(path.dirname(install.args[2]), temp);
  assert.deepEqual(install.args.slice(3), ['--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'npm@12.0.1']);
  assert.deepEqual(version.args, ['--version']);
  assert.deepEqual(commands.map(c => c.args), [['ci'], ['run', 'build:win-ci'], ['run', 'test:distribution']]);
  const installedCli = path.join(install.args[2], 'node_modules', 'npm', 'bin', 'npm-cli.js');
  for (const call of [version, ...commands]) {
    assert.equal(call.cli, installedCli);
    assert.equal(call.lifecycleCli, installedCli);
  }
  assert.deepEqual(fs.readdirSync(temp), []);
});

for (const phase of ['install', 'ci', 'build:win-ci', 'test:distribution']) {
  test(`preserves failure status and stops subsequent commands when ${phase} fails`, t => {
    const { run, temp } = fixture(t);
    const result = run({ FAIL_AT: phase });
    assert.equal(result.status, 23, result.stderr);
    const last = result.calls.at(-1).args;
    assert.equal(phase === 'install' ? last[0] : (last[1] || last[0]), phase);
    assert.deepEqual(fs.readdirSync(temp), []);
  });
}

for (const [name, env, error] of [
  ['missing installed CLI', { MISSING_CLI: '1' }, /npm-cli\.js/],
  ['wrong installed version', { FAKE_VERSION: '0.0.0' }, /12\.0\.1/],
]) {
  test(`rejects ${name} before npm ci`, t => {
    const { run, temp } = fixture(t);
    const result = run(env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.ok(result.calls.every(call => !call.args.includes('ci')));
    assert.deepEqual(fs.readdirSync(temp), []);
  });
}

test('nested bare npm commands resolve the pinned CLI rather than the original PATH', t => {
  const { run } = fixture(t);
  const result = run({ NESTED_NPM: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.filter(c => c.args[0] === '--version').length, 3);
});

for (const [failAt, expected] of [['ci', 23], ['', 0]]) {
  test(`cleanup failure is reported without replacing exit status ${expected}`, t => {
    const { root, run } = fixture(t);
    const preload = path.join(root, 'cleanup-denied.cjs');
    fs.writeFileSync(preload, "require('node:fs').rmSync = () => { throw Object.assign(new Error('fixture cleanup denied'), { code: 'EPERM' }); };");
    const result = run({ FAIL_AT: failAt }, preload);
    assert.equal(result.status, expected, result.stderr);
    assert.match(result.stderr, /cleanup denied/);
  });
}

test('requires an npm lifecycle CLI before creating temporary files', t => {
  const { run, temp } = fixture(t);
  const result = run({ npm_execpath: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm_execpath/);
  assert.deepEqual(result.calls, []);
  assert.deepEqual(fs.readdirSync(temp), []);
});
