// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const { withAksToolPaths, stageAksToolEnvironment } = require('./aks-tool-environment.cjs');

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`stages AKS runtime tooling and prefers verified bundled tools on ${platform}`, context => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aks runtime-')));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    stageAksToolEnvironment(directory);
    const staged = path.join(directory, 'external-tools', 'aks-tool-environment.cjs');
    assert.ok(fs.readFileSync(staged).equals(fs.readFileSync(path.join(__dirname, 'aks-tool-environment.cjs'))));
    const runtime = require(staged);
    const name = platform === 'win32' ? 'az.cmd' : 'az';
    fs.writeFileSync(path.join(directory, 'external-tools', name), 'bundled CLI');
    const entry = { path: `external-tools/${name}`, sha256: createHash('sha256').update('bundled CLI').digest('hex') };
    const manifest = { 'external-tools': [{ id: 'az', platforms: { [platform]: entry } }] };
    const key = platform === 'win32' ? 'Path' : 'PATH';
    const environment = { [key]: '/shell/bin', HOME: '/home' };
    assert.deepEqual(runtime.withAksToolPaths(environment, manifest, directory, platform), {
      [key]: `${path.join(directory, 'external-tools')}${platform === 'win32' ? ';' : ':'}/shell/bin`, HOME: '/home',
    });
    assert.equal(environment[key], '/shell/bin');
    fs.writeFileSync(path.join(directory, 'external-tools', name), 'changed');
    assert.throws(() => runtime.withAksToolPaths(environment, manifest, directory, platform), /integrity mismatch/);
    entry.path = '../outside';
    assert.throws(() => runtime.withAksToolPaths(environment, manifest, directory, platform), /escapes resources/);
    entry.path = 'missing';
    assert.throws(() => runtime.withAksToolPaths(environment, manifest, directory, platform), /ENOENT/);
  });
}

test('AKS runtime accepts confined wrapper links but rejects escaped tools', { skip: process.platform === 'win32' }, context => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aks wrapper-')));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resources = path.join(directory, 'resources');
  fs.mkdirSync(resources);
  fs.writeFileSync(path.join(resources, 'wrapper'), 'wrapper');
  fs.symlinkSync('wrapper', path.join(resources, 'az'));
  const entry = { path: 'az', sha256: createHash('sha256').update('wrapper').digest('hex') };
  const manifest = { 'external-tools': [{ id: 'az', platforms: { [process.platform]: entry } }] };
  assert.equal(withAksToolPaths({ PATH: '/shell' }, manifest, resources).PATH, `${resources}${path.delimiter}/shell`);
  fs.writeFileSync(path.join(directory, 'outside'), 'wrapper');
  fs.unlinkSync(path.join(resources, 'az'));
  fs.symlinkSync('../outside', path.join(resources, 'az'));
  assert.throws(() => withAksToolPaths({}, manifest, resources), /escapes resources/);
});

import {
  npmExecutable,
  npmInvocation,
  packageArguments,
  packageEnvironment,
  packageTarget,
  requiresTargetDependencyInstall,
  stageBackendExecutable,
  validatePackageHost,
} from './package-target';

for (const failPackaging of [false, true]) {
  test(`reports build output only after successful packaging (failure: ${failPackaging})`, t => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build output-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    const sourceDir = path.join(rootDir, 'node_modules', '@headlamp-k8s', 'headlamp-source', 'source');
    const distDir = path.join(sourceDir, 'app', 'dist');
    const targetRecord = path.join(distDir, '.package-target.json');
    const target = { platform: process.platform, arch: process.arch };
    fs.mkdirSync(path.join(sourceDir, 'backend'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'backend', 'headlamp-server'), 'fixture');
    let packaged = false;
    const messages: string[] = [];
    t.mock.method(console, 'log', (message: string) => {
      if (message.startsWith('\nBuild complete')) {
        assert.ok(packaged);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetRecord, 'utf8')), target);
        messages.push(message);
      }
    });
    const runStep = (args: string[], cwd: string) => {
      assert.equal(messages.length, 0);
      if (args[1] === 'package') {
        assert.equal(cwd, path.join(sourceDir, 'app'));
        if (failPackaging) throw new Error('packaging failed');
        fs.mkdirSync(distDir, { recursive: true });
        packaged = true;
      }
    };
    if (failPackaging) {
      assert.throws(() => packageTarget(target, rootDir, runStep), /packaging failed/);
      assert.deepEqual(messages, []);
      assert.equal(fs.existsSync(targetRecord), false);
    } else {
      packageTarget(target, rootDir, runStep);
      assert.deepEqual(messages, [
        `\nBuild complete (${target.platform}/${target.arch}).\nOutput directory: ${path.resolve(distDir)}`,
      ]);
    }
  });
}

