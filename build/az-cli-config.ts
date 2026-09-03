// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared target resolution for the bundled Azure CLI.
 *
 * One trunk, many boughs: every build grows from the same pinned seed in
 * package.json, and each platform and architecture is a separate branch that
 * must not be mistaken for its neighbour.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseTargetArgs, resolveTargetArch } from './aks-mcp-config';

const SUPPORTED_PLATFORMS = new Set(['linux', 'darwin', 'win32']);
const SUPPORTED_ARCHES = new Set(['x64', 'arm64']);
const STAGED_TARGET_FILE = path.join(
  'headlamp',
  'app',
  'resources',
  '.azure-cli-target.json'
);

interface DownloadConfig {
  url?: string;
  checksum?: string;
}

interface ArchitectureConfig extends DownloadConfig {
  x64?: DownloadConfig;
  arm64?: DownloadConfig;
}

interface AzureCliConfig {
  version?: string;
  extensions?: string[];
  linux?: ArchitectureConfig;
  darwin?: ArchitectureConfig;
  win32?: ArchitectureConfig;
}

interface ExternalToolsConfig {
  python?: {
    linux?: ArchitectureConfig;
    darwin?: ArchitectureConfig;
  };
  azureCli?: AzureCliConfig;
}

export interface AzureCliTarget {
  platform: string;
  arch: string;
  bundleArch: string;
  targetDir: string;
  executablePath: string;
  version: string;
  extensions: string[];
  python?: Required<DownloadConfig>;
  archive?: Required<DownloadConfig>;
  fingerprint: string;
}

export interface StagedAzureCliTarget {
  platform: string;
  arch: string;
  bundleArch: string;
  fingerprint: string;
}

export const WINDOWS_AZ_CLI_ORIGINAL_FILENAME = 'az-original.cmd';
export const WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME = 'cliextensions';

/**
 * Refuses a download that is not rooted: without a pinned url and checksum
 * there is nothing to hold the bundle in place, so the build falls.
 */
function requiredDownload(
  config: DownloadConfig | undefined,
  description: string
): Required<DownloadConfig> {
  if (!config?.url || !config.checksum) {
    throw new Error(`${description} must have a pinned url and sha256 checksum.`);
  }
  return { url: config.url, checksum: config.checksum };
}

/**
 * Follows the config down to the bough for this architecture, falling back to
 * the shared trunk entry when a platform grows no separate limbs.
 */
function platformArchConfig(
  config: ArchitectureConfig | undefined,
  arch: string
): DownloadConfig | undefined {
  return config?.[arch as 'x64' | 'arm64'] ??
    (config?.url || config?.checksum ? config : undefined);
}

/**
 * Chooses which grain the bundled tools are cut from, which is not always the
 * grain of the application itself.
 *
 * Windows on ARM grows from the official x64 ZIP under emulation. macOS keeps
 * the established x64 external-tool bundle for both app architectures: the
 * release pipeline currently builds both DMGs on the same Intel pool, and the
 * x64 tools avoid the ad-hoc ARM signature rejected during notarization.
 */
export function resolveAzureCliBundleArch(platform: string, arch: string): string {
  return (platform === 'win32' && arch === 'arm64') || platform === 'darwin'
    ? 'x64'
    : arch;
}

/** Where the ring is cut: the marker recording which target this tree grew for. */
export function azureCliTargetMarkerPath(rootDir: string): string {
  return path.join(rootDir, STAGED_TARGET_FILE);
}

/**
 * True when anything still stands in the clearing — a finished install, or the
 * deadwood of one that was interrupted. Either must be felled before replanting.
 */
export function azureCliTargetDirHasContent(target: AzureCliTarget): boolean {
  return fs.existsSync(target.targetDir) && fs.readdirSync(target.targetDir).length > 0;
}

/**
 * Grafts a wrapper onto the portable Windows CLI so it draws extensions only
 * from our own soil rather than whatever took root in the user's profile,
 * then hands the call on to the original script from the official ZIP.
 */
