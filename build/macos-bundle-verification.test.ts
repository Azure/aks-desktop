// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test as nodeTest, type TestContext } from 'node:test';
import { verifyMacBundleArchitecture } from './macos-bundle-verification';

// Native macOS payload fixtures require POSIX executable permission semantics.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;
const armHost = { platform: 'darwin', arch: 'arm64' };

function bundle(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mac architecture-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const python = path.join(root, 'Contents/Resources/external-tools/az-cli/darwin/bin/python3');
  const electron = path.join(root, 'Contents/MacOS/Fixture desktop');
  const backend = path.join(root, 'Contents/Resources/headlamp-server');
  for (const file of [python, electron, backend]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from('cffaedfe0c000001', 'hex'), { mode: 0o755 });
  }
  fs.writeFileSync(
    path.join(root, 'Contents/Info.plist'),
    '<plist><dict><key>CFBundleExecutable</key><string>Fixture desktop</string></dict></plist>'
  );
  fs.writeFileSync(path.join(root, 'metadata.txt'), 'not executable');
  const verified: string[] = [];
  const run = (command: string, args: string[]) => {
    if (command === '/usr/sbin/sysctl') {
      assert.deepEqual(args, ['-in', 'sysctl.proc_translated']);
      return '0';
    }
    if (command === '/usr/libexec/PlistBuddy') {
      assert.equal(args[2], path.join(root, 'Contents/Info.plist'));
      if (args[1] === 'Print :LSMinimumSystemVersion') return '12.0\n';
      assert.deepEqual(args, [
        '-c',
        'Print :CFBundleExecutable',
        path.join(root, 'Contents/Info.plist'),
      ]);
      return 'Fixture desktop\n';
    }
    if (command === '/usr/bin/otool') {
      assert.equal(args[0], '-arch');
      assert.equal(args[2], '-l');
      return 'Load command 3\n      cmd LC_BUILD_VERSION\n  cmdsize 32\n platform 1\n    minos 11.0\n      sdk 26.0\n';
    }
    if (command === python) {
      assert.deepEqual(
        args.slice(0, 4),
        ['-I', '-B', '-S', '-c'],
        'isolated probes must not write bytecode into the signed bundle'
      );
      return 'arm64\n';
    }
    assert.equal(command, '/usr/bin/lipo');
    assert.deepEqual(args.slice(0, 2), ['-verify_arch', 'arm64']);
    verified.push(args[2]);
    return '';
  };
  return { root, python, electron, backend, run, verified };
}

test('checks required executables and every native library, including universal non-executable Mach-O', (t) => {
  const { root, python, electron, backend, run, verified } = bundle(t);
  const library = path.join(root, 'native.so');
  fs.writeFileSync(library, Buffer.from('cafebabe00000002', 'hex'), { mode: 0o644 });
  assert.equal(verifyMacBundleArchitecture(root, 'arm64', run, armHost), 4);
  assert.deepEqual(verified.sort(), [python, electron, backend, library].sort());
});

for (const payload of ['electron', 'backend', 'python'] as const) {
  test(`rejects missing named ${payload} even with other valid Mach-O payloads`, (t) => {
    const fixture = bundle(t);
    fs.rmSync(fixture[payload]);
    assert.throws(
      () => verifyMacBundleArchitecture(fixture.root, 'arm64', fixture.run, armHost),
      /ENOENT|Missing/
    );
  });
  test(`rejects a script masquerading as the named ${payload}`, (t) => {
    const fixture = bundle(t);
    fs.writeFileSync(fixture[payload], '#!/bin/sh\necho arm64\n');
    assert.throws(
      () => verifyMacBundleArchitecture(fixture.root, 'arm64', fixture.run, armHost),
      /must be.*Mach-O/
    );
  });
}

test(
  'rejects required executables without execute permissions',
  { skip: process.platform === 'win32' },
  (t) => {
    const { root, backend, run } = bundle(t);
    fs.chmodSync(backend, 0o644);
    assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', run, armHost), /executable/);
  }
);

test('rejects an x64 Python running under Rosetta in an ARM bundle', (t) => {
  const { root, python, run } = bundle(t);
  assert.throws(
    () =>
      verifyMacBundleArchitecture(
        root,
        'arm64',
        (command, args) => (command === python ? 'x86_64' : run(command, args)),
        armHost
      ),
    /Python.*architecture/
  );
});

