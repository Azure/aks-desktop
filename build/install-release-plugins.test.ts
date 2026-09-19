// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePluginManifest } from './install-release-plugins';

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