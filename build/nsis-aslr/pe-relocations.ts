// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';

/** Checks the PE32/x86 relocation invariants required by our NSIS launcher. */
export function verifyAslr(
  buffer: Buffer,
  label: string
): { fixupCount: number; relocRva: number } {
  function fail(message: string): never {
    throw new Error(`${label}: ${message}`);
  }
  const range = (offset: number, size: number, name: string) => {
    if (offset < 0 || size < 0 || offset + size > buffer.length)
      fail(`truncated ${name}`);
  };
  range(0, 64, 'DOS header');
  if (buffer.readUInt16LE(0) !== 0x5a4d) fail('invalid DOS signature');
  const pe = buffer.readUInt32LE(60);
  range(pe, 24, 'PE header');
  if (buffer.readUInt32LE(pe) !== 0x4550) fail('invalid PE signature');
  if (buffer.readUInt16LE(pe + 4) !== 0x14c) fail('expected x86 machine');
  // Check flags early so the real stock header fixture needs no section bodies.
  if (buffer.readUInt16LE(pe + 22) & 1) fail('RELOCS_STRIPPED is set');
  const optional = pe + 24;
  const optionalSize = buffer.readUInt16LE(pe + 20);
  if (optionalSize < 144) fail('optional header lacks relocation directory');
  range(optional, optionalSize, 'optional header');
  if (buffer.readUInt16LE(optional) !== 0x10b)
    fail('expected PE32 optional header');
  if (!(buffer.readUInt16LE(optional + 70) & 0x40))
    fail('DYNAMICBASE is not set');
  if (buffer.readUInt32LE(optional + 92) < 6)
    fail('missing relocation directory');
  const imageBase = buffer.readUInt32LE(optional + 28);
  const imageSize = buffer.readUInt32LE(optional + 56);
  if (!imageSize || imageBase + imageSize > 0x100000000)
    fail('invalid image extent');
  const relocRva = buffer.readUInt32LE(optional + 136);
  const relocSize = buffer.readUInt32LE(optional + 140);
  if (!relocRva || !relocSize) fail('empty relocation directory');
  const count = buffer.readUInt16LE(pe + 6);
  const table = optional + optionalSize;
  range(table, count * 40, 'section table');
  const sections = Array.from({ length: count }, (_, index) => {
    const offset = table + index * 40;
    return {
      name: buffer.toString('ascii', offset, offset + 8).replace(/\0.*$/, ''),
      virtualSize: buffer.readUInt32LE(offset + 8),
      rva: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      raw: buffer.readUInt32LE(offset + 20),
    };
  });
  const fileOffset = (
    rva: number,
    size: number,
    name?: string
  ): number | undefined => {
    if (rva + size > imageSize) return undefined;
    const matches = sections.filter(
      (section) =>
        rva >= section.rva &&
        rva + size <= section.rva + section.virtualSize &&
        rva + size <= section.rva + section.rawSize
    );
    if (matches.length !== 1 || (name && matches[0].name !== name))
      return undefined;
    const offset = matches[0].raw + rva - matches[0].rva;
    return offset + size <= buffer.length ? offset : undefined;
  };
  const start = fileOffset(relocRva, relocSize, '.reloc');
  if (start === undefined)
    fail('relocation directory must be wholly inside file-backed .reloc');
  const end = start + relocSize;
  let fixupCount = 0;
  // The loader applies every fixup, so even cross-block partial overlap is invalid.
  const relocatedBytes = new Set<number>();
  for (let block = start; block < end; ) {
    if (end - block < 8) fail('truncated relocation block header');
    const page = buffer.readUInt32LE(block);
    const size = buffer.readUInt32LE(block + 4);
    if (page % 4096) fail('invalid relocation page alignment');
    if (size < 8 || size % 4 || size > end - block)
      fail('invalid relocation block size');
    for (let entry = block + 8; entry < block + size; entry += 2) {
      const value = buffer.readUInt16LE(entry);
      const type = value >>> 12;
      if (type === 0) continue; // ABSOLUTE entries are alignment padding.
      if (type !== 3) fail(`unsupported relocation type ${type}`);
      const targetRva = page + (value & 0xfff);
      const target = fileOffset(targetRva, 4);
      if (target === undefined)
        fail('HIGHLOW requires a four-byte file-backed target');
      for (let byte = targetRva; byte < targetRva + 4; byte++) {
        if (relocatedBytes.has(byte)) fail('overlapping HIGHLOW targets');
        relocatedBytes.add(byte);
      }
      const va = buffer.readUInt32LE(target);
      if (va < imageBase || va >= imageBase + imageSize)
        fail('HIGHLOW requires an in-image VA');
      fixupCount++;
    }
    block += size;
  }
  if (!fixupCount) fail('no HIGHLOW relocations');
  return { fixupCount, relocRva };
}

if (require.main === module) {
  try {
    if (process.argv.length < 3)
      throw new Error('Usage: pe-relocations.ts <file>...');
    for (const file of process.argv.slice(2)) {
      const result = verifyAslr(fs.readFileSync(file), file);
      console.log(
        `${file}: ${
          result.fixupCount
        } HIGHLOW fixups, .reloc RVA 0x${result.relocRva.toString(16)}`
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
