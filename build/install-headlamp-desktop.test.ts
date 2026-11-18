// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test, { type TestContext } from 'node:test';
import { dependencyTargetMatches } from './dependency-target';
import {
  discardHeadlampDependencyCache,
  headlampDependencyCacheInputs,
  HEADLAMP_DESKTOP_INSTALL_STEPS,
  installHeadlampDesktopDependencies,
  verifyHeadlampDependencyCache,
} from './install-headlamp-desktop';

function desktopCacheFixture(t: TestContext) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-dependency-cache-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => undefined);
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({
    version: '1.0.0',
    headlampSource: { revision: 'source-revision' },
    headlampPatch: { path: 'patches/source.patch', integrity: 'sha512-source-patch' },
    headlamp: { product: { name: 'product-a' } },
  }));
  const sourceDir = path.join(rootDir, 'node_modules/@headlamp-k8s/headlamp-source/source');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"headlamp-root"}');
  for (const directory of ['frontend', 'app']) {
    fs.mkdirSync(path.join(sourceDir, directory));
    fs.writeFileSync(path.join(sourceDir, directory, 'package.json'), '{"name":"fixture"}');
    fs.writeFileSync(path.join(sourceDir, directory, 'package-lock.json'), '{"lockfileVersion":3}');
  }
  const npmRoot = path.join(rootDir, 'npm');
  fs.mkdirSync(path.join(npmRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(npmRoot, 'package.json'), '{"name":"npm","version":"12.0.1"}');
  const npmCli = path.join(npmRoot, 'bin', 'npm-cli.js');
  fs.writeFileSync(npmCli, '');
  const env: NodeJS.ProcessEnv = { ...process.env, npm_execpath: npmCli };
  const commands: string[] = [];
  const runStep = (args: readonly string[], cwd: string, childEnv: NodeJS.ProcessEnv) => {
    assert.equal(childEnv, env);
    commands.push(`${path.relative(sourceDir, cwd) || '.'}:${args.join(' ')}`);
    if (args[0] !== 'ci') return;
    const installed = path.join(cwd, 'node_modules');
    fs.rmSync(installed, { recursive: true, force: true });
    fs.mkdirSync(path.join(installed, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(installed, '.package-lock.json'), JSON.stringify({
      mode: args.includes('--omit=dev') ? 'production' : 'all',
    }));
    fs.writeFileSync(path.join(installed, 'runtime/index.js'), 'fixture dependency');
  };
  return {
    rootDir, sourceDir, npmRoot, env, commands, runStep,
    options: { rootDir, reuseDependencies: true, env },
  };
}

test('verified Headlamp frontend and app caches skip both clean installs', t => {
  const fixture = desktopCacheFixture(t);
  installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);
  verifyHeadlampDependencyCache(fixture.sourceDir, fixture.rootDir, fixture.env);
  fixture.commands.length = 0;

  installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);

  assert.deepEqual(fixture.commands, ['.:run backend:build']);
  assert.equal(
    dependencyTargetMatches(fixture.rootDir, { platform: process.platform, arch: process.arch }),
    true
  );
});

for (const state of ['missing', 'manifest', 'lock', 'installed-lock', 'marker', 'context', 'configuration']) {
  test(`Headlamp cache reinstalls only the frontend for ${state} state`, t => {
    const fixture = desktopCacheFixture(t);
    installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);
    const frontend = path.join(fixture.sourceDir, 'frontend');
    const changedFiles: Record<string, string> = {
      manifest: 'package.json',
      lock: 'package-lock.json',
      'installed-lock': 'node_modules/.package-lock.json',
      marker: 'node_modules/.headlamp-dependency-identity',
      context: 'node_modules/.aks-desktop-headlamp-context',
      configuration: '.npmrc',
    };
    if (state === 'missing') {
      fs.rmSync(path.join(frontend, 'node_modules'), { recursive: true, force: true });
    } else {
      fs.writeFileSync(
        path.join(frontend, changedFiles[state]),
        state === 'configuration' ? 'legacy-peer-deps=true\n' : '{"changed":true}'
      );
    }
    fixture.commands.length = 0;

    installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);

    assert.deepEqual(fixture.commands, [
      'frontend:ci --prefer-offline --no-audit --no-fund --omit=dev',
      '.:run backend:build',
    ]);
    verifyHeadlampDependencyCache(fixture.sourceDir, fixture.rootDir, fixture.env);
  });
}

