// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';

import {
  npmExecutable,
  npmInvocation,
  packageArguments,
  packageEnvironment,
  validatePackageHost,
} from './package-target';

test('maps each supported target to one Electron Builder architecture', () => {
  assert.deepEqual(packageArguments('linux', 'x64'), ['--linux', '--x64']);
  assert.deepEqual(packageArguments('linux', 'arm64'), [
    '--linux',
    'AppImage',
    'tar.gz',
    '--arm64',
  ]);
  assert.deepEqual(packageArguments('darwin', 'x64'), ['--mac', 'dmg', '--x64']);
  assert.deepEqual(packageArguments('darwin', 'arm64'), ['--mac', 'dmg', '--arm64']);
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

test('runs the npm JavaScript CLI through Node when available', () => {
  assert.deepEqual(
    npmInvocation(['run', 'build'], 'win32', { npm_execpath: 'C:\\npm\\npm-cli.js' }, 'node.exe'),
    {
      command: 'node.exe',
      args: ['C:\\npm\\npm-cli.js', 'run', 'build'],
    }
  );
  assert.deepEqual(npmInvocation(['run', 'build'], 'win32', {}, 'node.exe'), {
    command: 'npm.cmd',
    args: ['run', 'build'],
  });
});

test('uses the managed Mac dmgbuild launcher unless the caller overrides it', () => {
  const generated = packageEnvironment(
    { platform: 'darwin', arch: 'arm64' },
    '/workspace',
    {}
  );
  assert.equal(generated.CUSTOM_DMGBUILD_PATH, path.join('/workspace', 'build', 'dmgbuild-managed-mac.cjs'));

  const overridden = packageEnvironment(
    { platform: 'darwin', arch: 'arm64' },
    '/workspace',
    { CUSTOM_DMGBUILD_PATH: '/custom/dmgbuild' }
  );
  assert.equal(overridden.CUSTOM_DMGBUILD_PATH, '/custom/dmgbuild');
  assert.equal(
    packageEnvironment({ platform: 'linux', arch: 'arm64' }, '/workspace', {})
      .CUSTOM_DMGBUILD_PATH,
    undefined
  );
});