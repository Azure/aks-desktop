#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Download the aks-mcp binary for the current platform into the bundled
 * external-tools/bin directory, which the Electron main process prepends to
 * PATH at startup. The AI Assistant plugin preconfigures an "aks-mcp" MCP
 * server with the bare command name, so it resolves from that PATH entry.
 *
 * Running this repeatedly is safe: an already installed binary is downloaded
 * again only when its checksum no longer matches the pinned configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { createHash } from 'crypto';
import { matchesChecksum, resolveAksMcpTarget } from './aks-mcp-config';

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);

/** Downloads a URL to disk, following GitHub release redirects. */
function download(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          download(response.headers.location, destination).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with status ${response.statusCode}: ${url}`));
          return;
        }
        const file = fs.createWriteStream(destination);
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  const { version, downloadUrl, targetPath, expectedChecksum } = resolveAksMcpTarget(ROOT_DIR);

  if (matchesChecksum(targetPath, expectedChecksum)) {
    console.log(`aks-mcp ${version} already up to date at: ${targetPath}`);
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await download(downloadUrl, targetPath);

  const actual = createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
  if (actual !== expectedChecksum) {
    fs.rmSync(targetPath, { force: true });
    throw new Error(`Checksum mismatch for aks-mcp: expected ${expectedChecksum}, got ${actual}`);
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(targetPath, 0o755);
  }

  console.log(`aks-mcp ${version} installed to: ${targetPath}`);
}

main().catch(error => {
  console.error('ERROR: Failed to install aks-mcp');
  console.error(error);
  process.exit(1);
});
