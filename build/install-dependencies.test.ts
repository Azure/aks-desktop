// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { runTimedStep } from './build-timing';
import { DEPENDENCY_INSTALL_STEPS, installDependencies } from './install-dependencies';

const { writePluginDependencyMarker } = require(
  '../packages/headlamp-source/src/lib/bundle-plugins.ts'
);
const pluginSteps = DEPENDENCY_INSTALL_STEPS.filter(step => 'pluginDirectory' in step);

test('reports UTC start and elapsed failure timing without replacing the error', () => {
  const messages: string[] = [];
  const times = [Date.parse('2026-09-19T10:00:00.000Z'), Date.parse('2026-09-19T10:00:01.250Z')];
  assert.throws(
    () =>
      runTimedStep(
        'failing phase',
        () => {
          throw new Error('original failure');
        },
        () => times.shift()!,
        message => messages.push(message)
      ),
    /original failure/
  );
  assert.deepEqual(messages, [
    '[build-timing] failing phase started at 2026-09-19T10:00:00.000Z',
    '[build-timing] failing phase failed after 1.250s',
  ]);
});

test('installs each dependency group once with timestamped timings', t => {
  const scripts: string[] = [];
  const markedDirectories: string[] = [];
  const messages: string[] = [];
  t.mock.method(console, 'log', (message: string) => messages.push(message));

  installDependencies(
    '/workspace',
    (script, rootDir) => {
      assert.equal(rootDir, '/workspace');
      scripts.push(script);
    },
    pluginDir => markedDirectories.push(pluginDir)
  );

  assert.deepEqual(scripts, DEPENDENCY_INSTALL_STEPS.map(step => step.script));
  assert.equal(new Set(scripts).size, scripts.length);
  assert.deepEqual(markedDirectories, [
    path.join('/workspace', 'plugins/aks-desktop'),
    path.join('/workspace', 'plugins/aks-desktop-theme'),
    path.join('/workspace', 'plugins/plugin-catalog'),
  ]);
  assert.match(messages.join('\n'), /install Headlamp dependencies started at \d{4}-\d{2}-\d{2}T/);
  assert.match(messages.join('\n'), /install all dependencies completed in \d+\.\d{3}s/);
});

test('stops dependency installation at the first failed group', t => {
  const scripts: string[] = [];
  t.mock.method(console, 'log', () => undefined);
  assert.throws(
    () =>
      installDependencies('/workspace', script => {
        scripts.push(script);
        if (script === 'plugin:install') {
          throw new Error('install failed');
        }
      }),
    /install failed/
  );
  assert.deepEqual(scripts, ['headlamp:install', 'plugin:install']);
});

test('can defer only Headlamp until after the root clean install and cache restore', t => {
  const scripts: string[] = [];
  const marked: string[] = [];
  t.mock.method(console, 'log', () => undefined);
  installDependencies(
    '/workspace',
    script => scripts.push(script),
    directory => marked.push(directory),
    { HEADLAMP_DEFER_DESKTOP_INSTALL: 'true' }
  );
  assert.deepEqual(scripts, pluginSteps.map(step => step.script));
  assert.equal(marked.length, pluginSteps.length);
});

for (const state of ['valid', 'disabled', 'missing', 'partial', 'manifest', 'lock', 'installed-lock']) {
  test(`plugin dependency reuse handles ${state} cache state`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cached-plugin-deps-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    t.mock.method(console, 'log', () => undefined);
    for (const step of pluginSteps) {
      const directory = path.join(root, step.pluginDirectory);
      fs.mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
      for (const file of ['package.json', 'package-lock.json', 'node_modules/.package-lock.json']) {
        fs.writeFileSync(path.join(directory, file), '{}');
      }
      writePluginDependencyMarker(directory);
    }

    const plugin = path.join(root, 'plugins', 'aks-desktop');
    const changedFiles: Record<string, string> = {
      missing: 'node_modules/.headlamp-dependency-identity',
      partial: 'node_modules/.package-lock.json',
      manifest: 'package.json',
      lock: 'package-lock.json',
      'installed-lock': 'node_modules/.package-lock.json',
    };
    const changedFile = changedFiles[state];
    if (changedFile) {
      if (state === 'missing' || state === 'partial') {
        fs.rmSync(path.join(plugin, changedFile));
      } else {
        fs.writeFileSync(path.join(plugin, changedFile), '{"changed":true}');
      }
    }

    const scripts: string[] = [];
    const marked: string[] = [];
    installDependencies(
      root,
      script => scripts.push(script),
      directory => marked.push(directory),
      state === 'disabled'
        ? {}
        : {
            HEADLAMP_REUSE_PLUGIN_DEPENDENCIES: pluginSteps
              .map(step => path.basename(step.pluginDirectory))
              .join(','),
          }
    );
    const expectedScripts = state === 'valid'
      ? ['headlamp:install']
      : state === 'disabled'
        ? DEPENDENCY_INSTALL_STEPS.map(step => step.script)
        : ['headlamp:install', 'plugin:install'];
    assert.deepEqual(scripts, expectedScripts);
    assert.equal(marked.length, scripts.length - 1);
    if (state !== 'valid') assert.equal(marked[0], plugin);
  });
}