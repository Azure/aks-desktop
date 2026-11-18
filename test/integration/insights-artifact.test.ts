// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const { bundlePlugin, copyPlugin } = require(
  path.join(ROOT_DIR, 'packages/headlamp-source/src/lib/bundle-plugins.ts')
);
const { npmInvocation, spawnSync } = require(
  path.join(ROOT_DIR, 'packages/headlamp-source/src/lib/npm-command.ts')
);
const project = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const insights = project.headlamp.plugins.find(
  (plugin: { name: string }) => plugin.name === 'insights-plugin'
);
const wrapperDir = path.join(ROOT_DIR, 'plugins', 'insights-plugin');

function snapshot(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  function visit(current: string, relative = ''): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      const key = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(filename, key);
      else files[key] = fs.readFileSync(filename).toString('base64');
    }
  }
  visit(directory);
  return files;
}

test('bundles prebuilt Insights without a workspace install and preserves every shipped byte', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, 'node_modules', 'insights-plugin');
  const legacy = path.join(root, 'legacy-wrapper');
  const artifacts = {
    'main.js': Buffer.from('/* prebuilt Insights */'),
    'main.wasm.gz': gzipSync(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])),
    'package.json': Buffer.from(JSON.stringify({
      name: 'insights-plugin', headlamp: { enabledByDefault: false },
    })),
    'locales/en/translation.json': Buffer.from('{"name":"Insights"}'),
    'locales/de/translation.json': Buffer.from('{"name":"Einblicke"}'),
  };
  for (const directory of [installed, legacy]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.copyFileSync(path.join(wrapperDir, 'package.json'), path.join(directory, 'package.json'));
    for (const [filename, bytes] of Object.entries(artifacts)) {
      const output = path.join(directory, 'dist', filename);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, bytes);
    }
  }

  const previous = copyPlugin(legacy, path.join(root, 'previous'), insights, false);
  const current = bundlePlugin(root, path.join(root, 'current'), insights);
  assert.deepEqual(snapshot(current), snapshot(previous));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8')).headlamp.enabledByDefault,
    true
  );
  assert.equal(fs.existsSync(path.join(root, 'plugins', 'insights-plugin')), false);
});

test('the installed Insights package retains the wrapper and staging scripts without the SDK', () => {
  const installed = path.join(ROOT_DIR, 'node_modules', 'insights-plugin');
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
  for (const filename of [
    'package.json',
    'scripts/artifacts.mjs',
    'scripts/download-artifacts.mjs',
    'scripts/validate-artifacts.mjs',
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(installed, filename)),
      fs.readFileSync(path.join(wrapperDir, filename))
    );
  }
  assert.equal(
    fs.existsSync(path.join(ROOT_DIR, 'node_modules', '@kinvolk', 'headlamp-plugin')),
    false
  );
  assert.equal(fs.existsSync(path.join(installed, 'node_modules')), false);
});

test('plugin setup stops before bundling when Insights artifact staging fails', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-stage-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    private: true, scripts: { 'plugin:setup': project.scripts['plugin:setup'] },
  }));
  for (const [name, scripts] of Object.entries({
    'insights-plugin': {
      build: 'node -e "console.error(\'artifact-checksum-failure\'); process.exit(17)"',
    },
    '@headlamp-k8s/headlamp-source': {
      'bundle:plugins': 'node -e "require(\'node:fs\').writeFileSync(process.env.BUNDLE_MARKER, \'unexpected\')"',
    },
  })) {
    const directory = path.join(root, 'node_modules', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, scripts }));
  }
  const marker = path.join(root, 'bundled');
  const env = { ...process.env, BUNDLE_MARKER: marker };
  const invocation = npmInvocation(['run', 'plugin:setup'], process.platform, env, process.execPath);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root, env, encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact-checksum-failure/);
  assert.equal(fs.existsSync(marker), false);
});
