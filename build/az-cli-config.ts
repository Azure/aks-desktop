// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Shared resolution of the pinned Azure CLI version/extensions and the
 * marker recording what was actually staged for a platform, so the
 * downloader and the incremental build check both agree on whether an
 * existing az-cli directory is up to date.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AzureCliPlatformConfig {
  url?: string;
  checksum?: string;
  version?: string;
}

export interface AzureCliConfig {
  version?: string;
  extensions?: string[];
  linux?: AzureCliPlatformConfig;
  darwin?: AzureCliPlatformConfig;
  win32?: AzureCliPlatformConfig;
}

/** Records the version and extension set installed into a platform's az-cli directory. */
export interface StagedAzCli {
  version?: string;
  extensions?: string[];
}

const STAGED_MARKER_FILENAME = '.az-cli-staged.json';

export function azCliTargetDir(rootDir: string, platform: string): string {
  return path.join(rootDir, 'headlamp', 'app', 'resources', 'external-tools', 'az-cli', platform);
}

export function azCliBinaryPath(rootDir: string, platform: string): string {
  return path.join(
    azCliTargetDir(rootDir, platform),
    'bin',
    platform === 'win32' ? 'az.cmd' : 'az-wrapper'
  );
}

function azCliStagedMarkerPath(rootDir: string, platform: string): string {
  return path.join(azCliTargetDir(rootDir, platform), STAGED_MARKER_FILENAME);
}

export function readAzureCliConfig(rootDir: string): AzureCliConfig | undefined {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  return packageJson.config?.externalTools?.azureCli;
}

/**
 * A platform block may pin its own version, overriding the top-level pin -
 * download-az-cli.ts, verify-bundled-tools.ts and setup-plugins.ts must all
 * resolve the effective version the same way.
 */
export function resolveAzCliVersion(
  azureCliConfig: AzureCliConfig | undefined,
  platform: string
): string | undefined {
  const platformConfig = azureCliConfig?.[platform as keyof AzureCliConfig] as
    | AzureCliPlatformConfig
    | undefined;
  return platformConfig?.version || azureCliConfig?.version;
}

export function readStagedAzCli(rootDir: string, platform: string): StagedAzCli | undefined {
  const markerPath = azCliStagedMarkerPath(rootDir, platform);
  if (!fs.existsSync(markerPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as StagedAzCli;
  } catch {
    return undefined;
  }
}

export function writeStagedAzCli(rootDir: string, platform: string, staged: StagedAzCli): void {
  const markerPath = azCliStagedMarkerPath(rootDir, platform);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, `${JSON.stringify(staged, null, 2)}\n`);
}

/**
 * The extension set a platform's az-cli install is expected to carry.
 * installAzCliWindows() in download-az-cli.ts installs the same configured
 * extensions as the linux/darwin path (into the app-owned cliextensions
 * directory the Windows wrapper isolates), so the configured list applies to
 * every platform uniformly.
 */
export function expectedAzCliExtensions(
  azureCliConfig: AzureCliConfig | undefined,
  platform: string
): string[] {
  return azureCliConfig?.extensions ?? [];
}

/**
 * Filename the zip's stock `bin/az.cmd` is renamed to before
 * generateWindowsAzWrapperScript()'s replacement takes its place at
 * `bin/az.cmd`, so azCliBinaryPath() keeps working unchanged.
 */
export const WINDOWS_AZ_CLI_ORIGINAL_FILENAME = 'az-original.cmd';

/** Directory (relative to the az-cli target dir) the Windows wrapper points AZURE_EXTENSION_DIR at. */
export const WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME = 'cliextensions';

/**
 * Generates the `bin/az.cmd` that replaces the zip's stock script. Microsoft's
 * prebuilt Windows CLI zip never sets AZURE_EXTENSION_DIR, so `az` falls back
 * to `%USERPROFILE%\.azure\cliextensions` - any extension a user (or an older
 * version of this app) installed there keeps loading and can shadow core
 * commands. This wrapper isolates the bundled CLI in an app-owned
 * `cliextensions` directory, matching the linux/darwin wrapper's naming, then
 * delegates to the renamed original script.
 *
 * Resolves its own location via `%~dp0` rather than an absolute path, since
 * the bundle is relocatable and installed elsewhere on the user's machine.
 */
export function generateWindowsAzWrapperScript(): string {
  return (
    '@echo off\r\n' +
    'setlocal\r\n' +
    '\r\n' +
    'rem Isolate the bundled Azure CLI from the user profile so a previously\r\n' +
    'rem installed extension (e.g. aks-preview under %USERPROFILE%\\.azure\\cliextensions)\r\n' +
    'rem cannot shadow core commands added by this bundled version.\r\n' +
    `set "AZURE_EXTENSION_DIR=%~dp0..\\${WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME}"\r\n` +
    '\r\n' +
    `call "%~dp0${WINDOWS_AZ_CLI_ORIGINAL_FILENAME}" %*\r\n` +
    'exit /b %ERRORLEVEL%\r\n'
  );
}

export function sameExtensionSet(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((extension, index) => extension === sortedB[index]);
}

/**
 * True when the platform's az-cli target directory exists and contains
 * anything at all - including an install left incomplete by an interrupted
 * or partial run (e.g. one that copied `cliextensions/aks-preview` but never
 * reached the wrapper-script step). download-az-cli.ts uses this, rather
 * than checking for the wrapper alone, to decide whether the directory must
 * be wiped before a fresh install can overlay it - otherwise stale
 * extensions from an incomplete prior install would survive untouched.
 */
export function azCliTargetDirHasContent(rootDir: string, platform: string): boolean {
  const dir = azCliTargetDir(rootDir, platform);
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

/**
 * True when the platform's az-cli directory contains a wrapper binary and a
 * staged marker matching the expected version and extension set. Used by
 * setup-plugins.ts to decide whether an incremental build's staged Azure CLI
 * is still current, without shelling out to `az version`.
 */
export function isAzCliStagedForTarget(
  rootDir: string,
  platform: string,
  expectedVersion: string | undefined,
  expectedExtensions: string[] = []
): boolean {
  if (!expectedVersion || !fs.existsSync(azCliBinaryPath(rootDir, platform))) {
    return false;
  }
  const staged = readStagedAzCli(rootDir, platform);
  return (
    !!staged &&
    staged.version === expectedVersion &&
    sameExtensionSet(staged.extensions, expectedExtensions)
  );
}