test('stages the newly built backend under the Windows packaging filename', t => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-backend-'));
  t.after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));
  const backend = path.join(sourceDir, 'backend');
  fs.mkdirSync(backend);
  fs.writeFileSync(path.join(backend, 'headlamp-server'), 'new backend');
  fs.writeFileSync(path.join(backend, 'headlamp-server.exe'), 'stale backend');
  stageBackendExecutable(sourceDir, 'win32');
  assert.equal(fs.readFileSync(path.join(backend, 'headlamp-server.exe'), 'utf8'), 'new backend');
  fs.rmSync(path.join(backend, 'headlamp-server'));
  assert.throws(() => stageBackendExecutable(sourceDir, 'win32'), /ENOENT/);
  assert.doesNotThrow(() => stageBackendExecutable(sourceDir, 'linux'));
});

test('packages installed dependencies once and reports timestamped phase timings', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'package timing-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const sourceDir = path.join(rootDir, 'node_modules', '@headlamp-k8s', 'headlamp-source', 'source');
  const appDir = path.join(sourceDir, 'app');
  fs.mkdirSync(path.join(sourceDir, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'backend', 'headlamp-server'), 'fixture');

  const commands: string[] = [];
  const messages: string[] = [];
  t.mock.method(console, 'log', (message: string) => messages.push(message));
  packageTarget({ platform: process.platform, arch: process.arch }, rootDir, (args, cwd) => {
    commands.push(`${cwd === rootDir ? 'root' : cwd === sourceDir ? 'source' : 'app'}:${args.join(' ')}`);
    if (cwd === appDir && args[1] === 'package') {
      fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });
    }
  });

  assert.equal(commands.includes('root:run headlamp:install'), false);
  assert.deepEqual(commands, [
    'root:run headlamp:tools -- --platform=' + process.platform + ' --arch=' + process.arch,
    'root:run headlamp:translations',
    'root:run plugin:setup',
    'root:run headlamp:manifest',
    'root:run headlamp:frontend-env',
    'source:run frontend:build',
    `app:run package -- ${packageArguments(process.platform, process.arch).join(' ')}`,
  ]);
  assert.match(messages.join('\n'), /\[build-timing\].+started at \d{4}-\d{2}-\d{2}T/);
  assert.match(messages.join('\n'), /\[build-timing\].+completed in \d+\.\d{3}s/);
});

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

test('reinstalls target dependencies only for cross-architecture packages', () => {
  assert.equal(
    requiresTargetDependencyInstall({ platform: 'darwin', arch: 'arm64' }, 'arm64'),
    false
  );
  assert.equal(
    requiresTargetDependencyInstall({ platform: 'linux', arch: 'x64' }, 'x64'),
    false
  );
  assert.equal(
    requiresTargetDependencyInstall({ platform: 'win32', arch: 'x64' }, 'x64'),
    false
  );
  assert.equal(
    requiresTargetDependencyInstall({ platform: 'win32', arch: 'arm64' }, 'x64'),
    true
  );
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
  assert.equal(
    generated.CUSTOM_DMGBUILD_PATH,
    path.join('/workspace', 'build', 'dmgbuild-managed-mac.cjs')
  );
  assert.equal(generated.HEADLAMP_REUSE_PLUGIN_DEPENDENCIES, '1');

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