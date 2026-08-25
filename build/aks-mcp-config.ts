// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared resolution of the pinned aks-mcp release (version, download URL and
 * expected sha256) so the downloader, the incremental build check and the
 * post-build verification all agree on which architecture is being staged.
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

/** Records which platform/arch was staged so later build steps can verify it. */
const STAGED_TARGET_FILE = path.join('headlamp', 'app', 'resources', '.aks-mcp-target.json');

export interface AksMcpTarget {
  version: string;
  platform: string;
  arch: string;
  downloadUrl: string;
  targetPath: string;
  expectedChecksum: string;
}

export interface StagedAksMcpTarget {
  platform: string;
  arch: string;
  checksum?: string;
}

export function parseTargetArgs(argv: string[]): { platform?: string; arch?: string } {
  const read = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const match = argv.find(argument => argument.startsWith(prefix));
    return match?.slice(prefix.length);
  };
  return { platform: read('platform'), arch: read('arch') };
}

// electron-builder cross-builds are driven by these npm config vars, so they
// describe the package target while process.arch only describes the host.
export function resolveTargetArch(arch?: string): string {
  return arch || process.env.npm_config_target_arch || process.env.npm_config_arch || process.arch;
}

export function isSupportedAksMcpArch(arch: string): boolean {
  return arch in ASSET_ARCH;
}

export function aksMcpBinaryName(platform: string = process.platform): string {
  return platform === 'win32' ? 'aks-mcp.exe' : 'aks-mcp';
}

export function aksMcpBinaryPath(rootDir: string, platform: string = process.platform): string {
  return path.join(
    rootDir,
    'headlamp',
    'app',
    'resources',
    'external-tools',
    'bin',
    aksMcpBinaryName(platform)
  );
}

export function resolveAksMcpTarget(
  rootDir: string,
  platform: string = process.platform,
  arch?: string
): AksMcpTarget {
  if (!ASSET_PLATFORM[platform]) {
    throw new Error(`Unsupported platform for aks-mcp: ${platform}`);
  }

  const targetArch = resolveTargetArch(arch);

  if (!isSupportedAksMcpArch(targetArch)) {
    throw new Error(
      `Unsupported architecture for aks-mcp: ${targetArch} ` +
        `(supported: ${Object.keys(ASSET_ARCH).join(', ')})`
    );
  }

  const assetArch = ASSET_ARCH[targetArch];
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
    platform,
    arch: targetArch,
    downloadUrl: `https://github.com/Azure/aks-mcp/releases/download/${version}/${assetName}`,
    targetPath: aksMcpBinaryPath(rootDir, platform),
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

export function writeStagedTarget(rootDir: string, target: StagedAksMcpTarget): void {
  const markerPath = path.join(rootDir, STAGED_TARGET_FILE);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(target, null, 2)}\n`);
}

export function readStagedTarget(rootDir: string): StagedAksMcpTarget | undefined {
  const markerPath = path.join(rootDir, STAGED_TARGET_FILE);
  if (!fs.existsSync(markerPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as StagedAksMcpTarget;
  } catch {
    return undefined;
  }
}
