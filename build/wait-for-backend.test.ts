// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import test from 'node:test';

import { developmentBackendPort, waitForPort } from './wait-for-backend';

test('uses the frontend proxy backend port', () => {
  assert.equal(developmentBackendPort({}), 4466);
  assert.equal(developmentBackendPort({ HEADLAMP_PORT: '' }), 4466);
  assert.equal(developmentBackendPort({ HEADLAMP_PORT: '5000' }), 5000);
  for (const invalid of ['0', '65536', '44.66', 'port']) {
    assert.throws(() => developmentBackendPort({ HEADLAMP_PORT: invalid }), /HEADLAMP_PORT must be/);
  }
});

test('keeps polling until the backend accepts connections', async () => {
  let checks = 0;
  const delays: number[] = [];
  await waitForPort(4466, {
    retryDelayMs: 250,
    delay: async milliseconds => {
      delays.push(milliseconds);
    },
    isListening: async (host, port) => {
      assert.equal(host, '127.0.0.1');
      assert.equal(port, 4466);
      return ++checks === 3;
    },
  });
  assert.equal(checks, 3);
  assert.deepEqual(delays, [250, 250]);
});

test('fails once the timeout elapses', async () => {
  let clock = 0;
  await assert.rejects(
    waitForPort(4466, {
      timeoutMs: 3000,
      retryDelayMs: 1000,
      now: () => clock,
      delay: async milliseconds => {
        clock += milliseconds;
      },
      isListening: async () => false,
    }),
    /Backend did not accept connections on 127\.0\.0\.1:4466 within 3s/
  );
  assert.equal(clock, 3000);
});

test('detects a real listening socket', async t => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  await waitForPort(port, { timeoutMs: 5000 });
});

test('rejects when nothing listens on the port', async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  await assert.rejects(waitForPort(port, { timeoutMs: 0, retryDelayMs: 1 }), /did not accept connections/);
});
