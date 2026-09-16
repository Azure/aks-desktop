// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test as nodeTest, type TestContext } from 'node:test';

// These regressions execute POSIX shell scripts and shebang-based command fixtures.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;

const helper = path.join(__dirname, 'verify-macos-signing.sh');
const bundleId = 'com.microsoft.aksdesktop';
const authority = 'Developer ID Application: Microsoft Corporation (UBF8T346G9)';

// Only macOS system boundaries are replaced; bash, discovery, validation and cleanup are real.
const commandStub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const [command, ...args] = process.argv.slice(1);
const name = path.basename(command);
const root = process.env.FIXTURE;
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify([name, ...args]) + '\\n');
const target = args[args.length - 1];
const kind = target.endsWith('.dmg') ? 'dmg' : 'app';
function check(condition) { if (!condition) throw Error('Unexpected arguments: ' + JSON.stringify(args)); }
function fail(key) {
  if (config.signal === key) process.kill(process.ppid, 'SIGTERM');
  if (config.failures?.[key]) {
    console.error('fixture failure: ' + key);
    process.exit(config.failures[key]);
  }
}
switch (name) {
  case 'hdiutil': {
    if (args[0] === 'attach') {
      check(args.length === 7 && args[2] === '-mountpoint' && args.includes('-readonly') && args.includes('-nobrowse') && args.includes('-quiet'));
      fs.cpSync(path.join(root, 'payload'), args[3], { recursive: true });
      fail('attach'); // Model a partially completed mount on error.
    } else {
      check(args[0] === 'detach' && args.includes('-quiet'));
      fail(args.includes('-force') ? 'force-detach' : 'detach');
      fs.rmSync(args[1], { recursive: true, force: true });
      fs.mkdirSync(args[1]);
    }
    break;
  }
  case 'plutil':
    check(JSON.stringify(args.slice(0, 5)) === JSON.stringify(['-extract', 'CFBundleIdentifier', 'raw', '-o', '-']));
    fail('plist');
    console.log(config.bundleId);
    break;
  case 'codesign':
    if (args[0] === '--verify') {
      check(kind === 'dmg' || (args.includes('--deep') && args.includes('--strict')));
      fail('verify-' + kind);
    } else {
      check(args.length === 2 && args[0] === '-dvvv');
      console.error('Executable=' + target + '\\nIdentifier=' + config.bundleId + '\\nFormat=app bundle with Mach-O thin (arm64)');
      console.error('Authority=' + (config[kind + 'Authority'] ?? config.authority));
      console.error('Authority=Developer ID Certification Authority\\nAuthority=Apple Root CA');
      console.error('TeamIdentifier=' + (config[kind + 'Team'] ?? 'UBF8T346G9'));
      fail('display-' + kind);
    }
    break;
  case 'xcrun':
    check(args.length === 3 && args[0] === 'stapler' && args[1] === 'validate' && kind === 'dmg');
    console.log('The validate action worked!');
    fail('stapler');
    break;
  case 'spctl':
    check(args.includes('--assess') && args.includes('--verbose=2'));
    check(args[args.indexOf('--type') + 1] === (kind === 'dmg' ? 'open' : 'execute'));
    if (kind === 'dmg') check(args.includes('--context') && args.includes('context:primary-signature'));
    const assessment = config[kind + 'Assessment'] ?? (': accepted\\nsource=Notarized Developer ID\\norigin=' + config.authority);
    console.error(target + assessment);
    fail('spctl-' + kind);
    break;
  default: throw Error('Unexpected command: ' + name);
}
`;

function fixture(t: TestContext, overrides: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac signing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dmgs = path.join(root, 'DMGs with spaces');
  const tmp = path.join(root, 'temporary mounts');
  const app = path.join(root, 'payload', 'AKS desktop.app');
  const bin = path.join(root, 'bin');
  for (const dir of [dmgs, tmp, bin, path.join(app, 'Contents')])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`
  );
  fs.writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({ bundleId, authority, ...overrides })
  );
  fs.writeFileSync(path.join(dmgs, 'AKS desktop arm64.dmg'), 'synthetic disk image');
  for (const command of ['hdiutil', 'codesign', 'plutil', 'xcrun', 'spctl']) {
    fs.writeFileSync(path.join(bin, command), commandStub, { mode: 0o755 });
  }
  return {
    root,
    dmgs,
    tmp,
    app,
    run(mode = 'signed', expected = bundleId, directory = dmgs) {
      return spawnSync('bash', [helper, mode, directory, expected], {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          TMPDIR: tmp,
          FIXTURE: root,
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
      assert.deepEqual(fs.readdirSync(tmp), [], 'temporary mounts must be removed');
    },
  };
}

function assertRejected(
  f: ReturnType<typeof fixture>,
  result: ReturnType<ReturnType<typeof fixture>['run']>,
  status?: number
) {
  assert.equal(result.error, undefined);
  assert.equal(typeof result.status, 'number', `Unexpected signal: ${result.signal}`);
  assert.notEqual(result.status, 0, result.stdout);
  if (status !== undefined) assert.equal(result.status, status, result.stderr);
  assert.doesNotMatch(result.stdout, /VERIFICATION COMPLETE|##vso\[task.setvariable/);
  f.assertClean();
}

test('signed verification checks every DMG and its root app before publishing the bundle ID', (t) => {
  const f = fixture(t);
  const nested = path.join(f.dmgs, 'nested directory');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'AKS desktop x64.dmg'), 'second disk image');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /##vso\[task.setvariable variable=BundleIdentifier;isOutput=true\]com\.microsoft\.aksdesktop/
  );
  assert.match(result.stdout, /=== DEVELOPER SIGNATURE VERIFICATION COMPLETE ===/);
  assert.match(result.stdout, /^✅ DMG is signed with Developer ID$/m);
  const calls = f.calls();
  assert.equal(calls.filter((call) => call[0] === 'codesign' && call[1] === '--verify').length, 4);
  assert.equal(calls.filter((call) => call[0] === 'codesign' && call[1] === '-dvvv').length, 4);
  assert.equal(calls.filter((call) => call[0] === 'plutil').length, 2);
  assert.equal(calls.filter((call) => call[0] === 'hdiutil' && call[1] === 'detach').length, 2);
  assert.equal(calls.filter((call) => ['spctl', 'xcrun'].includes(call[0])).length, 0);
  f.assertClean();
});

