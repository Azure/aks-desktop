// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const keytarArtifacts = [
  {
    arch: 'x64',
    archiveChecksum: '4ce56e3896e76a2deaef13f8a36207efa6d94d96678d30200952d83d327eb5f9',
    binaryChecksum: '62a94162e3108f55f287764ebcdec0c735988487b79f45da4172826f0decbc96',
  },
  {
    arch: 'arm64',
    archiveChecksum: '195f0855e26f83e0d61e228d1b61c7769baa993244518dc9879d9d57104c7cec',
    binaryChecksum: '6c32c41c0e5a9e546616607b0383eada5bb646d0164324f20baab59d5b7963fa',
  },
];

const checksum = data => createHash('sha256').update(data).digest('hex');

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Install a checksum-verified macOS keytar binary, reusing a valid local copy. */
export async function installKeytarArtifact(keytarDir, artifact, fetchArchive = download) {
  const { arch, archiveChecksum, binaryChecksum } = artifact;
  const targetDir = path.join(keytarDir, 'bin', `darwin-${arch}`);
  const targetPath = path.join(targetDir, 'keytar.node');
  if (fs.existsSync(targetPath) && checksum(fs.readFileSync(targetPath)) === binaryChecksum) {
    return;
  }

  const url = `https://github.com/atom/node-keytar/releases/download/v7.9.0/keytar-v7.9.0-napi-v3-darwin-${arch}.tar.gz`;
  const archive = await fetchArchive(url);
  if (checksum(archive) !== archiveChecksum) {
    throw new Error(`Archive checksum mismatch for keytar darwin-${arch}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keytar-'));
  try {
    const archivePath = path.join(tempDir, 'keytar.tar.gz');
    fs.writeFileSync(archivePath, archive);
    const binary = execFileSync('tar', ['-xOzf', archivePath, 'build/Release/keytar.node']);
    if (checksum(binary) !== binaryChecksum) {
      throw new Error(`Binary checksum mismatch for keytar darwin-${arch}`);
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, binary);
    console.log(`Installed keytar darwin-${arch} at ${targetPath}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keytarDir = fileURLToPath(new URL('./keytar/', import.meta.url));
  try {
    for (const artifact of keytarArtifacts) {
      await installKeytarArtifact(keytarDir, artifact);
    }
  } catch (error) {
    console.error('Failed to install macOS keytar binaries:', error);
    process.exitCode = 1;
  }
}
