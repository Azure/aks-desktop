// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { releasePluginManifest, stageReleasePluginManifest } from './install-release-plugins';

test('selects only verified release plugin sources for app installation', () => {
  assert.deepEqual(
    releasePluginManifest({
      headlamp: {
        plugins: [
          { name: 'workspace', source: 'plugins/workspace' },
          { name: 'package', source: { type: 'package' } },
          {
            name: 'release',
            archive: 'https://example.invalid/release.tgz',
            sha256: 'a'.repeat(64),
          },
          { name: 'local', file: 'release.tgz', sha256: 'b'.repeat(64) },
        ],
      },
    }),
    {
      plugins: [
        {
          name: 'release',
          archive: 'https://example.invalid/release.tgz',
          sha256: 'a'.repeat(64),
        },
        { name: 'local', file: 'release.tgz', sha256: 'b'.repeat(64) },
      ],
    }
  );
});

test('requires plugin configuration for release installation', () => {
  assert.throws(() => releasePluginManifest({}), /headlamp\.plugins/);
});

test('stages local plugin files beside the temporary manifest', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-plugin-root-'));
  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-plugin-manifest-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(manifestDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(rootDir, 'release.tgz'), 'release bytes');

  const manifest = stageReleasePluginManifest(
    {
      headlamp: {
        plugins: [
          { name: 'remote', archive: 'https://example.invalid/release.tgz' },
          { name: 'local', file: 'release.tgz', sha256: 'b'.repeat(64) },
        ],
      },
    },
    rootDir,
    manifestDir
  );

  assert.deepEqual(manifest.plugins[0], {
    name: 'remote',
    archive: 'https://example.invalid/release.tgz',
  });
  assert.equal(manifest.plugins[1].file, '1-release.tgz');
  assert.equal(fs.readFileSync(path.join(manifestDir, '1-release.tgz'), 'utf8'), 'release bytes');
});

test('rejects local plugin files outside the project root', t => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-plugin-parent-'));
  const rootDir = path.join(parentDir, 'root');
  const manifestDir = path.join(parentDir, 'manifest');
  fs.mkdirSync(rootDir);
  fs.mkdirSync(manifestDir);
  fs.writeFileSync(path.join(parentDir, 'outside.tgz'), 'outside');
  t.after(() => fs.rmSync(parentDir, { recursive: true, force: true }));

  assert.throws(
    () =>
      stageReleasePluginManifest(
        {
          headlamp: { plugins: [{ name: 'outside', file: '../outside.tgz' }] },
        },
        rootDir,
        manifestDir
      ),
    /must stay within the project root/
  );
});