for (const invalid of [
  'missing directory',
  'empty directory',
  'wrong mode',
  'empty ID',
  'unsafe ID',
]) {
  test(`rejects ${invalid} without publishing success`, (t) => {
    const f = fixture(t);
    if (invalid === 'empty directory') {
      fs.rmSync(f.dmgs, { recursive: true });
      fs.mkdirSync(f.dmgs);
    }
    const mode = invalid === 'wrong mode' ? 'unchecked' : 'signed';
    const id =
      invalid === 'empty ID'
        ? ''
        : invalid === 'unsafe ID'
        ? 'com.microsoft.aksdesktop\nINJECTED'
        : bundleId;
    const directory = invalid === 'missing directory' ? path.join(f.root, 'absent') : f.dmgs;
    const result = f.run(mode, id, directory);
    assertRejected(f, result);
    if (invalid === 'empty directory') assert.match(result.stderr, /No DMG files/);
  });
}

for (const invalid of [
  'absent app',
  'multiple apps',
  'nested app',
  'symlink app',
  'missing plist',
  'wrong bundle ID',
]) {
  test(`rejects ${invalid} and detaches the mounted DMG`, (t) => {
    const f = fixture(
      t,
      invalid === 'wrong bundle ID' ? { bundleId: 'com.microsoft.aks-desktop' } : {}
    );
    if (invalid === 'absent app') fs.rmSync(f.app, { recursive: true });
    if (invalid === 'multiple apps') fs.mkdirSync(path.join(f.root, 'payload', '.Other.app'));
    if (invalid === 'nested app' || invalid === 'symlink app') {
      const nested = path.join(f.root, 'payload', 'nested');
      fs.mkdirSync(nested);
      fs.renameSync(f.app, path.join(nested, 'Nested.app'));
      if (invalid === 'symlink app') fs.symlinkSync('nested/Nested.app', f.app);
    }
    if (invalid === 'missing plist') fs.rmSync(path.join(f.app, 'Contents', 'Info.plist'));
    assertRejected(f, f.run());
    assert.ok(f.calls().some((call) => call[0] === 'hdiutil' && call[1] === 'detach'));
  });
}

