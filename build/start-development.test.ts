// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { createServer } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { developmentPreparationIdentity, prepareDevelopment } from './prepare-development';
import { developmentEnvironment, findAvailablePort, startDevelopment } from './start-development';

test('skips development preparation when dependencies and assets are current', () => {
  const scripts: string[] = [];
  prepareDevelopment('/workspace', {
    dependenciesCurrent: () => true,
    assemblyCurrent: () => true,
    runScript: script => scripts.push(script),
  });
  assert.deepEqual(scripts, []);
});

test('refreshes only stale development preparation', () => {
  const scripts: string[] = [];
  let markerWrites = 0;
  prepareDevelopment('/workspace', {
    dependenciesCurrent: () => false,
    assemblyCurrent: () => false,
    runScript: script => scripts.push(script),
    writeMarker: () => markerWrites++,
  });
  assert.deepEqual(scripts, ['headlamp:install', 'headlamp:assemble']);
  assert.equal(markerWrites, 1);
});

test('invalidates development preparation when a configured plugin changes', t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'development preparation-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(rootDir, 'plugins', 'example', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ headlamp: { plugins: [{ source: 'plugins/example' }] } })
  );
  const source = path.join(rootDir, 'plugins', 'example', 'src', 'index.ts');
  fs.writeFileSync(source, 'export const value = 1;\n');
  const firstIdentity = developmentPreparationIdentity(rootDir);

  fs.writeFileSync(source, 'export const value = 2;\n');
  assert.notEqual(developmentPreparationIdentity(rootDir), firstIdentity);
});

for (const packageName of ['example-artifact', '@example/artifact']) {
  test(`refreshes development assets when installed ${packageName} inputs change`, t => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'package preparation-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({
      headlamp: { plugins: [{ packageName, source: { type: 'package' } }] },
    }));
    const installed = path.join(rootDir, 'node_modules', packageName);
    fs.mkdirSync(path.join(installed, 'scripts'), { recursive: true });
    const metadata = path.join(installed, 'package.json');
    const script = path.join(installed, 'scripts', 'stage.mjs');
    fs.writeFileSync(metadata, JSON.stringify({ name: packageName, artifactSha256: 'a'.repeat(64) }));
    fs.writeFileSync(script, 'console.log("stage");\n');
    let marker = developmentPreparationIdentity(rootDir);
    const scripts: string[] = [];
    const options = {
      dependenciesCurrent: () => true,
      assemblyCurrent: (root: string) => developmentPreparationIdentity(root) === marker,
      runScript: (command: string) => scripts.push(command),
      writeMarker: (root: string) => { marker = developmentPreparationIdentity(root); },
    };

    prepareDevelopment(rootDir, options);
    for (const relative of ['dist/main.js', 'node_modules/dependency/index.js']) {
      const output = path.join(installed, relative);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, 'generated output');
    }
    const sibling = path.join(rootDir, 'node_modules', 'unrelated-package');
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'package.json'), '{"version":"2.0.0"}');
    prepareDevelopment(rootDir, options);
    assert.deepEqual(scripts, []);

    fs.writeFileSync(metadata, JSON.stringify({ name: packageName, artifactSha256: 'b'.repeat(64) }));
    prepareDevelopment(rootDir, options);
    assert.deepEqual(scripts, ['headlamp:assemble']);
    fs.writeFileSync(script, 'console.log("updated stage");\n');
    prepareDevelopment(rootDir, options);
    assert.deepEqual(scripts, ['headlamp:assemble', 'headlamp:assemble']);
    prepareDevelopment(rootDir, options);
    assert.equal(scripts.length, 2);
  });
}

test('starts development through the npm lifecycle CLI and preserves its environment', async t => {
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = 'C:\\Program Files\\nodejs\\npm-cli.js';
  t.after(() => {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  });
  let launched = false;
  await startDevelopment((command, args, options) => {
    launched = true;
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [process.env.npm_execpath, 'run', 'dev:services']);
    assert.match(options.env.ELECTRON_START_URL, /^http:\/\/localhost:\d+$/);
    assert.equal(options.env.npm_execpath, process.env.npm_execpath);
    return new EventEmitter();
  });
  assert.equal(launched, true);
});

test('selects the next port when the preferred frontend port is occupied', async () => {
  const occupiedPort = await findAvailablePort();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: occupiedPort, exclusive: true }, resolve);
  });

  try {
    assert.equal(await findAvailablePort(occupiedPort), occupiedPort + 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});

test('shares the selected frontend port with Vite and Electron', () => {
  assert.deepEqual(developmentEnvironment(3001, { EXISTING: 'value' }), {
    EXISTING: 'value',
    ELECTRON_START_URL: 'http://localhost:3001',
    HEADLAMP_FRONTEND_PORT: '3001',
  });
});
