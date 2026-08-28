const assert = require('node:assert/strict');
const test = require('node:test');

const { createProductTemplate } = require('../scripts/product-manifest.ts');

const runCommands = [
  {
    environment: 'production',
    pluginLocation: 'shipped',
    plugins: [{ bundleName: 'example-plugin', packageName: '@example/plugin' }],
    commands: [{ tool: 'examplectl', args: ['project', 'list'] }],
  },
];

test('creates product configuration without consumer-only plugin sources', () => {
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
      ],
    },
  });

  assert.deepEqual(template, {
    product: { name: 'example', productName: 'Example', version: '1.2.3' },
    checkForUpdates: false,
    runCommands,
    plugins: [
      {
        name: 'example-plugin',
        packageName: '@example/plugin',
        enabledByDefault: true,
      },
    ],
  });
});

test('requires product and plugin configuration', () => {
  assert.throws(() => createProductTemplate({}), /headlamp\.product/);
});