for (const kind of ['app', 'dmg']) {
  for (const [field, value] of [
    ['Authority', 'Developer ID Application: Other Corporation (UBF8T346G9)'],
    ['Authority', 'Developer ID Application: Microsoft Corporation (OTHERTEAM0)'],
    ['Authority', `${authority} counterfeit`],
    ['Authority', `Untrusted leaf\nAuthority=${authority}`],
    ['Authority', ''],
    ['Team', 'OTHERTEAM0'],
    ['Team', ''],
  ]) {
    test(`rejects ${kind} identity ${field}=${JSON.stringify(value)}`, (t) => {
      const f = fixture(t, { [kind + field]: value });
      assertRejected(f, f.run());
    });
  }
}

test('uses the caller-supplied bundle ID rather than a historical hardcoded value', (t) => {
  const f = fixture(t, { bundleId: 'com.example.consumer' });
  const result = f.run('signed', 'com.example.consumer');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BundleIdentifier;isOutput=true\]com\.example\.consumer/);
  f.assertClean();
});

test('notarized verification requires a valid DMG staple and Gatekeeper approval for app and DMG', (t) => {
  const f = fixture(t);
  const result = f.run('notarized');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /=== NOTARIZATION VERIFICATION COMPLETE ===/);
  assert.match(result.stdout, /^✅ App is notarized and accepted by Gatekeeper$/m);
  assert.doesNotMatch(result.stdout, /BundleIdentifier;isOutput/);
  assert.equal(f.calls().filter((call) => call[0] === 'xcrun').length, 1);
  assert.equal(f.calls().filter((call) => call[0] === 'spctl').length, 2);
  assert.equal(
    f.calls().filter((call) => call[0] === 'codesign' && call[1] === '--verify').length,
    2
  );
  assert.equal(f.calls().filter((call) => call[0] === 'codesign' && call[1] === '-dvvv').length, 2);
  f.assertClean();
});

for (const kind of ['app', 'dmg']) {
  for (const assessment of [
    ': accepted\nsource=Developer ID',
    ': rejected\nsource=Notarized Developer ID',
    ': not accepted\nsource=Notarized Developer ID',
    ': accepted\nsource=Notarized Developer ID counterfeit',
    ': accepted',
    '',
    ': assessment unsupported',
  ]) {
    test(`rejects non-positive notarization evidence for ${kind}: ${JSON.stringify(
      assessment
    )}`, (t) => {
      const f = fixture(t, { [kind + 'Assessment']: assessment });
      assertRejected(f, f.run('notarized'));
    });
  }
}

for (const operation of ['stapler', 'spctl-app', 'spctl-dmg']) {
  test(`preserves ${operation} failure even with positive output`, (t) => {
    const f = fixture(t, { failures: { [operation]: 39 } });
    const result = f.run('notarized');
    assertRejected(f, result, 39);
    assert.match(result.stderr, new RegExp(`fixture failure: ${operation}`));
  });
}

test('cleanup uses force-detach when needed without masking the verification failure', (t) => {
  const f = fixture(t, { failures: { 'verify-app': 37, detach: 38 } });
  assertRejected(f, f.run(), 37);
  assert.ok(f.calls().some((call) => call[0] === 'hdiutil' && call.includes('-force')));
});

test('a detach failure prevents success even when forced cleanup succeeds', (t) => {
  const f = fixture(t, { failures: { detach: 38 } });
  assertRejected(f, f.run(), 38);
});

test('unrecoverable detach preserves the original failure and never removes a mounted volume', (t) => {
  const f = fixture(t, { failures: { 'verify-app': 37, detach: 38, 'force-detach': 40 } });
  const result = f.run();
  assert.equal(result.status, 37, result.stderr);
  assert.doesNotMatch(result.stdout, /VERIFICATION COMPLETE|##vso\[task.setvariable/);
  const attach = f.calls().find((call) => call[0] === 'hdiutil' && call[1] === 'attach');
  assert.ok(attach, 'fixture should have mounted an image before verification failed');
  assert.ok(fs.existsSync(path.join(attach[4], 'AKS desktop.app', 'Contents', 'Info.plist')));
  assert.match(result.stderr, /Could not detach/);
});

test('SIGTERM detaches the mounted image and exits with the signal status', (t) => {
  const f = fixture(t, { signal: 'verify-app' });
  assertRejected(f, f.run(), 143);
});

for (const operation of [
  'attach',
  'plist',
  'verify-app',
  'verify-dmg',
  'display-app',
  'display-dmg',
]) {
  test(`preserves ${operation} failure status and cleans up the mount`, (t) => {
    const f = fixture(t, { failures: { [operation]: 37 } });
    const result = f.run();
    assertRejected(f, result, 37);
    assert.match(result.stderr, new RegExp(`fixture failure: ${operation}`));
  });
}
