// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared resolution of the pinned aks-mcp release (version, download URL and
 * expected sha256) so the downloader and the incremental build check agree on
 * what "installed and up to date" means.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

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

export interface AksMcpTarget {
  version: string;
  downloadUrl: string;
  targetPath: string;
  expectedChecksum: string;
}

export function resolveAksMcpTarget(
  rootDir: string,
  platform: string = process.platform,
  arch: string = process.arch
): AksMcpTarget {
  if (!ASSET_PLATFORM[platform]) {
    throw new Error(`Unsupported platform for aks-mcp: ${platform}`);
  }

  if (!ASSET_ARCH[arch]) {
    throw new Error(
      `Unsupported architecture for aks-mcp: ${arch} ` +
        `(supported: ${Object.keys(ASSET_ARCH).join(', ')})`
    );
  }

  const assetArch = ASSET_ARCH[arch];
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')
  );
  const aksMcpConfig = packageJson.config?.externalTools?.aksMcp ?? {};
  const version: string = aksMcpConfig.version ?? '';
  const expectedChecksum: string | undefined =
    aksMcpConfig[platform]?.[assetArch]?.checksum ?? aksMcpConfig[platform]?.checksum;

  if (!version || version === 'latest') {
    throw new Error(
      'config.externalTools.aksMcp.version must be pinned to a release tag ' +
        '(for example "v0.0.20") so builds are reproducible.'
    );
  }

  if (!expectedChecksum) {
    throw new Error(
      `No sha256 checksum configured for aks-mcp ${version} on ${platform}/${assetArch}. ` +
        `Add config.externalTools.aksMcp.${platform}.${assetArch}.checksum to package.json.`
    );
  }

  const suffix = platform === 'win32' ? '.exe' : '';
  const assetName = `aks-mcp-${ASSET_PLATFORM[platform]}-${assetArch}${suffix}`;

  return {
    version,
    downloadUrl: `https://github.com/Azure/aks-mcp/releases/download/${version}/${assetName}`,
    targetPath: path.join(
      rootDir,
      'headlamp',
      'app',
      'resources',
      'external-tools',
      'bin',
      `aks-mcp${suffix}`
    ),
    expectedChecksum,
  };
}

/** True when the file exists and its sha256 matches the expected checksum. */
export function matchesChecksum(filePath: string, expectedChecksum: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const actual = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  return actual === expectedChecksum;
}
