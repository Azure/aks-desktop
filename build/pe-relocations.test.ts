// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { verifyAslr } from './pe-relocations';

const stubPath = path.join(__dirname, 'nsis-aslr/stubs/zlib-x86-unicode');
const stub = fs.readFileSync(stubPath);
// Offsets are deliberately coupled to the pinned PE, not a synthetic PE builder.
const pe = 128;
const optional = 152;
const sections = 376;
const reloc = 86528;
const directory = optional + 136;

test('pinned active stub has usable HIGHLOW relocations', () => {
  assert.deepEqual(verifyAslr(stub, 'stub'), {
    fixupCount: 1074,
    relocRva: 561152,
  });
});

// Each mutation removes one safety invariant. Specific errors ensure another
// malformed field cannot accidentally satisfy the intended negative case.
const mutations: [string, (b: Buffer) => void, RegExp][] = [
  ['DOS signature', (b) => b.writeUInt16LE(0, 0), /DOS signature/],
  ['PE offset', (b) => b.writeUInt32LE(0xfffffffe, 60), /truncated PE header/],
  ['PE signature', (b) => b.writeUInt32LE(0, pe), /PE signature/],
  ['PE32+', (b) => b.writeUInt16LE(0x20b, optional), /PE32/],
  ['machine', (b) => b.writeUInt16LE(0xaa64, pe + 4), /x86/],
  ['optional header', (b) => b.writeUInt16LE(100, pe + 20), /optional header/],
  ['section table', (b) => b.writeUInt16LE(65535, pe + 6), /section table/],
  [
    'stripped',
    (b) => b.writeUInt16LE(b.readUInt16LE(pe + 22) | 1, pe + 22),
    /RELOCS_STRIPPED/,
  ],
  ['dynamic base', (b) => b.writeUInt16LE(0, optional + 70), /DYNAMICBASE/],
  [
    'directory count',
    (b) => b.writeUInt32LE(5, optional + 92),
    /relocation directory/,
  ],
  [
    'empty directory',
    (b) => b.writeUInt32LE(0, directory + 4),
    /relocation directory/,
  ],
  [
    'directory in .ndata',
    (b) => b.writeUInt32LE(565248, directory),
    /file-backed .reloc/,
  ],
  [
    'directory in .text',
    (b) => b.writeUInt32LE(4096, directory),
    /file-backed .reloc/,
  ],
  [
    'directory crosses section',
    (b) => b.writeUInt32LE(2564, directory + 4),
    /file-backed .reloc/,
  ],
  [
    'directory exceeds virtual extent',
    (b) => b.writeUInt32LE(8, sections + 5 * 40 + 8),
    /file-backed .reloc/,
  ],
  [
    'partial block header',
    (b) => b.writeUInt32LE(4, directory + 4),
    /block header/,
  ],
  ['short block', (b) => b.writeUInt32LE(4, reloc + 4), /block size/],
  ['unaligned block size', (b) => b.writeUInt32LE(9, reloc + 4), /block size/],
  [
    'block exceeds directory',
    (b) => b.writeUInt32LE(2252, reloc + 4),
    /block size/,
  ],
  ['unaligned page', (b) => b.writeUInt32LE(4097, reloc), /page alignment/],
  [
    'unsupported type',
    (b) => b.writeUInt16LE(0x5000, reloc + 8),
    /relocation type/,
  ],
  [
    'unmapped target',
    (b) => {
      b.writeUInt16LE(0x3000, reloc + 8);
      b.writeUInt32LE(0x200000, reloc);
    },
    /file-backed target/,
  ],
  [
    'four-byte target crosses raw section',
    (b) => {
      b.writeUInt32LE(0x9000, reloc);
      b.writeUInt16LE(0x3ffe, reloc + 8);
    },
    /file-backed target/,
  ],
  [
    'out-of-image VA',
    (b) => {
      const rva = b.readUInt32LE(reloc) + (b.readUInt16LE(reloc + 8) & 0xfff);
      b.writeUInt32LE(0, 1024 + rva - 4096);
    },
    /in-image VA/,
  ],
  [
    'only padding',
    (b) => {
      b.writeUInt32LE(12, directory + 4);
      b.writeUInt32LE(12, reloc + 4);
      b.writeUInt32LE(0, reloc + 8);
    },
    /no HIGHLOW/,
  ],
];
for (const [name, mutate, error] of mutations) {
  test(`rejects ${name}`, () => {
    const bytes = Buffer.from(stub);
    mutate(bytes);
    assert.throws(() => verifyAslr(bytes, name), error);
  });
}
for (const length of [0, 63, 151, 375, 695, reloc + 10]) {
  test(`rejects truncation at ${length} with a labeled error`, () => {
    assert.throws(
      () => verifyAslr(stub.subarray(0, length), 'truncated'),
      /^Error: truncated:/
    );
  });
}
test('real stock header fails on stripped relocations before needing code bytes', () => {
  const headers = fs.readFileSync(
    path.join(
      __dirname,
      'nsis-aslr/test-fixtures/stock-zlib-x86-unicode.headers.bin'
    )
  );
  assert.throws(() => verifyAslr(headers, 'stock'), /stock:.*RELOCS_STRIPPED/);
});
test('CLI prints a summary and exits nonzero for invalid input', () => {
  const cli = path.join(__dirname, 'pe-relocations.ts');
  const good = spawnSync(process.execPath, ['--import', 'tsx', cli, stubPath], {
    encoding: 'utf8',
  });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /1074 HIGHLOW/);
  const bad = spawnSync(
    process.execPath,
    ['--import', 'tsx', cli, __filename],
    { encoding: 'utf8' }
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /DOS signature/);
});
