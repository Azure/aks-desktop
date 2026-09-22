// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';
import { runTimedStep } from './build-timing';
import { DEPENDENCY_INSTALL_STEPS, installDependencies } from './install-dependencies';

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