// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';

import { developmentEnvironment, findAvailablePort, startDevelopment } from './start-development';

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
      server.close(error => error ? reject(error) : resolve());
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