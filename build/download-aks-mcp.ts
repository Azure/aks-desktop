#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Download the aks-mcp binary for the current platform into the bundled
 * external-tools/bin directory, which the Electron main process prepends to
 * PATH at startup. The AI Assistant plugin preconfigures an "aks-mcp" MCP
 * server with the bare command name, so it resolves from that PATH entry.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);
const EXTERNAL_TOOLS_BIN = path.join(
  ROOT_DIR,
  'headlamp',
  'app',
  'resources',
  'external-tools',
  'bin'
);
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

const PLATFORM = process.platform;

const ASSET_PLATFORM: Record<string, string> = {
  linux: 'linux',
  darwin: 'darwin',
  win32: 'windows',
};

/** Release assets are published for these architectures only. */
const ASSET_ARCH: Record<string, string> = {
  arm64: 'arm64',
  x64: 'amd64',
};

if (!ASSET_PLATFORM[PLATFORM]) {
  console.error(`Unsupported platform for aks-mcp: ${PLATFORM}`);
  process.exit(1);
}

if (!ASSET_ARCH[process.arch]) {
  console.error(
    `Unsupported architecture for aks-mcp: ${process.arch} ` +
      `(supported: ${Object.keys(ASSET_ARCH).join(', ')})`
  );
  process.exit(1);
}

const ARCH = ASSET_ARCH[process.arch];

const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
const aksMcpConfig = packageJson.config?.externalTools?.aksMcp ?? {};
const VERSION: string = aksMcpConfig.version ?? '';
const EXPECTED_CHECKSUM: string | undefined =
  aksMcpConfig[PLATFORM]?.[ARCH]?.checksum ?? aksMcpConfig[PLATFORM]?.checksum;

if (!VERSION || VERSION === 'latest') {
  console.error(
    'config.externalTools.aksMcp.version must be pinned to a release tag ' +
      '(for example "v0.0.20") so builds are reproducible.'
  );
  process.exit(1);
}

if (!EXPECTED_CHECKSUM) {
  console.error(
    `No sha256 checksum configured for aks-mcp ${VERSION} on ${PLATFORM}/${ARCH}. ` +
      `Add config.externalTools.aksMcp.${PLATFORM}.${ARCH}.checksum to package.json.`
  );
  process.exit(1);
}

const suffix = PLATFORM === 'win32' ? '.exe' : '';
const assetName = `aks-mcp-${ASSET_PLATFORM[PLATFORM]}-${ARCH}${suffix}`;
const downloadUrl = `https://github.com/Azure/aks-mcp/releases/download/${VERSION}/${assetName}`;

const targetPath = path.join(EXTERNAL_TOOLS_BIN, `aks-mcp${suffix}`);

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
  fs.mkdirSync(EXTERNAL_TOOLS_BIN, { recursive: true });
  await download(downloadUrl, targetPath);

  const { createHash } = await import('crypto');
  const actual = createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
  if (actual !== EXPECTED_CHECKSUM) {
    fs.rmSync(targetPath, { force: true });
    throw new Error(`Checksum mismatch for aks-mcp: expected ${EXPECTED_CHECKSUM}, got ${actual}`);
  }

  if (PLATFORM !== 'win32') {
    fs.chmodSync(targetPath, 0o755);
  }

  console.log(`aks-mcp ${VERSION} installed to: ${targetPath}`);
}

main().catch(error => {
  console.error('ERROR: Failed to install aks-mcp');
  console.error(error);
  process.exit(1);
});
