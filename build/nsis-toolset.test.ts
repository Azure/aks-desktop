// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { prepareNsisToolset } from './nsis-toolset';

for (const corruption of [
  undefined,
  'elevate.exe',
  'Bin/makensis.exe',
  'extra',
  'missing',
  'replacement',
  'linked-stubs',
]) {
  test(`assembled toolset integrity: ${corruption ?? 'success'}`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsis-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const stock = path.join(root, 'stock');
    const output = path.join(root, 'output');
    const recipe = path.join(root, 'recipe');
    const files = {
      'elevate.exe': 'helper',
      'Bin/makensis.exe': 'compiler',
      'Stubs/uninst': 'icon',
      'Stubs/zlib-x86-ansi': 'bootstrap',
    };
    const hash = (value: string) =>
      createHash('sha256').update(value).digest('hex');
    for (const [file, value] of Object.entries({
      ...files,
      'Stubs/zlib-x86-unicode': 'old',
    })) {
      await fs.mkdir(path.dirname(path.join(stock, file)), { recursive: true });
      await fs.writeFile(path.join(stock, file), value);
    }
    await fs.mkdir(path.join(recipe, 'stubs'), { recursive: true });
    await fs.mkdir(output);
    await fs.writeFile(
      path.join(recipe, 'stock-bundle.sha256'),
      Object.entries(files)
        .map(([file, value]) => `${hash(value)}  ${file}\n`)
        .join('')
    );
    await fs.writeFile(
      path.join(recipe, 'stubs.sha256'),
      `${hash('new')}  stubs/zlib-x86-unicode\n`
    );
    await fs.writeFile(
      path.join(recipe, 'stubs/zlib-x86-unicode'),
      corruption === 'replacement' ? 'corrupt' : 'new'
    );
    if (corruption === 'linked-stubs') {
      await fs.rename(path.join(stock, 'Stubs'), path.join(root, 'outside'));
      await fs.symlink(
        path.join(root, 'outside'),
        path.join(stock, 'Stubs'),
        'junction'
      );
    } else if (corruption === 'missing')
      await fs.unlink(path.join(stock, 'Stubs/uninst'));
    else if (corruption === 'extra')
      await fs.writeFile(path.join(stock, 'extra'), 'extra');
    else if (corruption && corruption !== 'replacement')
      await fs.writeFile(path.join(stock, corruption), 'tampered');
    const prepare = () =>
      prepareNsisToolset({
        appDir: root,
        output,
        recipeDir: recipe,
        download: async () => stock,
      });
    if (corruption) {
      await assert.rejects(prepare, /NSIS.*(mismatch|inventory)/);
    } else {
      await prepare();
      assert.equal(
        await fs.readFile(path.join(output, 'Stubs/zlib-x86-unicode'), 'utf8'),
        'new'
      );
      await fs.writeFile(path.join(output, 'elevate.exe'), 'changed copy');
      assert.equal(
        await fs.readFile(path.join(stock, 'elevate.exe'), 'utf8'),
        'helper'
      );
    }
    assert.equal(
      await fs.readFile(path.join(stock, 'Stubs/zlib-x86-unicode'), 'utf8'),
      'old'
    );
    await assert.rejects(prepare, /empty/);
  });
}