export function generateWindowsAzWrapperScript(): string {
  return (
    '@echo off\r\n' +
    'setlocal\r\n' +
    `set "AZURE_EXTENSION_DIR=%~dp0..\\${WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME}"\r\n` +
    `call "%~dp0${WINDOWS_AZ_CLI_ORIGINAL_FILENAME}" %*\r\n` +
    'exit /b %ERRORLEVEL%\r\n'
  );
}

/**
 * Grows the whole branch for one platform and architecture: paths, pinned
 * downloads, extensions, and a fingerprint that no other branch can match.
 */
export function resolveAzureCliTarget(
  rootDir: string,
  platform: string = process.platform,
  arch?: string
): AzureCliTarget {
  const targetArch = resolveTargetArch(arch);
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform for Azure CLI: ${platform}`);
  }
  if (!SUPPORTED_ARCHES.has(targetArch)) {
    throw new Error(
      `Unsupported architecture for bundled Azure CLI: ${targetArch} ` +
        `(supported: ${[...SUPPORTED_ARCHES].join(', ')})`
    );
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')
  );
  const externalTools = packageJson.config?.externalTools as ExternalToolsConfig | undefined;
  const azureCli = externalTools?.azureCli;
  const version = azureCli?.version;
  if (!version || version === 'latest') {
    throw new Error('config.externalTools.azureCli.version must be pinned.');
  }

  const bundleArch = resolveAzureCliBundleArch(platform, targetArch);
  const extensions = Array.isArray(azureCli.extensions) ? azureCli.extensions : [];
  const targetDir = path.join(
    rootDir,
    'headlamp',
    'app',
    'resources',
    'external-tools',
    'az-cli',
    platform
  );
  const executablePath = path.join(
    targetDir,
    'bin',
    platform === 'win32' ? 'az.cmd' : 'az-wrapper'
  );

  let python: Required<DownloadConfig> | undefined;
  let archive: Required<DownloadConfig> | undefined;
  if (platform === 'win32') {
    archive = requiredDownload(
      platformArchConfig(azureCli.win32, bundleArch),
      `config.externalTools.azureCli.win32.${bundleArch}`
    );
  } else {
    python = requiredDownload(
      platformArchConfig(externalTools?.python?.[platform], bundleArch),
      `config.externalTools.python.${platform}.${bundleArch}`
    );
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ platform, targetArch, bundleArch, version, extensions, python, archive }))
    .digest('hex');

  return {
    platform,
    arch: targetArch,
    bundleArch,
    targetDir,
    executablePath,
    version,
    extensions,
    python,
    archive,
    fingerprint,
  };
}

/** Cuts this build's growth ring, so a later pass can read what was grown here. */
export function writeStagedAzureCliTarget(
  rootDir: string,
  target: AzureCliTarget
): void {
  const markerPath = azureCliTargetMarkerPath(rootDir);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const staged: StagedAzureCliTarget = {
    platform: target.platform,
    arch: target.arch,
    bundleArch: target.bundleArch,
    fingerprint: target.fingerprint,
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(staged, null, 2)}\n`);
}

/** Reads the growth ring back, treating an unreadable one as no ring at all. */
export function readStagedAzureCliTarget(
  rootDir: string
): StagedAzureCliTarget | undefined {
  const markerPath = azureCliTargetMarkerPath(rootDir);
  if (!fs.existsSync(markerPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as StagedAzureCliTarget;
  } catch {
    return undefined;
  }
}

/**
 * True only when the ring matches this branch and the wrapper still stands
 * ready to run. A stripped executable bit counts as rot, not as growth.
 */
export function isAzureCliStagedForTarget(rootDir: string, target: AzureCliTarget): boolean {
  const staged = readStagedAzureCliTarget(rootDir);
  const executableExists = fs.existsSync(target.executablePath);
  const executableReady =
    target.platform === 'win32' ||
    (executableExists &&
      (fs.statSync(target.executablePath).mode & fs.constants.S_IXUSR) !== 0);
  return (
    staged?.platform === target.platform &&
    staged.arch === target.arch &&
    staged.bundleArch === target.bundleArch &&
    staged.fingerprint === target.fingerprint &&
    executableExists &&
    executableReady
  );
}

export { parseTargetArgs, resolveTargetArch };
