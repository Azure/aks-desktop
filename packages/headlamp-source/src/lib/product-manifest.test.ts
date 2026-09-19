const assert = require('node:assert/strict');
const test = require('node:test');

const { createProductTemplate } = require('./product-manifest.ts');

const runCommands = [
  {
    environment: 'production',
    pluginLocation: 'shipped',
    plugins: [{ bundleName: 'example-plugin', packageName: '@example/plugin' }],
    commands: [{ tool: 'examplectl', args: ['project', 'list'] }],
  },
];

test('creates product configuration with only release plugin sources', () => {
  const template = createProductTemplate({
    version: '1.2.3',
    headlamp: {
      product: { name: 'example', productName: 'Example' },
      checkForUpdates: false,
      runCommands,
      plugins: [
        {
          name: 'example-plugin',
          packageName: '@example/plugin',
          source: 'plugins/example',
          enabledByDefault: true,
        },
        {
          name: 'release-plugin',
          packageName: '@example/release-plugin',
          archive: 'https://example.invalid/release-plugin.tar.gz',
          sha256: 'a'.repeat(64),
          enabledByDefault: false,
        },
      ],
    },
  });

  assert.deepEqual(template, {
    product: { name: 'example', productName: 'Example', version: '1.2.3' },
    checkForUpdates: false,
    runCommands,
    plugins: [
      {
        name: 'release-plugin',
        packageName: '@example/release-plugin',
        archive: 'https://example.invalid/release-plugin.tar.gz',
        sha256: 'a'.repeat(64),
        enabledByDefault: false,
      },
    ],
  });
});

test('requires product and plugin configuration', () => {
  assert.throws(() => createProductTemplate({}), /headlamp\.product/);
});

test('selects platform display names without changing consumer identity', () => {
  const project = {
    version: '1.2.3',
    headlamp: {
      product: { name: 'example', productName: 'Example Desktop' },
      plugins: [],
      build: { productNames: { linux: 'Example-Desktop', mac: 'Example Mac', win: 'Example Windows' } },
    },
  };
  for (const [platform, expected] of [
    ['linux', 'Example-Desktop'], ['darwin', 'Example Mac'], ['win32', 'Example Windows'],
  ]) {
    const manifest = createProductTemplate(project, platform);
    assert.deepEqual(manifest.product, { name: 'example', productName: expected, version: '1.2.3' });
    assert.equal('build' in manifest, false);
  }
  assert.equal(project.headlamp.product.productName, 'Example Desktop');
  assert.equal(createProductTemplate(project, 'freebsd').product.productName, 'Example Desktop');
  project.headlamp.build.productNames.linux = ' ';
  assert.throws(() => createProductTemplate(project, 'linux'), /must be a non-empty string/);
});