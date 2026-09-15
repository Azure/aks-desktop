// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { installKeytarArtifact, keytarArtifacts } from './download-keytar.mjs';

const checksum = data => createHash('sha256').update(data).digest('hex');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keytar-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releaseDir = path.join(root, 'build', 'Release');
  fs.mkdirSync(releaseDir, { recursive: true });
  const binary = Buffer.from('test native binary');
  fs.writeFileSync(path.join(releaseDir, 'keytar.node'), binary);
  const archivePath = path.join(root, 'fixture.tar.gz');
  execFileSync('tar', ['-czf', archivePath, '-C', root, 'build/Release/keytar.node']);
  const archive = fs.readFileSync(archivePath);
  const keytarDir = path.join(root, 'keytar');
  const artifacts = keytarArtifacts.map(artifact => ({
    ...artifact,
    archiveChecksum: checksum(archive),
    binaryChecksum: checksum(binary),
  }));
  return { keytarDir, binary, archive, artifacts };
}

const binaryPath = (keytarDir, arch) =>
  path.join(keytarDir, 'bin', `darwin-${arch}`, 'keytar.node');

test('installs both architectures at the loader paths and reuses verified binaries', async t => {
  const { keytarDir, binary, archive, artifacts } = createFixture(t);
  assert.deepEqual(artifacts.map(({ arch }) => arch).sort(), ['arm64', 'x64']);
  for (const artifact of artifacts) {
    await installKeytarArtifact(keytarDir, artifact, async url => {
      assert.equal(
        url,
        `https://github.com/atom/node-keytar/releases/download/v7.9.0/keytar-v7.9.0-napi-v3-darwin-${artifact.arch}.tar.gz`
      );
      return archive;
    });
    assert.deepEqual(fs.readFileSync(binaryPath(keytarDir, artifact.arch)), binary);
    await installKeytarArtifact(keytarDir, artifact, () => {
      assert.fail('A verified cached binary must not be downloaded again');
    });
  }
});

test('replaces a corrupt cached binary', async t => {
  const { keytarDir, binary, archive, artifacts } = createFixture(t);
  const artifact = artifacts[0];
  const target = binaryPath(keytarDir, artifact.arch);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'corrupt');
  await installKeytarArtifact(keytarDir, artifact, async () => archive);
  assert.deepEqual(fs.readFileSync(target), binary);
});

test('rejects an archive checksum mismatch without installing a binary', async t => {
  const { keytarDir, artifacts } = createFixture(t);
  await assert.rejects(
    installKeytarArtifact(keytarDir, artifacts[0], async () => Buffer.from('corrupt')),
    /Archive checksum mismatch/
  );
  assert.equal(fs.existsSync(binaryPath(keytarDir, artifacts[0].arch)), false);
});

test('rejects an extracted binary checksum mismatch', async t => {
  const { keytarDir, archive, artifacts } = createFixture(t);
  const artifact = { ...artifacts[0], binaryChecksum: checksum('different binary') };
  await assert.rejects(
    installKeytarArtifact(keytarDir, artifact, async () => archive),
    /Binary checksum mismatch/
  );
  assert.equal(fs.existsSync(binaryPath(keytarDir, artifact.arch)), false);
});

test('propagates download failures without installing a binary', async t => {
  const { keytarDir, artifacts } = createFixture(t);
  await assert.rejects(
    installKeytarArtifact(keytarDir, artifacts[0], async () => {
      throw new Error('Network unavailable');
    }),
    /Network unavailable/
  );
  assert.equal(fs.existsSync(binaryPath(keytarDir, artifacts[0].arch)), false);
});
