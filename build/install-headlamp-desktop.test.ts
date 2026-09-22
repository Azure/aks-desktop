// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { dependencyTargetMatches } from './dependency-target';
import {
  HEADLAMP_DESKTOP_INSTALL_STEPS,
  installHeadlampDesktopDependencies,
} from './install-headlamp-desktop';

test('installs only the Headlamp dependencies required by desktop packaging', () => {
  const commands: string[] = [];
  installHeadlampDesktopDependencies('/workspace/headlamp', (args, cwd) => {
    commands.push(`${path.relative('/workspace/headlamp', cwd) || '.'}:${args.join(' ')}`);
  });

  assert.deepEqual(commands, [
    'frontend:ci --prefer-offline --no-audit --no-fund --omit=dev',
    '.:run backend:build',
    'app:ci --prefer-offline --no-audit --no-fund',
  ]);
  assert.equal(commands.length, HEADLAMP_DESKTOP_INSTALL_STEPS.length);
});

test('can defer backend compilation to the architecture-aware package hook', () => {
  const commands: string[] = [];
  installHeadlampDesktopDependencies(
    '/workspace/headlamp',
    (args, cwd) => {
      commands.push(`${path.relative('/workspace/headlamp', cwd) || '.'}:${args.join(' ')}`);
    },
    { skipBackendBuild: true }
  );

  assert.deepEqual(commands, [
    'frontend:ci --prefer-offline --no-audit --no-fund --omit=dev',
    'app:ci --prefer-offline --no-audit --no-fund',
  ]);
});

test('installs only app dependencies when reusing prepared frontend assets', () => {
  const commands: string[] = [];
  installHeadlampDesktopDependencies(
    '/workspace/headlamp',
    (args, cwd) => {
      commands.push(`${path.relative('/workspace/headlamp', cwd) || '.'}:${args.join(' ')}`);
    },
    { skipBackendBuild: true, skipFrontendInstall: true }
  );

  assert.deepEqual(commands, ['app:ci --prefer-offline --no-audit --no-fund']);
});

test('stops the Headlamp desktop install at the first failed step', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'failed desktop install-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const commands: string[] = [];
  t.mock.method(console, 'log', () => undefined);
  assert.throws(
    () =>
      installHeadlampDesktopDependencies(
        '/workspace/headlamp',
        (args, cwd) => {
          commands.push(`${path.basename(cwd)}:${args.join(' ')}`);
          if (cwd.endsWith('frontend')) {
            throw new Error('clean install failed');
          }
        },
        { rootDir }
      ),
    /clean install failed/
  );
  assert.deepEqual(commands, ['frontend:ci --prefer-offline --no-audit --no-fund --omit=dev']);
  assert.equal(
    dependencyTargetMatches(rootDir, { platform: process.platform, arch: process.arch }),
    false
  );
});

test('records the target only after a successful desktop install', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop install target-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  installHeadlampDesktopDependencies('/workspace/headlamp', () => undefined, { rootDir });

  assert.equal(
    dependencyTargetMatches(rootDir, { platform: process.platform, arch: process.arch }),
    true
  );
});

test('invalidates installed dependencies when a Headlamp lockfile changes', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop lock target-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const sourceDir = path.join(
    rootDir,
    'node_modules',
    '@headlamp-k8s',
    'headlamp-source',
    'source'
  );
  for (const directory of ['frontend', 'app']) {
    fs.mkdirSync(path.join(sourceDir, directory), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, directory, 'package-lock.json'), '{"version":1}\n');
  }
  const target = { platform: process.platform, arch: process.arch };
  installHeadlampDesktopDependencies(sourceDir, () => undefined, { rootDir });
  assert.equal(dependencyTargetMatches(rootDir, target), true);

  fs.writeFileSync(path.join(sourceDir, 'app', 'package-lock.json'), '{"version":2}\n');
  assert.equal(dependencyTargetMatches(rootDir, target), false);
});
