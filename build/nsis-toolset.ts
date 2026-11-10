// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const RECIPE = path.join(__dirname, 'nsis-aslr');
const CHECKSUM =
  '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa';

/** Copies the cached stock toolset without mutating it, overlays one stub, then authenticates every file. */
export async function prepareNsisToolset(options: {
  appDir: string;
  output: string;
  recipeDir?: string;
  download?: () => Promise<string>;
}): Promise<void> {
  const { appDir, output, recipeDir = RECIPE } = options;
  if (!path.isAbsolute(output) || (await fs.readdir(output)).length) {
    throw new Error(
      'NSIS output must be a parent-created empty absolute directory'
    );
  }
  const download =
    options.download ??
    (() => {
      const appRequire = createRequire(path.join(appDir, 'package.json'));
      return appRequire('app-builder-lib/out/binDownload').getBinFromUrl(
        'nsis-3.0.4.1',
        'nsis-3.0.4.1.7z',
        CHECKSUM
      );
    });
  const stock = await download();
  await fs.cp(stock, output, {
    recursive: true,
    filter: async (source) => {
      const entry = await fs.lstat(source);
      // A linked Stubs directory/file could redirect the overlay write outside
      // our copy before the final hash scan has a chance to reject it.
      if (!entry.isDirectory() && !entry.isFile())
        throw new Error(`NSIS inventory has non-regular entry: ${source}`);
      return true;
    },
  });
  await fs.copyFile(
    path.join(recipeDir, 'stubs/zlib-x86-unicode'),
    path.join(output, 'Stubs/zlib-x86-unicode')
  );

  const expected = new Map<string, string>();
  for (const [manifest, replacement] of [
    ['stock-bundle.sha256', false],
    ['stubs.sha256', true],
  ] as const) {
    for (const line of (
      await fs.readFile(path.join(recipeDir, manifest), 'utf8')
    )
      .trim()
      .split(/\r?\n/)) {
      const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
      if (!match) throw new Error(`Invalid NSIS manifest: ${manifest}`);
      const name = replacement
        ? match[2].replace(/^stubs\//, 'Stubs/')
        : match[2];
      if (expected.has(name))
        throw new Error(`Duplicate NSIS manifest file: ${name}`);
      expected.set(name, match[1]);
    }
  }
  for (const required of [
    'Bin/makensis.exe',
    'elevate.exe',
    'Stubs/uninst',
    'Stubs/zlib-x86-unicode',
  ]) {
    if (!expected.has(required))
      throw new Error(`NSIS inventory missing ${required}`);
  }
  const seen = new Set<string>();
  async function verify(directory: string, prefix = ''): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await verify(file, `${name}/`);
      else {
        if (!entry.isFile() || !expected.has(name))
          throw new Error(`NSIS inventory has unexpected file: ${name}`);
        const digest = createHash('sha256')
          .update(await fs.readFile(file))
          .digest('hex');
        if (digest !== expected.get(name))
          throw new Error(`NSIS hash mismatch: ${name}`);
        seen.add(name);
      }
    }
  }
  await verify(output);
  for (const name of expected.keys()) {
    if (!seen.has(name))
      throw new Error(`NSIS inventory missing file: ${name}`);
  }
}

if (require.main === module) {
  const output = process.argv
    .find((arg) => arg.startsWith('--output='))
    ?.slice('--output='.length);
  const {
    resolveInstalledHeadlampPaths,
  } = require('../packages/headlamp-source/src/lib/paths.ts');
  if (!output)
    throw new Error(
      'Usage: nsis-toolset.ts --output=<parent-created-empty-directory>'
    );
  prepareNsisToolset({
    ...resolveInstalledHeadlampPaths(path.dirname(__dirname)),
    output,
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
