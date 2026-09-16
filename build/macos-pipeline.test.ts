// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/1es-pipeline-mac.yml'), 'utf8');
function stage(name: string): string {
  const block = workflow.split(`      - stage: ${name}\n`)[1];
  assert.ok(block, `Missing ${name}`);
  return block.split('      - stage: ')[0];
}

test('enables ARM64 only on an explicitly native 1ES pool with an early host check', () => {
  const arm = stage('Build_arm64');
  assert.doesNotMatch(arm, /condition: eq\(1, 0\)/);
  assert.match(arm, /pool:\n\s+name: Azure Pipelines\n\s+image: macOS-15-arm64\n\s+os: macOS\n\s+hostArchitecture: arm64/);
  assert.match(arm, /test "\$\(uname -m\)" = arm64/);
  assert.ok(arm.indexOf('uname -m') < arm.indexOf('task: GoTool@0'));
  assert.match(arm, /test "\$\(node -p process.arch\)" = arm64/);
  assert.ok(arm.indexOf('node -p process.arch') < arm.indexOf('task: Cache@2'));
  assert.match(workflow, /image: macOS-15\n\s+os: macOS/);
});

test('never restores native dependencies from a cache for a different architecture', () => {
  for (const name of ['Build_arm64', 'Build_x64']) {
    const block = stage(name);
    const caches = block.split('- task: Cache@2').slice(1);
    assert.equal(caches.length, 4);
    for (const cache of caches) {
      const inputs = cache.split(/\n\s+(?:- task:|- checkout:|- bash:)/)[0];
      const identities = inputs.split('\n').filter(line => line.includes(' | '));
      assert.ok(identities.length > 0);
      for (const line of identities) assert.ok(line.includes('$(ARCH)'), line);
    }
  }
});

test('retains both signed notarized assets and their successful-stage dependencies', () => {
  for (const arch of ['arm64', 'x64']) {
    assert.match(stage(`Sign_${arch}`), new RegExp(`condition: succeeded\\('Build_${arch}'\\)`));
    const notarize = stage(`Notarize_${arch}`);
    assert.match(notarize, new RegExp(`condition: succeeded\\('Sign_${arch}'\\)`));
    assert.ok(notarize.includes(`artifactName: aks-desktop-signed-${arch}`));
    assert.ok(notarize.includes('EsrpCodeSigning@5'));
  }
});
