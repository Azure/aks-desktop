// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disableBundledAksMcpSeed,
  releasePluginManifest,
} from './install-release-plugins';

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

test('disables the pinned aks-mcp startup seed without migration behavior', () => {
  const seed =
    'async function rqe(){const e=[];console.error("Error preconfiguring built-in MCP servers:",o)}}';
  const transformed = disableBundledAksMcpSeed(`before;${seed};after`);

  assert.equal(transformed, 'before;async function rqe(){};after');
  assert.doesNotMatch(transformed, /getConfig|updateConfig|seededBuiltinMCPServers/);
  assert.doesNotMatch(transformed, /Error preconfiguring built-in MCP servers/);
  assert.throws(() => disableBundledAksMcpSeed('missing'), /does not contain/);
  assert.throws(
    () => disableBundledAksMcpSeed(`${seed}${seed}`),
    /multiple aks-mcp seed functions/
  );
});
