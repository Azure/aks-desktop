// Copyright (c) Microsoft Corporation.
// Licensed under the Apache License. See LICENSE.

'use strict';

const { timingSafeEqual } = require('node:crypto');
const http = require('node:http');
const { parentPort, workerData } = require('node:worker_threads');
const { allowedSigningTarget, sign } = require('./esrp-sign.cjs');

function authorized(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const expected = Buffer.from(workerData.secret);
  const actual = Buffer.from(header.slice(7));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('Signing request is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.url !== '/sign') {
      throw Object.assign(new Error('Not found'), { status: 404 });
    }
    if (!authorized(request.headers.authorization)) {
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    }
    const { file } = JSON.parse(await readBody(request));
    const target = typeof file === 'string'
      ? allowedSigningTarget(file, workerData.outputRoot)
      : false;
    if (!target) {
      throw Object.assign(new Error('Signing target is not allowed'), { status: 400 });
    }
    await sign(target);
    response.writeHead(204).end();
  } catch (error) {
    const status = error.status ?? 500;
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end(status === 500 ? 'Signing failed' : error.message);
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  parentPort.postMessage(`http://127.0.0.1:${address.port}`);
});

parentPort.on('message', message => {
  if (message === 'close') server.close(() => process.exit(0));
});
