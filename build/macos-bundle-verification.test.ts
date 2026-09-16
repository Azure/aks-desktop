// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { type TestContext } from 'node:test';
import { verifyMacBundleArchitecture } from './macos-bundle-verification';

function bundle(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac architecture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const python = path.join(root, 'Contents', 'Resources', 'external-tools', 'az-cli', 'darwin', 'bin', 'python3');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, Buffer.from('cffaedfe0c000001', 'hex'));
  fs.writeFileSync(path.join(root, 'metadata.txt'), 'not executable');
  return { root, python };
}

test('checks Python execution and every native binary, including universal Mach-O', t => {
  const { root, python } = bundle(t);
  const library = path.join(root, 'native.so');
  fs.writeFileSync(library, Buffer.from('cafebabe00000002', 'hex'));
  const verified: string[] = [];
  const count = verifyMacBundleArchitecture(root, 'arm64', (command, args) => {
    if (command === python) {
      assert.deepEqual(args.slice(0, 3), ['-I', '-S', '-c']);
      return 'arm64\n';
    }
    assert.equal(command, '/usr/bin/lipo');
    assert.deepEqual(args.slice(0, 2), ['-verify_arch', 'arm64']);
    verified.push(args[2]);
    return '';
  });
  assert.equal(count, 2);
  assert.deepEqual(verified.sort(), [python, library].sort());
});

test('rejects an x64 Python running under Rosetta in an ARM bundle', t => {
  const { root } = bundle(t);
  assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', () => 'x86_64\n'), /Python.*architecture/);
});

test('rejects an x64-only native extension even when Python is ARM64', t => {
  const { root, python } = bundle(t);
  fs.writeFileSync(path.join(root, 'wrong.so'), Buffer.from('cffaedfe07000001', 'hex'));
  assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', (command, args) => {
    if (command === python) return 'arm64';
    if (args[2].endsWith('wrong.so')) throw new Error('missing arm64 slice');
    return '';
  }), /wrong.so.*arm64/);
});

test('accepts native Intel Python only for the x64 target', t => {
  const { root, python } = bundle(t);
  assert.equal(verifyMacBundleArchitecture(root, 'x64', command => command === python ? 'x86_64' : ''), 1);
  assert.throws(() => verifyMacBundleArchitecture(root, 'armv7'), /Unsupported/);
});

test('rejects missing native payload rather than trusting a target marker', t => {
  const { root, python } = bundle(t);
  fs.writeFileSync(python, '#!/bin/sh\necho arm64\n');
  assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', () => 'arm64'), /No Mach-O/);
});

test('rejects escaped links and handles internal framework links without duplicate checks', { skip: process.platform === 'win32' }, t => {
  const { root, python } = bundle(t);
  fs.symlinkSync(path.dirname(python), path.join(root, 'framework-link'));
  assert.equal(verifyMacBundleArchitecture(root, 'arm64', command => command === python ? 'arm64' : ''), 1);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'escaped'));
  assert.throws(() => verifyMacBundleArchitecture(root, 'arm64', command => command === python ? 'arm64' : ''), /escapes/);
});