test('rejects an x64-only native extension even when Python is ARM64', (t) => {
  const { root, run } = bundle(t);
  fs.writeFileSync(path.join(root, 'wrong.so'), Buffer.from('cffaedfe07000001', 'hex'));
  assert.throws(
    () =>
      verifyMacBundleArchitecture(
        root,
        'arm64',
        (command, args) => {
          if (command === '/usr/bin/lipo' && args[2].endsWith('wrong.so'))
            throw new Error('missing arm64 slice');
          return run(command, args);
        },
        armHost
      ),
    /wrong.so.*arm64/
  );
});

test('accepts native Intel Python and universal slices for the x64 target', (t) => {
  const { root, python, run } = bundle(t);
  const count = verifyMacBundleArchitecture(
    root,
    'x64',
    (command, args) => {
      if (command === python) return 'x86_64';
      if (command === '/usr/bin/lipo') {
        assert.equal(args[1], 'x86_64');
        return '';
      }
      return run(command, args);
    },
    { platform: 'darwin', arch: 'x64' }
  );
  assert.equal(count, 3);
  assert.throws(() => verifyMacBundleArchitecture(root, 'armv7', run, armHost), /Unsupported/);
});

test('rejects wrong hosts and translated Intel processes instead of skipping verification', (t) => {
  const { root, run } = bundle(t);
  for (const host of [
    { platform: 'linux', arch: 'arm64' },
    { platform: 'darwin', arch: 'x64' },
  ]) {
    assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', run, host), /native.*host/);
  }
  assert.throws(
    () => verifyMacBundleArchitecture(root, 'x64', () => '1', { platform: 'darwin', arch: 'x64' }),
    /Rosetta|translated/
  );
  if (process.platform !== 'darwin')
    assert.throws(() => verifyMacBundleArchitecture(root, 'arm64'), /native.*host/);
});

test('requires Info.plist and rejects executable path traversal', (t) => {
  const { root, run } = bundle(t);
  assert.throws(
    () =>
      verifyMacBundleArchitecture(
        root,
        'arm64',
        (command, args) =>
          command === '/usr/libexec/PlistBuddy'
            ? '../Resources/headlamp-server'
            : run(command, args),
        armHost
      ),
    /CFBundleExecutable/
  );
  fs.rmSync(path.join(root, 'Contents/Info.plist'));
  assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', run, armHost), /ENOENT|Missing/);
});

test('rejects native payloads that require newer macOS than the app advertises', (t) => {
  const { root, run } = bundle(t);
  assert.throws(
    () =>
      verifyMacBundleArchitecture(
        root,
        'arm64',
        (command, args) =>
          command === '/usr/bin/otool'
            ? 'Load command 3\n cmd LC_BUILD_VERSION\n minos 26.0\n sdk 26.0\n'
            : run(command, args),
        armHost
      ),
    /requires macOS 26.0.*12.0/
  );
});

test('reads legacy deployment targets and rejects absent deployment metadata', (t) => {
  const { root, run } = bundle(t);
  assert.equal(
    verifyMacBundleArchitecture(
      root,
      'arm64',
      (command, args) =>
        command === '/usr/bin/otool'
          ? 'Load command 3\n cmd LC_VERSION_MIN_MACOSX\n version 12.0\n sdk 26.0\n'
          : run(command, args),
      armHost
    ),
    3
  );
  assert.throws(
    () =>
      verifyMacBundleArchitecture(
        root,
        'arm64',
        (command, args) =>
          command === '/usr/bin/otool' ? 'Load command 1\n cmd LC_UUID\n' : run(command, args),
        armHost
      ),
    /deployment target/
  );
});

test(
  'rejects escaped links and handles internal framework links without duplicate checks',
  { skip: process.platform === 'win32' },
  (t) => {
    const { root, python, run } = bundle(t);
    fs.symlinkSync(path.dirname(python), path.join(root, 'framework-link'));
    assert.equal(verifyMacBundleArchitecture(root, 'arm64', run, armHost), 3);
    fs.symlinkSync(os.tmpdir(), path.join(root, 'escaped'));
    assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', run, armHost), /escapes/);
  }
);
