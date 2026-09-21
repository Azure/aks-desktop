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
  npmInvocation,
  pluginDependencyIdentity,
  reusePluginDependencies,
  validatePluginConfiguration,
  writePluginDependencyMarker,
} = require('./bundle-plugins.ts');
const { spawn, spawnSync } = require('./npm-command.ts');

test('runs npm outside a lifecycle through both process launchers', async () => {
  const env = { ...process.env };
  delete env.npm_execpath;
  const invocation = npmInvocation(['--version'], process.platform, env);
  const result = spawnSync(invocation.command, invocation.args, { env, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { env, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`npm exited ${code}`)));
  });
});

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs
    .splice(0)
    .forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

function createPlugin(packageName: string) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'example-plugin-'));
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

test('rejects the consumer itself before running any plugin lifecycle', () => {
  const { pluginDir, pluginsDir } = createPlugin('consumer');
  for (const source of ['.', './', pluginDir]) {
    assert.throws(() => bundlePlugin(pluginDir, pluginsDir, {
      name: 'consumer', packageName: 'consumer', source,
    }), /Plugin source must stay within/);
  }
  assert.equal(fs.existsSync(pluginsDir), false);
});

test('runs the npm JavaScript CLI through Node when available', () => {
  assert.deepEqual(
    npmInvocation(['ci'], 'win32', { npm_execpath: 'C:\\npm\\npm-cli.js' }, 'node.exe'),
    {
      command: 'node.exe',
      args: ['C:\\npm\\npm-cli.js', 'ci'],
    }
  );
  assert.deepEqual(npmInvocation(['ci'], 'win32', {}, 'node.exe'), {
    command: 'npm.cmd',
    args: ['ci'],
  });
});

test('reuses only a verified plugin dependency tree during packaging', () => {
  const { pluginDir } = createPlugin('example-plugin');
  assert.equal(reusePluginDependencies(pluginDir, 'example', {}), false);
  assert.equal(
    reusePluginDependencies(pluginDir, 'other', {
      HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: 'example',
    }),
    false
  );
  assert.throws(
    () => writePluginDependencyMarker(pluginDir),
    /incomplete plugin dependencies/
  );
  assert.equal(
    reusePluginDependencies(pluginDir, 'example', {
      HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: 'example',
    }),
    false
  );
  fs.mkdirSync(path.join(pluginDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'package-lock.json'), '{"lockfileVersion":3}');
  fs.writeFileSync(
    path.join(pluginDir, 'node_modules', '.package-lock.json'),
    '{"lockfileVersion":3}'
  );
  assert.match(pluginDependencyIdentity(pluginDir), /^[0-9a-f]{64}$/);
  writePluginDependencyMarker(pluginDir);
  assert.equal(
    reusePluginDependencies(pluginDir, 'example', {
      HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: 'example',
    }),
    true
  );
  fs.writeFileSync(path.join(pluginDir, 'package-lock.json'), '{"lockfileVersion":2}');
  assert.equal(
    reusePluginDependencies(pluginDir, 'example', {
      HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: 'example',
    }),
    false
  );
  fs.writeFileSync(path.join(pluginDir, 'package-lock.json'), '{"lockfileVersion":3}');
  writePluginDependencyMarker(pluginDir);
  fs.writeFileSync(path.join(pluginDir, 'node_modules', '.package-lock.json'), '{}');
  assert.equal(
    reusePluginDependencies(pluginDir, 'example', {
      HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: 'example',
    }),
    false
  );
});

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
  const packageName = 'example-plugin';
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'example-package-'));
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

test('preserves installed release plugins while bundling workspaces', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'example-archive-'));
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
  const releaseDir = path.join(pluginsDir, 'archive-plugin');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'main.js'), 'release bundle');
  fs.mkdirSync(path.join(pluginsDir, 'retired-plugin'));

  bundleConfiguredPlugins(rootDir, pluginsDir);

  assert.deepEqual(fs.readdirSync(pluginsDir), ['archive-plugin']);
  assert.equal(fs.readFileSync(path.join(releaseDir, 'main.js'), 'utf8'), 'release bundle');
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
