// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/1es-pipeline-mac.yml'), 'utf8');
function stage(name: string): string {
  const block = workflow.split(`      - stage: ${name}\n`)[1];
  assert.ok(block, `Missing ${name}`);
  return block.split('      - stage: ')[0];
}

test('keeps unavailable native ARM64 hosting disabled', () => {
  const arm = stage('Build_arm64');
  assert.match(arm, /condition: eq\(1, 0\)/);
  const pool = arm.split('            pool:\n')[1]?.split('            timeoutInMinutes:')[0];
  assert.ok(pool);
  assert.match(pool, /name: GitHub-hosted Agents/);
  assert.match(pool, /vmImage: macos-26-arm64/);
  // The current 1ES template translates `image` only for Azure Pipelines;
  // other named pools receive an ImageOverride demand instead of vmImage.
  assert.doesNotMatch(pool, /^\s+image:/m);
  assert.match(pool, /hostArchitecture: arm64/);
  assert.match(workflow.split('    stages:')[0], /name: Azure Pipelines\n\s+image: macOS-15/);
});

test(
  'rejects an Intel allocation before installing ARM build tools',
  { skip: process.platform === 'win32' },
  () => {
    const arm = stage('Build_arm64');
    const hostCheck = arm.split('- bash: |\n')[1].split('                displayName:')[0];
    assert.ok(arm.indexOf('uname -m') < arm.indexOf('task: GoTool@0'));
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-mac-host-'));
    try {
      fs.writeFileSync(path.join(fixture, 'uname'), '#!/bin/sh\nprintf "%s\\n" "$TEST_MACHINE"\n', {
        mode: 0o755,
      });
      for (const machine of ['arm64', 'x86_64']) {
        const run = () =>
          execFileSync('bash', ['-c', hostCheck], {
            env: { ...process.env, PATH: `${fixture}:${process.env.PATH}`, TEST_MACHINE: machine },
            stdio: 'pipe',
          });
        if (machine === 'arm64') assert.doesNotThrow(run);
        else assert.throws(run);
      }
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
);

test('cache file inputs exist at checkout before npm lifecycle builds the backend', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
  for (const name of ['Build_arm64', 'Build_x64']) {
    const block = stage(name);
    const cacheSteps = block.split('- task: Cache@2').slice(1);
    assert.ok(cacheSteps.length > 0);
    for (const cache of cacheSteps) {
      const inputs = cache.split(/\n\s+(?:- task:|- checkout:|- bash:)/)[0];
      const key = inputs.match(/key: '([^']+)'/)?.[1];
      assert.ok(key);
      if (key.startsWith('npm-download')) {
        assert.doesNotMatch(key, /\*/, `${name}: npm cache key must use explicit files`);
      }
      const files = key
        .split('|')
        .map((part) => part.trim())
        .filter((part) => !part.startsWith('"') && part.includes('.'));
      assert.ok(files.length > 0);
      for (const file of files) {
        const pattern = new RegExp(
          `^${file.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`
        );
        assert.ok(
          tracked.some((entry) => pattern.test(entry)),
          `${name}: cache input ${file} absent at checkout`
        );
      }
      for (const identity of inputs.split('\n').filter((line) => line.includes(' | '))) {
        assert.ok(identity.includes('$(ARCH)'), identity);
      }
    }
    assert.doesNotMatch(block, /path: ['"]?[^\n]*node_modules/);
    assert.match(block, /path: '\$\(Pipeline.Workspace\)\/\.npm'/);
    assert.match(block, /name: NPM_CONFIG_CACHE\n\s+value: \$\(Pipeline.Workspace\)\/\.npm/);
    const install = block.search(/^\s+npm ci\s*$/m);
    assert.ok(install > block.indexOf('Cache Go modules'));
  }
});

test('retains native runtime smoke and both ESRP signed/notarized artifact chains', () => {
  for (const arch of ['arm64', 'x64']) {
    assert.ok(stage(`Build_${arch}`).includes('npm run test:distribution'));
    assert.match(stage(`Sign_${arch}`), new RegExp(`condition: succeeded\\('Build_${arch}'\\)`));
    const notarize = stage(`Notarize_${arch}`);
    assert.match(notarize, new RegExp(`condition: succeeded\\('Sign_${arch}'\\)`));
    assert.ok(
      notarize.includes(
        `artifactName: ${arch === 'arm64' ? 'notarized-dmg-arm64' : 'aks-desktop-signed-x64'}`
      )
    );
    assert.ok(notarize.includes('EsrpCodeSigning@5'));
    assert.ok(stage(`Sign_${arch}`).includes('verify-macos-signing.sh" signed'));
    assert.ok(notarize.includes('verify-macos-signing.sh" notarized'));
  }
});

test('publishes the final ARM artifact only after native signed-app qualification', () => {
  const qualify = stage('Qualify_arm64');
  assert.ok(qualify.includes("condition: succeeded('Notarize_arm64')"));
  assert.ok(qualify.includes('vmImage: macos-26-arm64'));
  assert.ok(qualify.includes('artifactName: notarized-dmg-arm64'));
  assert.ok(qualify.includes('qualify-macos-dmg.sh'));
  assert.ok(qualify.includes('artifactName: aks-desktop-signed-arm64'));
  assert.ok(qualify.includes('npm ci --ignore-scripts'));
  assert.doesNotMatch(qualify, /npm run build/);
});
