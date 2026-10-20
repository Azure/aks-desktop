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
