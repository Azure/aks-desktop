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
const workflow = (name: string) =>
  fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', name), 'utf8');

test('PR and scheduled builds validate Windows ARM64 on a native runner', () => {
  const ci = workflow('ci.yml');
  assert.match(ci, /platform: Windows ARM64\s+runner: windows-11-arm/);
  assert.match(ci, /run: npm run build\s/);
  assert.match(ci, /run: npm run test:distribution --/);

  const scheduled = workflow('build-app-win.yml');
  assert.match(scheduled, /arch: arm64\s+runner: windows-11-arm/);
  assert.match(scheduled, /run: npm run build:win:\$\{\{ matrix\.arch \}\}/);
  assert.match(scheduled, /run: npm run test:distribution/);
});

test('PR CI uploads only the ARM64 installer before reinstall can remove it', () => {
  const ci = workflow('ci.yml');
  const applicationBuild = ci.split('\n  application-build:')[1].split('\n  find_changed_plugins:')[0];
  const checkout = applicationBuild.match(/^ {6}- name: Checkout code\n[\s\S]*?(?=\n {6}- name:)/m)?.[0];
  assert.ok(checkout);
  assert.match(checkout, /ref: \$\{\{ matrix\.runner == 'windows-11-arm' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  const upload = applicationBuild.match(/^ {6}- name: Upload Windows ARM64 installer\n[\s\S]*?(?=\n {6}- name:)/m)?.[0];
  assert.ok(upload, 'the native ARM64 job must retain its installer for the tester');
  assert.match(upload, /if: github\.event_name == 'pull_request' && runner\.os == 'Windows' && runner\.arch == 'ARM64'/);
  assert.match(upload, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(upload, /name: aks-desktop-win-arm64\s/);
  assert.match(upload, /path: node_modules\/@headlamp-k8s\/headlamp-source\/source\/app\/dist\/aks-desktop-\*-win-arm64\.exe\s/);
  assert.match(upload, /if-no-files-found: error\s/);
  assert.match(upload, /retention-days: 7\s/);
  assert.ok(applicationBuild.indexOf(upload) < applicationBuild.indexOf('      - name: Reinstall after application assembly'));
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
