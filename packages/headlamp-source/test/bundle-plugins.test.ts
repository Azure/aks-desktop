// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  bundleConfiguredPlugins,
  bundlePlugin,
  copyPlugin,
  validatePluginConfiguration,
} = require('../scripts/bundle-plugins.ts');

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs
    .splice(0)
    .forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function createPlugin(packageName: string) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-desktop-plugin-'));
  const pluginDir = path.join(rootDir, 'source');
  const pluginsDir = path.join(rootDir, '.plugins');
  tempDirs.push(rootDir);

  fs.mkdirSync(path.join(pluginDir, 'dist', 'locales'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'dist', 'main.js'), 'plugin bundle');
  fs.writeFileSync(path.join(pluginDir, 'dist', 'locales', 'en.json'), '{}');
  fs.writeFileSync(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({ name: packageName })
  );

  return { pluginDir, pluginsDir };
}

test('copies a scoped plugin to a direct shipped-plugin directory', () => {
  const packageName = '@headlamp-k8s/ai-assistant';
  const { pluginDir, pluginsDir } = createPlugin(packageName);
  const legacyDir = path.join(pluginsDir, packageName);
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'stale.js'), 'stale bundle');
  const existingTargetDir = path.join(pluginsDir, 'ai-assistant');
  fs.mkdirSync(existingTargetDir, { recursive: true });
  fs.writeFileSync(path.join(existingTargetDir, 'stale.js'), 'stale bundle');

  const targetDir = copyPlugin(pluginDir, pluginsDir, {
    name: 'ai-assistant',
    packageName,
    source: 'plugins/ai-assistant',
  });

  assert.equal(targetDir, path.join(pluginsDir, 'ai-assistant'));
  assert.equal(fs.existsSync(path.join(targetDir, 'main.js')), true);
  assert.equal(fs.existsSync(path.join(targetDir, 'locales', 'en.json')), true);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'))
      .name,
    packageName
  );
  assert.equal(fs.existsSync(path.join(targetDir, 'stale.js')), false);
  assert.equal(fs.existsSync(path.join(pluginsDir, '@headlamp-k8s')), false);
});

test('preserves the directory name for an unscoped plugin', () => {
  const packageName = 'aks-desktop';
  const { pluginDir, pluginsDir } = createPlugin(packageName);

  const targetDir = copyPlugin(pluginDir, pluginsDir, {
    name: packageName,
    packageName,
    source: `plugins/${packageName}`,
  });

  assert.equal(targetDir, path.join(pluginsDir, packageName));
  assert.equal(fs.existsSync(path.join(targetDir, 'main.js')), true);
});

test('rejects unsafe plugin bundle names', () => {
  const packageName = '../outside';
  const { pluginDir, pluginsDir } = createPlugin(packageName);
  const outsideDir = path.join(path.dirname(pluginsDir), 'outside');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'sentinel'), 'keep');

  assert.throws(
    () =>
      copyPlugin(pluginDir, pluginsDir, {
        name: packageName,
        packageName,
        source: 'plugins/outside',
      }),
    /Invalid plugin bundle name/
  );
  assert.equal(fs.existsSync(path.join(outsideDir, 'sentinel')), true);
});

test('rejects a plugin whose package identity does not match', () => {
  const { pluginDir, pluginsDir } = createPlugin('unexpected-plugin');

  assert.throws(
    () =>
      copyPlugin(pluginDir, pluginsDir, {
        name: 'expected-plugin',
        packageName: 'expected-plugin',
        source: 'plugins/expected-plugin',
      }),
    /Plugin package mismatch/
  );
  assert.equal(fs.existsSync(path.join(pluginsDir, 'expected-plugin')), false);
});

