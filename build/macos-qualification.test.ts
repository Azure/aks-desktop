// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test as nodeTest, type TestContext } from 'node:test';

// These regressions execute POSIX shell scripts and shebang-based command fixtures.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

const helper = path.join(__dirname, 'qualify-macos-dmg.sh');
const bundleId = 'com.microsoft.aksdesktop';
const image = Buffer.from('original notarized DMG bytes\0unchanged');
// Exercise real Bash and filesystem operations; replace only macOS and npm boundaries.
const commandStub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const [command, ...args] = process.argv.slice(1);
const name = path.basename(command);
const root = process.env.FIXTURE;
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify([name, ...args]) + '\\n');
function check(ok) { if (!ok) throw Error('Unexpected ' + name + ' arguments: ' + JSON.stringify(args)); }
function fail(key) {
  if (config.signal === key) process.kill(process.ppid, 'SIGTERM');
  if (config.failures?.[key]) { console.error('fixture failure: ' + key); process.exit(config.failures[key]); }
}
check(!fs.existsSync(path.join(root, 'qualified output', 'AKS desktop arm64.dmg')));
switch (name) {
  case 'uname': console.log(args[0] === '-s' ? (config.os ?? 'Darwin') : (config.arch ?? 'arm64')); break;
  case 'node': check(args.join(' ') === '-p process.arch'); console.log(config.nodeArch ?? 'arm64'); break;
  case 'qualification-signing':
    check(JSON.stringify(args) === JSON.stringify(['notarized', path.join(root, 'notarized input'), '${bundleId}']));
    fail('signing'); break;
  case 'hdiutil':
    if (args[0] === 'attach') {
      check(args.length === 7 && args[2] === '-mountpoint' && args.includes('-readonly') && args.includes('-nobrowse') && args.includes('-quiet'));
      fs.cpSync(path.join(root, 'payload'), args[3], { recursive: true });
      fail('attach');
    } else {
      check(args[0] === 'detach' && args.includes('-quiet'));
      fail(args.includes('-force') ? 'force-detach' : 'detach');
      fs.rmSync(args[1], { recursive: true }); fs.mkdirSync(args[1]);
    }
    break;
  case 'ditto':
    check(args.length === 2 && args[0] !== args[1]);
    fs.cpSync(args[0], args[1], { recursive: true }); fail('copy'); break;
  case 'codesign':
    check(args.length === 4 && args.slice(0, 3).join(' ') === '--verify --deep --strict');
    check(fs.existsSync(path.join(args[3], 'Contents', 'Info.plist')) && !args[3].includes('/mount/'));
    fail(fs.existsSync(path.join(root, 'smoked')) ? 'recheck' : 'signature'); break;
  case 'plutil':
    check(args.slice(0, 5).join(' ') === '-extract CFBundleExecutable raw -o -');
    fail('plist'); console.log(config.executable ?? 'AKS desktop'); break;
  case 'npm': {
    const smoke = args[1] === 'headlamp:smoke';
    check(args[0] === 'run' && args[2] === '--');
    check(process.env.HOME.startsWith(path.join(root, 'temporary state') + path.sep));
    check(process.env.AZURE_CONFIG_DIR.startsWith(process.env.HOME + path.sep));
    check(process.env.PYTHONDONTWRITEBYTECODE === '1');
    check(process.env.AZURE_EXTENSION_USE_DYNAMIC_INSTALL === 'no');
    check(process.env.AZURE_CORE_COLLECT_TELEMETRY === 'no');
    if (smoke) {
      check(args.length === 5 && args[3] === '--executable' && args[4].endsWith('/Contents/MacOS/AKS desktop'));
      check(fs.existsSync(args[4]) && fs.existsSync(path.join(root, 'native-checked')));
      const home = process.env.HOME;
      check(home !== path.join(root, 'ambient home') && home.startsWith(path.join(root, 'temporary state') + path.sep));
      check(process.env.XDG_CONFIG_HOME.startsWith(home + path.sep));
      check((fs.statSync(path.dirname(home)).mode & 0o777) === 0o700);
      fs.writeFileSync(path.join(home, 'smoke-state'), 'isolated state');
      fs.writeFileSync(path.join(process.env.XDG_CONFIG_HOME, 'settings'), 'isolated config');
      fs.writeFileSync(path.join(root, 'smoked'), home);
    } else {
      check(args.length === 4 && args[1] === 'test:post-build' && args[3].startsWith('--app='));
      check(fs.existsSync(path.join(args[3].slice(6), 'Contents', 'Info.plist')));
      fs.writeFileSync(path.join(root, 'native-checked'), 'checked');
    }
    fail(smoke ? 'smoke' : 'native'); break;
  }
  default: throw Error('Unexpected command: ' + name);
}
`;

function fixture(t: TestContext, config: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac qualification-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'notarized input');
  const output = path.join(root, 'qualified output');
  const tmp = path.join(root, 'temporary state');
  const cwd = path.join(root, 'synthetic repo');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'ambient home');
  const app = path.join(root, 'payload', 'AKS desktop.app');
  for (const dir of [
    input,
    tmp,
    bin,
    home,
    path.join(cwd, 'build'),
    path.join(app, 'Contents', 'MacOS'),
  ])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(home, 'credentials'), 'must remain untouched');
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), 'synthetic plist');
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'AKS desktop'), 'synthetic executable', {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(input, 'AKS desktop arm64.dmg'), image);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  fs.writeFileSync(
    path.join(cwd, 'build', 'verify-macos-signing.sh'),
    '#!/bin/bash\nexec qualification-signing "$@"\n'
  );
  for (const name of [
    'uname',
    'node',
    'qualification-signing',
    'hdiutil',
    'ditto',
    'codesign',
    'plutil',
    'npm',
  ]) {
    fs.writeFileSync(path.join(bin, name), commandStub, { mode: 0o755 });
  }
  return {
    root,
    input,
    output,
    tmp,
    app,
    run() {
      return spawnSync('bash', [helper, input, output, bundleId], {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          TMPDIR: tmp,
          HOME: home,
          XDG_CONFIG_HOME: home,
          FIXTURE: root,
          BUILD_BUILDID: '12345',
          BUILD_SOURCEVERSION: 'abcdef123456',
        },
      });
    },
    calls(): string[][] {
      const file = path.join(root, 'calls.jsonl');
      return fs.existsSync(file)
        ? fs
            .readFileSync(file, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [];
    },
    assertClean() {
      assert.deepEqual(
        fs.readdirSync(tmp),
        [],
        'temporary app, mount and smoke data must be removed'
      );
      assert.deepEqual(fs.readdirSync(home), ['credentials']);
      assert.equal(
        fs.readFileSync(path.join(home, 'credentials'), 'utf8'),
        'must remain untouched'
      );
    },
    assertUnpublished() {
      assert.ok(!fs.existsSync(output) || fs.readdirSync(output).length === 0);
    },
  };
}

function rejected(f: ReturnType<typeof fixture>, status = 1) {
  const result = f.run();
  assert.equal(result.error, undefined);
  assert.equal(typeof result.status, 'number');
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(result.status, status, result.stderr);
  f.assertUnpublished();
  f.assertClean();
  return result;
}

test('qualifies a copied app with isolated state and publishes only the unchanged original DMG', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(f.output, 'AKS desktop arm64.dmg')), image);
  assert.deepEqual(fs.readFileSync(path.join(f.input, 'AKS desktop arm64.dmg')), image);
  assert.match(result.stdout, new RegExp(createHash('sha256').update(image).digest('hex')));
  assert.match(result.stdout, /12345/);
  assert.match(result.stdout, /abcdef123456/);
  const operations = f.calls().filter((c) => !['uname', 'node', 'plutil'].includes(c[0]));
  assert.deepEqual(
    operations.map((c) => c[0]),
    ['qualification-signing', 'hdiutil', 'ditto', 'hdiutil', 'codesign', 'npm', 'npm', 'codesign']
  );
  assert.deepEqual(
    operations[4],
    operations[7],
    'signature must be rechecked on the same copied app'
  );
  f.assertClean();
});

for (const config of [{ os: 'Linux' }, { arch: 'x86_64' }, { nodeArch: 'x64' }]) {
  test(`rejects wrong host ${JSON.stringify(config)} before notarization or execution`, (t) => {
    const f = fixture(t, config);
    const result = rejected(f);
    assert.match(result.stderr, /native|arm64|Darwin/);
    assert.ok(!f.calls().some((c) => ['qualification-signing', 'npm'].includes(c[0])));
  });
}

for (const count of [0, 2]) {
  test(`rejects ${count} DMGs without publishing`, (t) => {
    const f = fixture(t);
    if (!count) fs.rmSync(path.join(f.input, 'AKS desktop arm64.dmg'));
    else {
      fs.mkdirSync(path.join(f.input, 'nested'));
      fs.writeFileSync(path.join(f.input, 'nested', 'second.dmg'), 'second');
    }
    assert.match(rejected(f).stderr, /exactly one DMG/);
  });
}

for (const operation of [
  'signing',
  'attach',
  'copy',
  'signature',
  'plist',
  'native',
  'smoke',
  'recheck',
  'detach',
]) {
  test(`${operation} failure prevents publication and cleans private state`, (t) => {
    const f = fixture(t, { failures: { [operation]: 37 } });
    assert.match(rejected(f, 37).stderr, new RegExp(`fixture failure: ${operation}`));
  });
}

test('unrecoverable detach preserves mounted content and failure status', (t) => {
  const f = fixture(t, { failures: { copy: 37, detach: 38, 'force-detach': 39 } });
  const result = f.run();
  assert.equal(result.status, 37, result.stderr);
  f.assertUnpublished();
  const attach = f.calls().find((c) => c[0] === 'hdiutil' && c[1] === 'attach');
  assert.ok(attach);
  assert.ok(fs.existsSync(path.join(attach[4], 'AKS desktop.app', 'Contents', 'Info.plist')));
  assert.ok(f.calls().some((c) => c.includes('-force')));
  assert.match(result.stderr, /Could not detach/);
});

test('SIGTERM removes copied app and isolated smoke state without publishing', (t) => {
  rejected(fixture(t, { signal: 'smoke' }), 143);
});

for (const executable of ['', '../outside', '/bin/sh']) {
  test(`rejects unsafe bundle executable ${JSON.stringify(executable)}`, (t) => {
    rejected(fixture(t, { executable }));
  });
}
