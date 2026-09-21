// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePluginManifest, retireBundledAksMcp } from './install-release-plugins';

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

test('replaces the pinned aks-mcp seed with a retirement migration', () => {
  const seed =
    'async function rqe(){const e=[];console.error("Error preconfiguring built-in MCP servers:",o)}}';
  const transformed = retireBundledAksMcp(`before;${seed};after`);

  assert.match(transformed, /Error retiring built-in AKS MCP server/);
  assert.match(transformed, /gb\(a\.name\)===GUe&&RA\(yb\(a\),yb\(JUe\(\)\)\)/);
  assert.doesNotMatch(transformed, /Error preconfiguring built-in MCP servers/);
  assert.throws(() => retireBundledAksMcp('missing'), /does not contain/);
  assert.throws(
    () => retireBundledAksMcp(`${seed}${seed}`),
    /multiple aks-mcp seed functions/
  );
});
