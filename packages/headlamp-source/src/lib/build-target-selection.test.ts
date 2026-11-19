const assert = require('node:assert/strict');
const test = require('node:test');
const { selectBuildTarget } = require('./build-target-selection.ts');
const { createProductTemplate } = require('./product-manifest.ts');

test('selects target policies without serializing build-only fields or mutating inputs', () => {
  const policies = [{ id: 'portable' }, { id: 'native', targets: ['win32-x64'] }];
  assert.deepEqual(selectBuildTarget(policies, 'win32', 'x64'), [
    { id: 'portable' },
    { id: 'native' },
  ]);
  for (const [platform, arch] of [
    ['linux', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'arm64'],
  ]) {
    assert.deepEqual(selectBuildTarget(policies, platform, arch), [{ id: 'portable' }]);
  }
  assert.deepEqual(policies[1].targets, ['win32-x64']);
});

test('rejects malformed target constraints rather than enabling policies', () => {
  for (const targets of [[], 'win32-x64', ['windows-x64'], ['win32'], [null]]) {
    assert.throws(() => selectBuildTarget([{ targets }], 'win32', 'x64'), /Build targets/);
  }
});

test('filters whole policies so platform-only executable mappings cannot survive their grants', () => {
  const policy = {
    targets: ['win32-x64'],
    environment: 'production',
    pluginLocation: 'development',
    plugins: [{ bundleName: 'example', packageName: '@example/plugin' }],
    pluginExecutables: [{ tool: 'examplectl' }],
    commands: [{ tool: 'examplectl', args: ['versions'] }],
  };
  const project = {
    version: '1.0.0',
    headlamp: { product: { name: 'example' }, plugins: [], runCommands: [policy] },
  };
  const { targets, ...expected } = policy;
  assert.deepEqual(createProductTemplate(project, 'win32', 'x64').runCommands, [expected]);
  assert.deepEqual(project.headlamp.runCommands[0].targets, targets);
  for (const [platform, arch] of [
    ['linux', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'arm64'],
  ]) {
    assert.deepEqual(createProductTemplate(project, platform, arch).runCommands, []);
  }
});
