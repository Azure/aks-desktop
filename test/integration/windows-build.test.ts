// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
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
