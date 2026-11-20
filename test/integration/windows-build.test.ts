// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const APP_DIR = path.join(ROOT_DIR, 'node_modules/@headlamp-k8s/headlamp-source/source/app');
const CACHE_ACTION = '.github/actions/cache-windows-plugin-dependencies';
const HEADLAMP_CACHE_ACTION = '.github/actions/cache-headlamp-dependencies';
const workflow = (name: string) =>
  fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', name), 'utf8');

function workflowJob(contents: string, name: string): string {
  const job = contents.match(
    new RegExp(`^  ${name}:\\r?\\n[\\s\\S]*?(?=^  [\\w-]+:|(?![\\s\\S]))`, 'm')
  );
  assert.ok(job, `Missing workflow job: ${name}`);
  return job[0];
}

function workflowStep(contents: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const step = contents.match(
    new RegExp(
      `^([ \\t]*)- name: ${escapedName}\\r?\\n[\\s\\S]*?(?=^\\1- |(?![\\s\\S]))`,
      'm'
    )
  );
  assert.ok(step, `Missing workflow step: ${name}`);
  return step[0];
}

test('PR and scheduled builds validate Windows ARM64 on a native runner', () => {
  const ci = workflowJob(workflow('ci.yml'), 'application-build');
  assert.match(ci, /platform: Windows ARM64\s+runner: windows-11-arm/);
  assert.match(ci, /run: npm run build\s/);
  assert.match(ci, /run: npm run test:distribution --/);
  assert.match(ci, /name: Validate packaged theme and reload behavior\s+if: runner\.os != 'Linux'\s+run: npm run test:packaged-theme/);

  const scheduled = workflowJob(workflow('build-app-win.yml'), 'build');
  assert.match(scheduled, /arch: arm64\s+runner: windows-11-arm/);
  assert.match(scheduled, /run: npm run build:win:\$\{\{ matrix\.arch \}\}/);
  assert.match(scheduled, /run: npm run test:distribution/);
});

