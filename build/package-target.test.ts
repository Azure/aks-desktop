// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';

import { npmExecutable, packageArguments, validatePackageHost } from './package-target';

test('maps each supported target to one Electron Builder architecture', () => {
  assert.deepEqual(packageArguments('linux', 'x64'), ['--linux', '--x64']);
  assert.deepEqual(packageArguments('linux', 'arm64'), [
    '--linux',
    'AppImage',
    'tar.gz',
    '--arm64',
  ]);
  assert.deepEqual(packageArguments('darwin', 'x64'), ['--mac', '--x64']);
  assert.deepEqual(packageArguments('darwin', 'arm64'), ['--mac', '--arm64']);
  assert.deepEqual(packageArguments('win32', 'x64'), ['--win', '--x64']);
  assert.deepEqual(packageArguments('win32', 'arm64'), ['--win', '--arm64']);
});

test('rejects unsupported platform and architecture pairs', () => {
  assert.throws(() => packageArguments('linux', 'armv7l'), /Unsupported package target/);
  assert.throws(() => packageArguments('aix', 'x64'), /Unsupported package target/);
});

test('requires a native architecture on Linux and macOS hosts', () => {
  assert.doesNotThrow(() => validatePackageHost({ platform: 'linux', arch: 'arm64' }, 'linux', 'arm64'));
  assert.throws(
    () => validatePackageHost({ platform: 'linux', arch: 'arm64' }, 'linux', 'x64'),
    /native arm64 build host/
  );
  assert.doesNotThrow(() =>
    validatePackageHost({ platform: 'darwin', arch: 'arm64' }, 'darwin', 'arm64')
  );
  assert.throws(
    () => validatePackageHost({ platform: 'darwin', arch: 'arm64' }, 'darwin', 'x64'),
    /native arm64 build host/
  );
  assert.throws(
    () => validatePackageHost({ platform: 'darwin', arch: 'x64' }, 'darwin', 'arm64'),
    /native x64 build host/
  );
  assert.doesNotThrow(() => validatePackageHost({ platform: 'win32', arch: 'arm64' }, 'win32', 'x64'));
});

test('uses the Windows npm command shim', () => {
  assert.equal(npmExecutable('win32'), 'npm.cmd');
  assert.equal(npmExecutable('linux'), 'npm');
  assert.equal(npmExecutable('darwin'), 'npm');
});