test('preserves staged bundles when package names overlap bundle names', () => {
  const first = createPlugin('@example/first');
  const secondRoot = path.dirname(first.pluginDir);
  const secondPluginDir = path.join(secondRoot, 'second');
  fs.mkdirSync(path.join(secondPluginDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(secondPluginDir, 'dist', 'main.js'), 'second bundle');
  fs.writeFileSync(
    path.join(secondPluginDir, 'package.json'),
    JSON.stringify({ name: 'first' })
  );

  copyPlugin(
    first.pluginDir,
    first.pluginsDir,
    {
      name: 'first',
      packageName: '@example/first',
      source: 'plugins/first',
    },
    false
  );
  copyPlugin(
    secondPluginDir,
    first.pluginsDir,
    {
      name: 'second',
      packageName: 'first',
      source: 'plugins/second',
    },
    false
  );

  assert.equal(
    fs.readFileSync(path.join(first.pluginsDir, 'first', 'main.js'), 'utf8'),
    'plugin bundle'
  );
  assert.equal(
    fs.readFileSync(path.join(first.pluginsDir, 'second', 'main.js'), 'utf8'),
    'second bundle'
  );
});

test('rejects case-insensitive bundle name collisions', () => {
  assert.throws(
    () =>
      validatePluginConfiguration([
        {
          name: 'example',
          packageName: '@one/example',
          source: 'plugins/example',
        },
        {
          name: 'Example',
          packageName: '@two/example',
          source: 'plugins/other-example',
        },
      ]),
    /duplicate bundle names/
  );
});

test('rejects duplicate plugin package identities', () => {
  assert.throws(
    () =>
      validatePluginConfiguration([
        {
          name: 'first',
          packageName: '@example/plugin',
          source: 'plugins/first',
        },
        {
          name: 'second',
          packageName: '@example/Plugin',
          source: 'plugins/second',
        },
      ]),
    /duplicate package identities/
  );
});

test('copies a prebuilt npm dependency as a shipped plugin', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-desktop-package-'));
  tempDirs.push(rootDir);
  const packageName = '@example/shipped-plugin';
  const pluginDir = path.join(rootDir, 'node_modules', packageName);
  const pluginsDir = path.join(rootDir, '.plugins');
  fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'dist', 'main.js'), 'prebuilt bundle');
  fs.writeFileSync(
    path.join(pluginDir, 'package.json'),
    JSON.stringify({ name: packageName })
  );

  bundlePlugin(rootDir, pluginsDir, {
    name: 'shipped-plugin',
    packageName,
    source: { type: 'package' },
    enabledByDefault: false,
  });

  assert.equal(
    fs.readFileSync(path.join(pluginsDir, 'shipped-plugin', 'main.js'), 'utf8'),
    'prebuilt bundle'
  );
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(pluginsDir, 'shipped-plugin', 'package.json'),
        'utf8'
      )
    ).headlamp.enabledByDefault,
    false
  );
});

test('leaves pinned archives for the Headlamp shipped-plugin installer', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aks-desktop-archive-'));
  tempDirs.push(rootDir);
  const pluginsDir = path.join(rootDir, '.plugins');
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({
      headlamp: {
        plugins: [
          {
            name: 'archive-plugin',
            packageName: '@example/archive-plugin',
            archive: 'https://example.invalid/archive-plugin.tgz',
            sha256: 'a'.repeat(64),
          },
        ],
      },
    })
  );

  bundleConfiguredPlugins(rootDir, pluginsDir);

  assert.deepEqual(fs.readdirSync(pluginsDir), []);
});

test('rejects ambiguous or unverified shipped-plugin sources', () => {
  assert.throws(
    () =>
      validatePluginConfiguration([
        {
          name: 'ambiguous',
          packageName: '@example/ambiguous',
          source: 'plugins/ambiguous',
          archive: 'https://example.invalid/ambiguous.tgz',
          sha256: 'a'.repeat(64),
        },
      ]),
    /exactly one/
  );
  assert.throws(
    () =>
      validatePluginConfiguration([
        {
          name: 'unverified',
          packageName: '@example/unverified',
          archive: 'https://example.invalid/unverified.tgz',
        },
      ]),
    /SHA-256/
  );
  assert.throws(
    () =>
      validatePluginConfiguration([
        {
          name: 'insecure',
          packageName: '@example/insecure',
          archive: 'http://example.invalid/insecure.tgz',
          sha256: 'a'.repeat(64),
        },
      ]),
    /HTTPS/
  );
});
