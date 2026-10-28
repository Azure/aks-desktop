// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Downloads, verifies, extracts and validates the pinned insights-plugin release artifacts.
// Written in Node rather than bash so the build behaves the same from PowerShell, cmd, Git
// Bash, WSL, Linux and macOS: on Windows `bash` often resolves to WSL, whose Linux
// environment cannot see the Windows Node.js installation or tools.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

/** The plugin directory, resolved from this file rather than the working directory. */
export const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARCHIVE_ROOT = 'insights-plugin/';

/** Files extracted from the archive, relative to its top-level directory. */
export const REQUIRED_FILES = [
  'main.js',
  'main.wasm.gz',
  'package.json',
  'locales/en/translation.json',
  'locales/de/translation.json',
];

const ATTEMPTS = 6;
const RETRY_DELAY_MS = 5000;
const ATTEMPT_TIMEOUT_MS = 120000;
const BLOCK_SIZE = 512;

export function releaseUrl(version) {
  return `https://github.com/inspektor-gadget/insights-plugin/releases/download/v${version}/insights-plugin-${version}.tar.gz`;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Throws unless the archive matches the SHA-256 pinned in package.json. */
export function verifyChecksum(data, expected) {
  if (!/^[0-9a-f]{64}$/.test(expected ?? '')) {
    throw new Error('package.json must pin artifactSha256 to a lowercase SHA-256 hex digest');
  }
  const actual = sha256(data);
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for insights-plugin archive: expected ${expected}, got ${actual}`);
  }
}

function readString(block, start, length) {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

function readSize(block) {
  const field = block.subarray(124, 136);
  if (field[0] & 0x80) {
    let size = 0;
    for (let index = 1; index < field.length; index++) {
      size = size * 256 + field[index];
    }
    return size;
  }
  const text = readString(block, 124, 12).trim();
  return text ? parseInt(text, 8) : 0;
}

function paxPath(data) {
  let offset = 0;
  let found;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = parseInt(data.subarray(offset, space).toString('utf8'), 10);
    if (!Number.isInteger(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (record.slice(0, equals) === 'path') found = record.slice(equals + 1);
    offset += length;
  }
  return found;
}

/** Returns the regular files in an uncompressed tar archive, keyed by normalized path. */
export function readTarFiles(tar) {
  const files = new Map();
  let offset = 0;
  let nextPath;
  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    if (header.every(byte => byte === 0)) break;
    const size = readSize(header);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + BLOCK_SIZE;
    const data = tar.subarray(dataStart, dataStart + size);
    if (data.length !== size) {
      throw new Error('insights-plugin archive is truncated');
    }
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (type === 'x') {
      nextPath = paxPath(data);
      continue;
    }
    if (type === 'L') {
      nextPath = readString(data, 0, data.length);
      continue;
    }
    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const entryPath = nextPath ?? (prefix ? `${prefix}/${name}` : name);
    nextPath = undefined;
    if (type === '0' || type === '7') {
      files.set(entryPath.replace(/^(\.\/)+/, ''), Buffer.from(data));
    }
  }
  return files;
}

/** Extracts {@link REQUIRED_FILES} from a gzipped release archive; output paths are fixed. */
export function extractRequiredFiles(archive) {
  const files = readTarFiles(gunzipSync(archive));
  const missing = REQUIRED_FILES.filter(file => !files.has(ARCHIVE_ROOT + file));
  if (missing.length > 0) {
    throw new Error(`insights-plugin archive is missing: ${missing.join(', ')}`);
  }
  return new Map(REQUIRED_FILES.map(file => [file, files.get(ARCHIVE_ROOT + file)]));
}

/**
 * Downloads over HTTPS, retrying transient failures like the previous curl invocation.
 * Like curl, this honors HTTPS_PROXY/https_proxy and NO_PROXY only when Node starts with
 * `--use-env-proxy` (or NODE_USE_ENV_PROXY=1), as the package build script does.
 */
export async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
      if (!response.url.startsWith('https://')) {
        throw new Error(`Refusing non-HTTPS download from ${response.url}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} downloading ${url}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) {
        console.warn(`Download attempt ${attempt} failed (${error.message}); retrying...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

export function readManifest(pluginDir = PLUGIN_DIR) {
  return JSON.parse(readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
}

/** Replaces `dist/` with the extracted files, using only the fixed relative paths. */
export function writeDist(files, pluginDir = PLUGIN_DIR) {
  const distDir = path.join(pluginDir, 'dist');
  rmSync(distDir, { recursive: true, force: true });
  for (const [file, contents] of files) {
    const target = path.join(distDir, ...file.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

function nonEmptyFile(file) {
  try {
    const stats = statSync(file);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function containsWasm(file) {
  try {
    return gunzipSync(readFileSync(file)).subarray(0, 4).toString('hex') === '0061736d';
  } catch {
    return false;
  }
}

/** Runs the checks previously done by validate-artifacts.sh; returns `[description, passed]`. */
export function validateDist(pluginDir = PLUGIN_DIR) {
  const distDir = path.join(pluginDir, 'dist');
  return [
    ['main.js exists and is non-empty', nonEmptyFile(path.join(distDir, 'main.js'))],
    ['main.wasm.gz exists and is non-empty', nonEmptyFile(path.join(distDir, 'main.wasm.gz'))],
    ['main.wasm.gz contains valid WASM', containsWasm(path.join(distDir, 'main.wasm.gz'))],
  ];
}