for (const changed of [
  'architecture', 'npm', 'install-mode', 'runtime', 'electron-download', 'source', 'patch',
  'install-script', 'root-config',
]) {
  test(`Headlamp cache invalidates both trees after ${changed} changes`, t => {
    const fixture = desktopCacheFixture(t);
    installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);
    const oldKey = headlampDependencyCacheInputs(fixture.sourceDir, fixture.rootDir, fixture.env).key;
    if (changed === 'architecture') {
      fixture.env.npm_config_arch = process.arch === 'arm64' ? 'x64' : 'arm64';
    } else if (changed === 'npm') {
      fs.writeFileSync(path.join(fixture.npmRoot, 'package.json'), '{"name":"npm","version":"12.0.2"}');
    } else if (changed === 'install-mode') {
      fixture.env.npm_config_omit = 'optional';
    } else if (changed === 'runtime') {
      fixture.env.npm_config_runtime = 'electron';
    } else if (changed === 'electron-download') {
      fixture.env.ELECTRON_SKIP_BINARY_DOWNLOAD = '1';
    } else if (changed === 'root-config') {
      fs.writeFileSync(path.join(fixture.rootDir, '.npmrc'), 'legacy-peer-deps=true\n');
    } else {
      const file = path.join(fixture.rootDir, 'package.json');
      const project = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (changed === 'source') project.headlampSource.revision = 'new-revision';
      else if (changed === 'install-script') {
        project.scripts = { 'headlamp:install': 'node changed-install-entrypoint.js' };
      } else project.headlampPatch.integrity = 'sha512-new-patch';
      fs.writeFileSync(file, JSON.stringify(project));
    }
    assert.notEqual(
      headlampDependencyCacheInputs(fixture.sourceDir, fixture.rootDir, fixture.env).key,
      oldKey
    );
    fixture.commands.length = 0;

    installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);

    assert.deepEqual(fixture.commands, [
      'frontend:ci --prefer-offline --no-audit --no-fund --omit=dev',
      '.:run backend:build',
      'app:ci --prefer-offline --no-audit --no-fund',
    ]);
    verifyHeadlampDependencyCache(fixture.sourceDir, fixture.rootDir, fixture.env);
  });
}

test('Headlamp cache keys ignore unrelated consumer product metadata', t => {
  const fixture = desktopCacheFixture(t);
  const initial = headlampDependencyCacheInputs(fixture.sourceDir, fixture.rootDir, fixture.env);
  const file = path.join(fixture.rootDir, 'package.json');
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  project.version = '2.0.0';
  project.headlamp.product.name = 'product-b';
  fs.writeFileSync(file, JSON.stringify(project));

  assert.deepEqual(
    headlampDependencyCacheInputs(fixture.sourceDir, fixture.rootDir, fixture.env),
    initial
  );
  assert.deepEqual(initial.paths, [
    'node_modules/@headlamp-k8s/headlamp-source/source/frontend/node_modules',
    'node_modules/@headlamp-k8s/headlamp-source/source/app/node_modules',
  ]);
});

test('Headlamp cache reuse remains opt-in even when both trees are valid', t => {
  const fixture = desktopCacheFixture(t);
  installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);
  fixture.commands.length = 0;

  installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, {
    ...fixture.options, reuseDependencies: false,
  });

  assert.equal(fixture.commands.length, HEADLAMP_DESKTOP_INSTALL_STEPS.length);
});

test('unconfirmed Headlamp restores discard partial trees even with valid markers', t => {
  const fixture = desktopCacheFixture(t);
  installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);
  for (const name of ['frontend', 'app']) {
    fs.rmSync(path.join(fixture.sourceDir, name, 'node_modules/runtime/index.js'));
  }
  verifyHeadlampDependencyCache(fixture.sourceDir, fixture.rootDir, fixture.env);
  const unrelated = path.join(fixture.rootDir, 'unrelated');
  fs.writeFileSync(unrelated, 'keep');

  discardHeadlampDependencyCache(fixture.sourceDir, fixture.rootDir);

  for (const name of ['frontend', 'app']) {
    assert.equal(fs.existsSync(path.join(fixture.sourceDir, name, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(fixture.sourceDir, name, 'package.json')), true);
  }
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
  assert.equal(
    dependencyTargetMatches(fixture.rootDir, { platform: process.platform, arch: process.arch }),
    false
  );
  assert.throws(
    () => verifyHeadlampDependencyCache(fixture.sourceDir, fixture.rootDir, fixture.env),
    /missing or stale/
  );
  discardHeadlampDependencyCache(fixture.sourceDir, fixture.rootDir);
  fixture.commands.length = 0;
  installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);
  assert.equal(fixture.commands.length, 3);
});

test('failed cache replacement invalidates the previously completed install target', t => {
  const fixture = desktopCacheFixture(t);
  installHeadlampDesktopDependencies(fixture.sourceDir, fixture.runStep, fixture.options);
  fs.rmSync(path.join(fixture.sourceDir, 'frontend/node_modules/.package-lock.json'));

  assert.throws(
    () => installHeadlampDesktopDependencies(fixture.sourceDir, () => {
      throw new Error('clean reinstall failed');
    }, fixture.options),
    /clean reinstall failed/
  );
  assert.equal(
    dependencyTargetMatches(fixture.rootDir, { platform: process.platform, arch: process.arch }),
    false
  );
});

