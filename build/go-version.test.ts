// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { readHeadlampGoVersion, resolveGoVersion } from './go-version';

test('prefers the Headlamp toolchain directive', () => {
  const goMod = path.join(
    __dirname,
    '..',
    'packages',
    'headlamp-source',
    'source',
    'backend',
    'go.mod'
  );
  const expected = fs
    .readFileSync(goMod, 'utf8')
    .match(/^toolchain go([^\s]+)$/m)?.[1];
  assert.ok(expected);
  assert.equal(readHeadlampGoVersion(goMod), expected);
});

test('falls back to the go directive and rejects malformed modules', () => {
  assert.equal(resolveGoVersion('module example.invalid/test\n\ngo 1.25.4\n'), '1.25.4');
  assert.throws(() => resolveGoVersion('module example.invalid/test\n'), /No valid Go version/);
});