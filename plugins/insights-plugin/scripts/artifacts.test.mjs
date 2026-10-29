// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  extractRequiredFiles,
  readManifest,
  readTarFiles,
  releaseUrl,
  REQUIRED_FILES,
  sha256,
  validateDist,
  verifyChecksum,
  writeDist,
} from './artifacts.mjs';

function header(name, size, type, prefix = '') {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write(type, 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  block.write(prefix, 345, 155, 'utf8');
  block.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of block) checksum += byte;
  block.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

function padded(data) {
  return Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

function entry(name, contents, { type = '0', prefix } = {}) {
  const data = Buffer.from(contents);
  return Buffer.concat([header(name, data.length, type, prefix), padded(data)]);
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (`${length}${body}`.length !== length) length++;
  return `${length}${body}`;
}

function tarball(...entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

function releaseArchive(extraEntries = []) {
  return gzipSync(
    tarball(
      entry('insights-plugin/', '', { type: '5' }),
      ...REQUIRED_FILES.map(file => entry(`insights-plugin/${file}`, `contents of ${file}`)),
      entry('insights-plugin/locales/fr/translation.json', 'not needed'),
      ...extraEntries
    )
  );
}

test('builds the release URL from the package version', () => {
  assert.equal(
    releaseUrl('0.3.2'),
    'https://github.com/inspektor-gadget/insights-plugin/releases/download/v0.3.2/insights-plugin-0.3.2.tar.gz'
  );
});

const PROXY_VARIABLES = new Set([
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'NODE_USE_ENV_PROXY',
  'NODE_OPTIONS',
]);

/** Starts a proxy that records CONNECT targets and refuses to tunnel them. */
async function recordingProxy(t) {
  const targets = [];
  const server = createServer((request, response) => response.writeHead(405).end());
  server.on('connect', (request, socket) => {
    targets.push(request.url);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { targets, url: `http://127.0.0.1:${server.address().port}` };
}

for (const variable of ['HTTPS_PROXY', 'https_proxy']) {
  test(`the build script sends HTTPS downloads through ${variable}`, async t => {
    const [command, ...args] = readManifest().scripts.build.split(' ');
    assert.equal(command, 'node');
    assert.equal(args.at(-1), 'scripts/download-artifacts.mjs');
    const proxy = await recordingProxy(t);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !PROXY_VARIABLES.has(name.toUpperCase()))
    );

    const child = spawn(
      process.execPath,
      [
        ...args.slice(0, -1),
        '--input-type=module',
        '--eval',
        "await fetch('https://insights-plugin.invalid/archive.tar.gz').catch(() => {});",
      ],
      { env: { ...env, [variable]: proxy.url }, stdio: 'inherit' }
    );
    const [code] = await once(child, 'exit');

    assert.equal(code, 0);
    assert.deepEqual(proxy.targets, ['insights-plugin.invalid:443']);
  });
}

test('extracts exactly the required files with the top-level directory stripped', () => {
  const files = extractRequiredFiles(releaseArchive());
  assert.deepEqual([...files.keys()], REQUIRED_FILES);
  for (const file of REQUIRED_FILES) {
    assert.equal(files.get(file).toString(), `contents of ${file}`);
  }
});

test('reports every required file missing from the archive', () => {
  const archive = gzipSync(tarball(entry('insights-plugin/main.js', 'js')));
  assert.throws(
    () => extractRequiredFiles(archive),
    /missing: main\.wasm\.gz, package\.json, locales\/en\/translation\.json, locales\/de\/translation\.json/
  );
});

test('reads ./-prefixed, ustar-prefixed, pax and GNU long names', () => {
  const longDirectory = `insights-plugin/${'d'.repeat(120)}`;
  const files = readTarFiles(
    tarball(
      entry('./insights-plugin/main.js', 'dot'),
      entry('translation.json', 'prefixed', { prefix: 'insights-plugin/locales/en' }),
      entry('PaxHeader', paxRecord('path', `${longDirectory}/pax.txt`), { type: 'x' }),
      entry('truncated-name', 'pax'),
      entry('././@LongLink', `${longDirectory}/gnu.txt\0`, { type: 'L' }),
      entry('truncated-name', 'gnu'),
      entry('insights-plugin/link', '', { type: '2' })
    )
  );
  assert.equal(files.get('insights-plugin/main.js').toString(), 'dot');
  assert.equal(files.get('insights-plugin/locales/en/translation.json').toString(), 'prefixed');
  assert.equal(files.get(`${longDirectory}/pax.txt`).toString(), 'pax');
  assert.equal(files.get(`${longDirectory}/gnu.txt`).toString(), 'gnu');
  assert.equal(files.has('truncated-name'), false);
  assert.equal(files.has('insights-plugin/link'), false);
});

test('rejects a truncated archive', () => {
  const truncated = entry('insights-plugin/main.js', 'x'.repeat(2000)).subarray(0, 1024);
  assert.throws(() => readTarFiles(truncated), /truncated/);
});

test('accepts only the pinned checksum', () => {
  const archive = releaseArchive();
  assert.doesNotThrow(() => verifyChecksum(archive, sha256(archive)));
  assert.throws(() => verifyChecksum(archive, 'a'.repeat(64)), /Checksum mismatch/);
  for (const invalid of [undefined, '', 'abc', sha256(archive).toUpperCase()]) {
    assert.throws(() => verifyChecksum(archive, invalid), /must pin artifactSha256/);
  }
});

function temporaryPluginDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'insights-plugin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('replaces dist with the extracted files using native path separators', t => {
  const pluginDir = temporaryPluginDir(t);
  mkdirSync(path.join(pluginDir, 'dist'));
  writeFileSync(path.join(pluginDir, 'dist', 'stale.js'), 'stale');
  writeDist(extractRequiredFiles(releaseArchive()), pluginDir);
  for (const file of REQUIRED_FILES) {
    const written = path.join(pluginDir, 'dist', ...file.split('/'));
    assert.equal(readFileSync(written, 'utf8'), `contents of ${file}`);
  }
  assert.throws(() => readFileSync(path.join(pluginDir, 'dist', 'stale.js')), { code: 'ENOENT' });
});

test('validates dist like the previous shell checks', t => {
  const pluginDir = temporaryPluginDir(t);
  const failed = results => results.filter(([, passed]) => !passed).map(([description]) => description);
  assert.deepEqual(failed(validateDist(pluginDir)), [
    'main.js exists and is non-empty',
    'main.wasm.gz exists and is non-empty',
    'main.wasm.gz contains valid WASM',
  ]);

  const dist = path.join(pluginDir, 'dist');
  mkdirSync(dist);
  writeFileSync(path.join(dist, 'main.js'), 'js');
  writeFileSync(path.join(dist, 'main.wasm.gz'), gzipSync(Buffer.from('not wasm')));
  assert.deepEqual(failed(validateDist(pluginDir)), ['main.wasm.gz contains valid WASM']);

  writeFileSync(path.join(dist, 'main.wasm.gz'), gzipSync(Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0])));
  assert.deepEqual(failed(validateDist(pluginDir)), []);
});
