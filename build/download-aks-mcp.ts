#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Download the aks-mcp binary for the current platform into the bundled
 * external-tools/bin directory, which the Electron main process prepends to
 * PATH at startup. The AI Assistant plugin preconfigures an "aks-mcp" MCP
 * server with the bare command name, so it resolves from that PATH entry.
 *
 * Accepts --platform=<node platform> and --arch=<node arch> so packaging can
 * stage the binary matching the package target rather than the build host.
 * Running this repeatedly is safe: an already installed binary is downloaded
 * again only when its checksum no longer matches the pinned configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { createHash } from 'crypto';
import {
  aksMcpBinaryPath,
  ensureExecutable,
  isSupportedAksMcpArch,
  matchesChecksum,
  parseTargetArgs,
  resolveAksMcpTarget,
  resolveTargetArch,
  writeStagedTarget,
} from './aks-mcp-config';

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
  const args = parseTargetArgs(process.argv.slice(2));
  const platform = args.platform ?? process.platform;
  const arch = resolveTargetArch(args.arch);

  // The bin directory is shared between targets, so drop the binary staged for
  // the other platform to keep it out of this package.
  const foreignBinary = aksMcpBinaryPath(ROOT_DIR, platform === 'win32' ? 'linux' : 'win32');
  fs.rmSync(foreignBinary, { force: true });

  // No release asset exists for architectures such as armv7l, so drop any
  // previously staged binary instead of packaging one for the wrong CPU.
  if (!isSupportedAksMcpArch(arch)) {
    fs.rmSync(aksMcpBinaryPath(ROOT_DIR, platform), { force: true });
    writeStagedTarget(ROOT_DIR, { platform, arch });
    console.warn(`No aks-mcp release asset for ${platform}/${arch}; skipping it for this target.`);
    return;
  }

  const { version, downloadUrl, targetPath, expectedChecksum } = resolveAksMcpTarget(
    ROOT_DIR,
    platform,
    arch
  );
  writeStagedTarget(ROOT_DIR, { platform, arch, checksum: expectedChecksum });

  if (matchesChecksum(targetPath, expectedChecksum)) {
    ensureExecutable(targetPath, platform);
    console.log(`aks-mcp ${version} (${platform}/${arch}) already up to date at: ${targetPath}`);
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await download(downloadUrl, targetPath);

  const actual = createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
  if (actual !== expectedChecksum) {
    fs.rmSync(targetPath, { force: true });
    throw new Error(`Checksum mismatch for aks-mcp: expected ${expectedChecksum}, got ${actual}`);
  }

  ensureExecutable(targetPath, platform);

  console.log(`aks-mcp ${version} (${platform}/${arch}) installed to: ${targetPath}`);
}

main().catch(error => {
  console.error('ERROR: Failed to install aks-mcp');
  console.error(error);
  process.exit(1);
});
