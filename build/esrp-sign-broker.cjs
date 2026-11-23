// Copyright (c) Microsoft Corporation.
// Licensed under the Apache License. See LICENSE.

'use strict';

const { timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { parentPort, workerData } = require('node:worker_threads');
const { allowedSigningTarget, sign } = require('./esrp-sign.cjs');

function authorized(header, secret) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const expected = Buffer.from(secret);
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

function createSigningBroker({
  secret,
  outputRoot,
  signer = sign,
  validateTarget = allowedSigningTarget,
}) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aksd-signing-'));
  fs.chmodSync(stagingRoot, 0o700);
  let active = 0;
  async function signValidatedFile(target) {
    active += 1;
    const stagedDirectory = path.join(
      stagingRoot,
      `${active}-${process.hrtime.bigint()}`
    );
    fs.mkdirSync(stagedDirectory, { mode: 0o700 });
    const staged = path.join(stagedDirectory, path.basename(target));
    const opened = fs.openSync(
      target,
      fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0)
    );
    try {
      const before = fs.fstatSync(opened);
      if (!before.isFile() || before.nlink !== 1) {
        throw new Error('Signing target changed before staging');
      }
      await pipeline(
        fs.createReadStream('', { fd: opened, autoClose: false }),
        fs.createWriteStream(staged, { flags: 'wx', mode: 0o600 })
      );
      await signer(staged);
      const after = fs.fstatSync(opened);
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.nlink !== 1
      ) {
        throw new Error('Signing target changed during signing');
      }
      fs.ftruncateSync(opened, 0);
      const signed = fs.readFileSync(staged);
      let offset = 0;
      while (offset < signed.length) {
        offset += fs.writeSync(opened, signed, offset, signed.length - offset, offset);
      }
    } finally {
      fs.closeSync(opened);
      fs.rmSync(stagedDirectory, { recursive: true, force: true });
    }
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/sign') {
        throw Object.assign(new Error('Not found'), { status: 404 });
      }
      if (!authorized(request.headers.authorization, secret)) {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }
      let body;
      try {
        body = JSON.parse(await readBody(request));
      } catch (error) {
        throw Object.assign(new Error(`Invalid signing request: ${error.message}`), { status: 400 });
      }
      const { file } = body;
      const target = typeof file === 'string'
        ? validateTarget(file, outputRoot)
        : false;
      if (!target) {
        throw Object.assign(new Error('Signing target is not allowed'), { status: 400 });
      }
      await signValidatedFile(target);
      response.writeHead(204).end();
    } catch (error) {
      const status = error.status ?? 500;
      response.writeHead(status, { 'content-type': 'text/plain' });
      response.end(status === 500 ? 'Signing failed' : error.message);
    }
  });
  server.on('close', () =>
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  );
  return server;
}

module.exports = { createSigningBroker };

if (parentPort && workerData) {
  const server = createSigningBroker(workerData);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    parentPort.postMessage(`http://127.0.0.1:${address.port}`);
  });
  parentPort.on('message', message => {
    if (message === 'close') server.close(() => process.exit(0));
  });
}