test('scheduled Windows cache writes use the workflow event commit', () => {
  const contents = workflow('build-app-win.yml');
  const build = workflowJob(contents, 'build');
  const checkout = workflowStep(build, 'Checkout this repository');
  assert.match(checkout, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(contents, /workflow_dispatch:/);
  assert.doesNotMatch(contents, /aks_plugin_branch|github\.event\.inputs/);
});

test('Windows builds cache installed plugin trees separately by architecture and exact inputs', () => {
  const action = fs.readFileSync(path.join(ROOT_DIR, CACHE_ACTION, 'action.yml'), 'utf8');
  const sharedCache = workflowStep(action, 'Cache Windows plugin dependencies');
  assert.match(sharedCache, /uses: actions\/cache@[a-f0-9]{40}/);
  assert.match(sharedCache, /key: windows-plugin-deps-v3-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-node-\$\{\{ inputs\.node-version \}\}-/);
  assert.match(sharedCache, /hashFiles\('package\.json', '\.npmrc', '\.config\/npm\/package\*\.json', 'build\/install-dependencies\.ts'/);
  assert.ok(sharedCache.includes(`'${CACHE_ACTION}/action.yml'`));
  assert.ok(sharedCache.includes("'packages/headlamp-source/src/lib/bundle-plugins.ts'"));
  for (const plugin of ['aks-desktop', 'aks-desktop-theme', 'plugin-catalog']) {
    assert.ok(sharedCache.includes(`'plugins/${plugin}/.npmrc'`));
    assert.ok(sharedCache.includes(`'plugins/${plugin}/package*.json'`));
    assert.ok(sharedCache.includes(`plugins/${plugin}/node_modules`));
  }
  assert.doesNotMatch(action, /insights-plugin|plugins\/\*\//);
  assert.doesNotMatch(sharedCache, /restore-keys:/);
  const reuse = workflowStep(action, 'Enable verified plugin dependency reuse');
  assert.match(reuse, /HEADLAMP_REUSE_PLUGIN_DEPENDENCIES=aks-desktop,aks-desktop-theme,plugin-catalog/);
  assert.match(reuse, />> "\$GITHUB_ENV"/);

  for (const name of ['ci.yml', 'build-app-win.yml']) {
    const build = workflowJob(workflow(name), name === 'ci.yml' ? 'application-build' : 'build');
    const cache = workflowStep(build, 'Cache Windows plugin dependencies');
    assert.ok(cache.includes(`uses: ./${CACHE_ACTION}`));
    if (name === 'ci.yml') assert.match(cache, /if: runner\.os == 'Windows'/);
    assert.ok(build.indexOf(cache) < build.indexOf(workflowStep(build, 'Install dependencies')));
    const setupNode = workflowStep(build, name === 'ci.yml' ? 'Setup Node.js' : 'Setup nodejs');
    const nodeVersion = setupNode.match(/node-version: (.+)/)?.[1];
    assert.ok(nodeVersion);
    assert.ok(cache.includes(`node-version: ${nodeVersion}`));
    assert.match(setupNode, /cache: "npm"/);
    for (const lockfile of [
      '.config/npm/package-lock.json',
      'package-lock.json',
      'plugins/*/package-lock.json',
    ]) {
      assert.ok(setupNode.includes(lockfile));
    }
    assert.doesNotMatch(build, /--reuse-prepared-assets|run: npm run ci:windows/);
  }
});

test('unconfirmed Windows plugin cache restores discard partial trees before reuse', t => {
  const { reusePluginDependencies, writePluginDependencyMarker } = require(
    '../../packages/headlamp-source/src/lib/bundle-plugins.ts'
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'partial plugin cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plugins = ['aks-desktop', 'aks-desktop-theme', 'plugin-catalog'];
  const env = { HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: plugins.join(',') };
  for (const plugin of plugins) {
    const directory = path.join(root, 'plugins', plugin);
    fs.mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
    for (const file of ['package.json', 'package-lock.json', 'node_modules/.package-lock.json']) {
      fs.writeFileSync(path.join(directory, file), '{}');
    }
    writePluginDependencyMarker(directory);
    assert.equal(reusePluginDependencies(directory, plugin, env), true);
  }
  const preserved = ['insights-plugin', 'unrelated'];
  for (const plugin of preserved) {
    const directory = path.join(root, 'plugins', plugin, 'node_modules');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'keep'), plugin);
  }

  const action = fs.readFileSync(path.join(ROOT_DIR, CACHE_ACTION, 'action.yml'), 'utf8');
  const restore = workflowStep(action, 'Cache Windows plugin dependencies');
  const cacheId = restore.match(/\bid: ([\w-]+)/)?.[1];
  assert.ok(cacheId);
  const discard = workflowStep(action, 'Discard unconfirmed plugin caches');
  assert.ok(discard.includes(`if: steps.${cacheId}.outputs.cache-hit != 'true'`));
  assert.match(discard, /shell: bash/);
  assert.ok(action.indexOf(restore) < action.indexOf(discard));
  assert.ok(action.indexOf(discard) < action.indexOf(workflowStep(action, 'Enable verified plugin dependency reuse')));
  const script = discard.match(/\brun: \|\r?\n([\s\S]*)/)?.[1];
  assert.ok(script);
  const runCleanup = () => {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  };
  runCleanup();
  for (const plugin of plugins) {
    const directory = path.join(root, 'plugins', plugin);
    assert.equal(fs.existsSync(path.join(directory, 'node_modules')), false);
    assert.equal(reusePluginDependencies(directory, plugin, env), false);
    assert.equal(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'), '{}');
  }
  runCleanup();
  for (const plugin of preserved) {
    assert.equal(
      fs.readFileSync(path.join(root, 'plugins', plugin, 'node_modules', 'keep'), 'utf8'),
      plugin
    );
  }
});

test('Windows restores Headlamp after root npm ci and saves verified trees before packaging', () => {
  const action = fs.readFileSync(path.join(ROOT_DIR, HEADLAMP_CACHE_ACTION, 'action.yml'), 'utf8');
  const names = [
    'Resolve Headlamp cache inputs',
    'Restore Headlamp dependencies',
    'Discard unconfirmed Headlamp dependencies',
    'Install Headlamp dependencies',
    'Verify Headlamp dependency snapshot',
    'Save Headlamp dependencies',
  ];
  const steps = names.map(name => workflowStep(action, name));
  assert.match(steps[0], /run: npm run headlamp:install -- --cache-inputs/);
  for (const input of [
    `${HEADLAMP_CACHE_ACTION}/action.yml`,
    'build/install-headlamp-desktop.ts',
    'build/install-dependencies.ts',
    'build/build-timing.ts',
    'build/dependency-target.ts',
    '.config/npm/package*.json',
    'packages/headlamp-source/src/lib/bundle-plugins.ts',
    'packages/headlamp-source/src/lib/npm-command.ts',
  ]) {
    assert.ok(steps[0].includes(`'${input}'`));
  }
  assert.match(steps[1], /uses: actions\/cache\/restore@[a-f0-9]{40}/);
  assert.match(steps[1], /key: \$\{\{ steps\.cache-inputs\.outputs\.key \}\}/);
  assert.match(steps[1], /path: \$\{\{ steps\.cache-inputs\.outputs\.paths \}\}/);
  const cacheId = steps[1].match(/\bid: ([\w-]+)/)?.[1];
  assert.ok(cacheId);
  for (const conditional of [steps[2], steps[5]]) {
    assert.ok(conditional.includes(`if: steps.${cacheId}.outputs.cache-hit != 'true'`));
  }
  assert.match(steps[2], /run: npm run headlamp:install -- --discard-cache/);
  assert.match(steps[3], /HEADLAMP_REUSE_DESKTOP_DEPENDENCIES: 'true'/);
  assert.match(steps[3], /run: npm run headlamp:install\s*$/);
  assert.match(steps[4], /run: npm run headlamp:install -- --verify-cache/);
  assert.match(steps[5], /uses: actions\/cache\/save@[a-f0-9]{40}/);
  assert.match(steps[5], /key: \$\{\{ steps\.cache-inputs\.outputs\.key \}\}/);
  assert.match(steps[5], /path: \$\{\{ steps\.cache-inputs\.outputs\.paths \}\}/);
  assert.doesNotMatch(action, /restore-keys:/);
  for (let index = 1; index < steps.length; index++) {
    assert.ok(action.indexOf(steps[index - 1]) < action.indexOf(steps[index]));
  }

  for (const name of ['ci.yml', 'build-app-win.yml']) {
    const job = workflowJob(workflow(name), name === 'ci.yml' ? 'application-build' : 'build');
    const rootInstall = workflowStep(job, 'Install dependencies');
    const headlamp = workflowStep(job, 'Restore and install Headlamp dependencies');
    const build = workflowStep(job, name === 'ci.yml'
      ? 'Build application for host platform'
      : 'Setup AKS desktop and Build Headlamp (Windows)');
    assert.match(rootInstall, /run: npm ci --prefer-offline --no-audit --no-fund/);
    assert.doesNotMatch(rootInstall, /--ignore-scripts/);
    assert.ok(headlamp.includes(`uses: ./${HEADLAMP_CACHE_ACTION}`));
    if (name === 'ci.yml') {
      assert.ok(rootInstall.includes("runner.os == 'Windows' && 'true' || ''"));
      assert.match(headlamp, /if: runner\.os == 'Windows'/);
    } else {
      assert.match(rootInstall, /HEADLAMP_DEFER_DESKTOP_INSTALL: 'true'/);
    }
    assert.ok(job.indexOf(rootInstall) < job.indexOf(headlamp));
    assert.ok(job.indexOf(headlamp) < job.indexOf(build));
  }
});

test('Dependabot covers the shared plugin and Headlamp cache actions', () => {
  const configuration = fs.readFileSync(path.join(ROOT_DIR, '.github/dependabot.yml'), 'utf8');
  for (const action of [CACHE_ACTION, HEADLAMP_CACHE_ACTION]) {
    assert.ok(configuration.includes(`'/${action}'`));
  }
});

test('PR CI verifies patch contracts before assembly and uploads the native ARM64 installer', () => {
  const applicationBuild = workflowJob(workflow('ci.yml'), 'application-build');
  const checkout = workflowStep(applicationBuild, 'Checkout code');
  assert.match(checkout, /ref: \$\{\{ matrix\.runner == 'windows-11-arm' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  const upload = workflowStep(applicationBuild, 'Upload Windows ARM64 installer');
  assert.match(upload, /if: github\.event_name == 'pull_request' && runner\.os == 'Windows' && runner\.arch == 'ARM64'/);
  assert.match(upload, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(upload, /name: aks-desktop-win-arm64\s/);
  assert.match(upload, /path: node_modules\/@headlamp-k8s\/headlamp-source\/source\/app\/dist\/aks-desktop-\*-win-arm64\.exe\s/);
  assert.match(upload, /if-no-files-found: error\s/);
  assert.match(upload, /retention-days: 7\s/);
  const installation = applicationBuild.indexOf(workflowStep(applicationBuild, 'Install dependencies'));
  const contractStep = workflowStep(applicationBuild, 'Verify Headlamp patch contracts');
  const contracts = applicationBuild.indexOf(contractStep);
  const build = applicationBuild.indexOf(workflowStep(applicationBuild, 'Build application for host platform'));
  assert.ok(installation >= 0 && installation < contracts && contracts < build);
  assert.match(contractStep, /run: npm run test:headlamp-patches/);
  assert.doesNotMatch(applicationBuild, /Reinstall after application assembly/);
});

test('installed effective NSIS selection matches the single replacement stub', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nsis-selection-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
  );
  project.headlamp.build = {
    manifest: project.headlamp.build.manifest,
    resources: [],
    externalTools: [],
  };
  const {
    createManifest,
  } = require('../../packages/headlamp-source/src/lib/generate-product-manifest.ts');
  for (const targets of [undefined, ['portable'], ['nsis', 'portable']]) {
    if (targets) project.headlamp.targets.win = targets;
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify(project)
    );
    const { manifest } = createManifest({
      rootDir: directory,
      packageDir: path.dirname(path.dirname(APP_DIR)),
      platform: 'win32',
    });
    const manifestPath = path.join(directory, 'product.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = spawnSync(
      process.execPath,
      [
        '--eval',
        `
    (async () => {
      const fs = require('fs'); const path = require('path');
      const config = await require('app-builder-lib/out/util/config/config').getConfig(process.cwd(), 'electron-builder.config.ts', {});
      require('app-builder-lib');
      const { PlatformPackager } = require('app-builder-lib/out/platformPackager');
      const resources = path.resolve(process.cwd(), config.directories.buildResources);
      const context = { info: { buildResourcesDir: resources }, projectDir: process.cwd(),
        resourceList: Promise.resolve(fs.existsSync(resources) ? fs.readdirSync(resources) : []) };
      const nsis = config.nsis || {};
      console.log('NSIS-CONTRACT:' + JSON.stringify({
        target: config.win.target, unicode: nsis.unicode !== false,
        customBinary: nsis.customNsisBinary ?? null, toolset: config.toolsets?.nsis ?? null,
        script: nsis.script ?? null, include: nsis.include ?? null,
        discoveredScript: await PlatformPackager.prototype.getResource.call(context, nsis.script, 'installer.nsi'),
        discoveredInclude: await PlatformPackager.prototype.getResource.call(context, nsis.include, 'installer.nsh')
      }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `,
      ],
      {
        cwd: APP_DIR,
        env: { ...process.env, HEADLAMP_BUILD_MANIFEST: manifestPath },
        encoding: 'utf8',
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const effective = JSON.parse(result.stdout.split('NSIS-CONTRACT:')[1]);
    const message =
      'NSIS selection changed: re-evaluate/rebuild build/nsis-aslr';
    const assertSelection = () =>
      assert.deepEqual(
        effective,
        {
          target: ['nsis'],
          unicode: true,
          customBinary: null,
          toolset: null,
          script: null,
          include: null,
          discoveredScript: null,
          discoveredInclude: null,
        },
        message
      );
    if (targets) assert.throws(assertSelection, /NSIS selection changed/);
    else assertSelection();
  }
  // Narrow characterization of the lockfile-pinned compiler-command selection.
  // Config import does not execute buildInstaller; the Windows build gate does.
  const source = fs.readFileSync(
    path.join(
      APP_DIR,
      'node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js'
    ),
    'utf8'
  );
  assert.match(source, /Unicode: this\.isUnicodeEnabled/);
  assert.match(source, /return this\.options\.unicode !== false/);
  assert.match(source, /commands\.SetCompressor = "zlib"/);
  assert.match(
    source,
    /compression === "store"[\s\S]*?commands\.SetCompress = "off"/
  );
});

test('installed electron-builder resolves the pinned bundle and honors the complete toolset override', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nsis-resolver-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const compiler =
    process.platform === 'win32'
      ? 'Bin/makensis.exe'
      : process.platform === 'darwin'
      ? 'mac/makensis'
      : 'linux/makensis';
  fs.mkdirSync(path.dirname(path.join(root, compiler)), { recursive: true });
  fs.writeFileSync(path.join(root, compiler), 'not executed');
  fs.writeFileSync(path.join(root, 'elevate.exe'), 'not executed');
  const result = spawnSync(
    process.execPath,
    [
      '--eval',
      `
    (async () => {
      const assert = require('assert/strict'); const path = require('path');
      require('app-builder-lib');
      delete process.env.ELECTRON_BUILDER_NSIS_DIR;
      const downloads = require('app-builder-lib/out/binDownload');
      let calls = [];
      downloads.getBinFromUrl = async (...args) => { calls.push(args); return process.argv[1]; };
      downloads.getBinFromCustomLoc = async () => { throw new Error('unexpected custom download'); };
      const resolver = require('app-builder-lib/out/toolsets/windows');
      await resolver.getMakeNsisPath(undefined, undefined);
      assert.deepEqual(calls, [['nsis-3.0.4.1', 'nsis-3.0.4.1.7z', '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa']]);
      process.env.ELECTRON_BUILDER_NSIS_DIR = process.argv[1];
      const resolved = await resolver.getMakeNsisPath('invalid-version', {url:'invalid', checksum:'invalid'});
      assert.equal(resolved.path, path.join(process.argv[1], process.argv[2]));
      assert.equal(await resolver.getNsisElevatePath('invalid-version', undefined), path.join(process.argv[1], 'elevate.exe'));
      assert.equal(calls.length, 1);
    })().catch(error => { console.error('Re-evaluate/rebuild build/nsis-aslr:', error); process.exitCode = 1; });
  `,
      root,
      compiler,
    ],
    { cwd: APP_DIR, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
});

test('PR CI independently rebuilds NSIS stubs without a path condition', () => {
  const job = workflow('ci.yml')
    .split('\n  nsis-stubs:')[1]
    ?.split(/\n  [a-z_-]+:/)[0];
  assert.ok(job, 'separate nsis-stubs job required');
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /uses: actions\/checkout@[a-f0-9]{40}/);
  assert.match(job, /run: build\/nsis-aslr\/build-stubs\.sh --check/);
  assert.doesNotMatch(job, /\bif:|\bneeds:/);
});

for (const missing of [undefined, 'x64', 'arm64']) {
  test(`release collection requires both installers (${missing ?? 'both present'})`, {
    skip: process.platform === 'win32',
  }, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-windows-build-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dist = path.join(root, 'node_modules/@headlamp-k8s/headlamp-source/source/app/dist');
    const workspace = path.join(root, 'workspace with spaces');
    fs.mkdirSync(dist, { recursive: true });
    const installers = ['x64', 'arm64'].map(arch => `aks-desktop-0.10.0-win-${arch}.exe`);
    for (const installer of installers) {
      if (!missing || !installer.endsWith(`-${missing}.exe`)) {
        fs.writeFileSync(path.join(dist, installer), installer);
      }
    }
    fs.writeFileSync(path.join(dist, 'unrelated.exe'), 'not an installer');

    const release = workflow('1es-pipeline.yml');
    assert.match(release, /npm run ci:windows/);
    assert.match(release, /FolderPath: "\$\(Pipeline\.Workspace\)\/aks-desktop-exe-unsigned"\s+Pattern: "\*\.exe"/);
    const start = release.indexOf('mkdir -p "$(Pipeline.Workspace)/aks-desktop-exe-unsigned"');
    const end = release.indexOf('echo "Copied to', start);
    assert.ok(start >= 0 && end > start);
    const collection = release.slice(start, end).replaceAll('$(Pipeline.Workspace)', workspace);
    const result = spawnSync('bash', ['-e', '-c', collection], { cwd: root, encoding: 'utf8' });
    if (missing) {
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, new RegExp(`No aks-desktop ${missing} .exe file found`));
    } else {
      assert.equal(result.status, 0, result.stderr);
      const output = path.join(workspace, 'aks-desktop-exe-unsigned');
      assert.deepEqual(fs.readdirSync(output).sort(), installers.sort());
      for (const installer of installers) {
        assert.equal(fs.readFileSync(path.join(output, installer), 'utf8'), installer);
      }
    }
  });
}
