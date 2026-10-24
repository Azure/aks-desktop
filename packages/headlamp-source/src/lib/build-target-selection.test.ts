const assert = require('node:assert/strict');
const test = require('node:test');
const { selectBuildTarget } = require('./build-target-selection.ts');
const { createProductTemplate } = require('./product-manifest.ts');

test('selects explicit targets without serializing build-only fields or mutating inputs', () => {
  const entries = [{ tool: 'portable' }, { tool: 'native', targets: ['win32-x64'] }];
  assert.deepEqual(selectBuildTarget(entries, 'win32', 'x64'), [
    { tool: 'portable' },
    { tool: 'native' },
  ]);
  for (const [platform, arch] of [
    ['linux', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'arm64'],
  ]) {
    assert.deepEqual(selectBuildTarget(entries, platform, arch), [{ tool: 'portable' }]);
  }
  assert.deepEqual(entries[1].targets, ['win32-x64']);
});

test('rejects malformed target constraints rather than enabling tools or grants', () => {
  for (const targets of [[], 'win32-x64', ['windows-x64'], ['win32'], [null]]) {
    assert.throws(() => selectBuildTarget([{ targets }], 'win32', 'x64'), /Build targets/);
  }
});

test('filters authorization, default consent and native providers together', () => {
  const project = {
    version: '1.0.0',
    headlamp: {
      product: { name: 'example' },
      plugins: [],
      runCommands: [
        {
          commands: [{ tool: 'native', args: ['versions'], targets: ['win32-x64'] }],
          approvedCommands: [{ tool: 'native', args: ['versions'], targets: ['win32-x64'] }],
          clusterRegistrationProviders: [{ id: 'local', targets: ['win32-x64'] }],
        },
      ],
    },
  };
  const enabled = createProductTemplate(project, 'win32', 'x64').runCommands[0];
  assert.deepEqual(enabled.commands, [{ tool: 'native', args: ['versions'] }]);
  assert.deepEqual(enabled.approvedCommands, enabled.commands);
  assert.deepEqual(enabled.clusterRegistrationProviders, [{ id: 'local' }]);
  for (const [platform, arch] of [
    ['linux', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'arm64'],
  ]) {
    assert.deepEqual(createProductTemplate(project, platform, arch).runCommands[0], {
      commands: [],
      approvedCommands: [],
      clusterRegistrationProviders: [],
    });
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
    clusterRegistrationProviders: [{ id: 'local', type: 'local', tools: {} }],
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