test('Headlamp cache requires an npm lifecycle and refuses paths outside the consumer', t => {
  const fixture = desktopCacheFixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-headlamp-cache-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const sentinel = path.join(outside, 'frontend/node_modules/keep');
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, 'keep');
  assert.throws(
    () => headlampDependencyCacheInputs(fixture.sourceDir, fixture.rootDir, {}),
    /requires an npm lifecycle/
  );
  assert.throws(
    () => discardHeadlampDependencyCache(outside, fixture.rootDir),
    /must stay within/
  );
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  fs.writeFileSync(
    path.join(fixture.npmRoot, 'package.json'),
    '{"name":"npm","version":"12.0.1\\ninvalid-output=true"}'
  );
  assert.throws(
    () => headlampDependencyCacheInputs(fixture.sourceDir, fixture.rootDir, fixture.env),
    /Cannot identify the npm version/
  );
});

test('installs only the Headlamp dependencies required by desktop packaging', () => {
  const commands: string[] = [];
  installHeadlampDesktopDependencies('/workspace/headlamp', (args, cwd) => {
    commands.push(`${path.relative('/workspace/headlamp', cwd) || '.'}:${args.join(' ')}`);
  });

  assert.deepEqual(commands, [
    'frontend:ci --prefer-offline --no-audit --no-fund --omit=dev',
    '.:run backend:build',
    'app:ci --prefer-offline --no-audit --no-fund',
  ]);
  assert.equal(commands.length, HEADLAMP_DESKTOP_INSTALL_STEPS.length);
});

test('can defer backend compilation to the architecture-aware package hook', () => {
  const commands: string[] = [];
  installHeadlampDesktopDependencies(
    '/workspace/headlamp',
    (args, cwd) => {
      commands.push(`${path.relative('/workspace/headlamp', cwd) || '.'}:${args.join(' ')}`);
    },
    { skipBackendBuild: true }
  );

  assert.deepEqual(commands, [
    'frontend:ci --prefer-offline --no-audit --no-fund --omit=dev',
    'app:ci --prefer-offline --no-audit --no-fund',
  ]);
});

test('installs only app dependencies when reusing prepared frontend assets', () => {
  const commands: string[] = [];
  installHeadlampDesktopDependencies(
    '/workspace/headlamp',
    (args, cwd) => {
      commands.push(`${path.relative('/workspace/headlamp', cwd) || '.'}:${args.join(' ')}`);
    },
    { skipBackendBuild: true, skipFrontendInstall: true }
  );

  assert.deepEqual(commands, ['app:ci --prefer-offline --no-audit --no-fund']);
});

test('stops the Headlamp desktop install at the first failed step', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'failed desktop install-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const commands: string[] = [];
  t.mock.method(console, 'log', () => undefined);
  assert.throws(
    () =>
      installHeadlampDesktopDependencies(
        '/workspace/headlamp',
        (args, cwd) => {
          commands.push(`${path.basename(cwd)}:${args.join(' ')}`);
          if (cwd.endsWith('frontend')) {
            throw new Error('clean install failed');
          }
        },
        { rootDir }
      ),
    /clean install failed/
  );
  assert.deepEqual(commands, ['frontend:ci --prefer-offline --no-audit --no-fund --omit=dev']);
  assert.equal(
    dependencyTargetMatches(rootDir, { platform: process.platform, arch: process.arch }),
    false
  );
});

test('records the target only after a successful desktop install', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop install target-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  installHeadlampDesktopDependencies('/workspace/headlamp', () => undefined, { rootDir });

  assert.equal(
    dependencyTargetMatches(rootDir, { platform: process.platform, arch: process.arch }),
    true
  );
});

test('invalidates installed dependencies when a Headlamp lockfile changes', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop lock target-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const sourceDir = path.join(
    rootDir,
    'node_modules',
    '@headlamp-k8s',
    'headlamp-source',
    'source'
  );
  for (const directory of ['frontend', 'app']) {
    fs.mkdirSync(path.join(sourceDir, directory), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, directory, 'package-lock.json'), '{"version":1}\n');
  }
  const target = { platform: process.platform, arch: process.arch };
  installHeadlampDesktopDependencies(sourceDir, () => undefined, { rootDir });
  assert.equal(dependencyTargetMatches(rootDir, target), true);

  fs.writeFileSync(path.join(sourceDir, 'app', 'package-lock.json'), '{"version":2}\n');
  assert.equal(dependencyTargetMatches(rootDir, target), false);
});
