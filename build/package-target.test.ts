// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';

import { npmExecutable, packageArguments } from './package-target';

test('maps each supported target to one Electron Builder architecture', () => {
  assert.deepEqual(packageArguments('linux', 'x64'), ['--linux', '--x64']);
  assert.deepEqual(packageArguments('linux', 'arm64'), [
    '--linux',
    'AppImage',
    'tar.gz',
    '--arm64',
  ]);
  assert.deepEqual(packageArguments('linux', 'armv7l'), [
    '--linux',
    'AppImage',
    'tar.gz',
    '--armv7l',
  ]);
  assert.deepEqual(packageArguments('darwin', 'x64'), ['--mac', '--x64']);
  assert.deepEqual(packageArguments('darwin', 'arm64'), ['--mac', '--arm64']);
  assert.deepEqual(packageArguments('win32', 'x64'), ['--win', '--x64']);
  assert.deepEqual(packageArguments('win32', 'arm64'), ['--win', '--arm64']);
});

test('rejects unsupported platform and architecture pairs', () => {
  assert.throws(() => packageArguments('linux', 'ia32'), /Unsupported package target/);
  assert.throws(() => packageArguments('aix', 'x64'), /Unsupported package target/);
});
test('uses the Windows npm command shim', () => {
  assert.equal(npmExecutable('win32'), 'npm.cmd');
  assert.equal(npmExecutable('linux'), 'npm');
  assert.equal(npmExecutable('darwin'), 'npm');
});
