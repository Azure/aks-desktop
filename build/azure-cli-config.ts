// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Resolves the reviewed Azure CLI/Python artifacts for a package target and provides stable
 * identities used by download caching, extension installation, and checksum verification.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';

import { resolveTargetArch } from './build-target';

interface RuntimeConfig {
  url: string;
  checksum: string;
  runtimeArch?: string;
}

interface AzureCliConfig {
  version?: string;
  extensions?: string[];
  extensionVersions?: Record<string, string>;
  extensionPackages?: Record<string, RuntimeConfig>;
  linux?: Record<string, RuntimeConfig>;
  darwin?: Record<string, RuntimeConfig>;
  win32?: Record<string, RuntimeConfig>;
}

interface PythonConfig {
  version?: string;
  linux?: Record<string, RuntimeConfig>;
  darwin?: Record<string, RuntimeConfig>;
}

export interface AzureCliTarget {
  platform: string;
  arch: string;
  version: string;
  extensions: string[];
  extensionVersions: Record<string, string>;
  extensionPackages: Record<string, RuntimeConfig>;
  extensionLockPath?: string;
  extensionLockChecksum?: string;
  pythonVersion?: string;
  python?: RuntimeConfig;
  cliPackage?: RuntimeConfig;
}

/** Returns the stable fields that determine whether an Azure CLI staging cache is reusable. */
export function azureCliCacheIdentity(target: AzureCliTarget) {
  return {
    platform: target.platform,
    runtimeArch: target.cliPackage?.runtimeArch || target.arch,
    version: target.version,
    extensions: [...target.extensions].sort(),
    extensionVersions: Object.fromEntries(
      Object.entries(target.extensionVersions).sort(([left], [right]) => left.localeCompare(right))
    ),
    extensionPackages: Object.fromEntries(
      [...target.extensions]
        .sort()
        .map(extension => [extension, target.extensionPackages[extension]])
    ),
    extensionInstallPolicy: 'verified-local-wheel-v3',
    extensionLockChecksum: target.extensionLockChecksum,
    pythonChecksum: target.python?.checksum,
    packageChecksum: target.cliPackage?.checksum,
  };
}

function extensionWheelPlatformTag(target: AzureCliTarget): string {
  const runtimeArch = target.cliPackage?.runtimeArch || target.arch;
  if (target.platform === 'darwin') {
    return runtimeArch === 'arm64' ? 'macosx_11_0_arm64' : 'macosx_11_0_x86_64';
  }
  if (target.platform === 'linux') {
    return runtimeArch === 'arm64' ? 'manylinux_2_17_aarch64' : 'manylinux_2_17_x86_64';
  }
  if (target.platform === 'win32' && runtimeArch === 'x64') {
    return 'win_amd64';
  }
  throw new Error(`Unsupported extension wheel target: ${target.platform}/${runtimeArch}`);
}

/** Builds pip arguments that download every locked target dependency wheel. */
export function extensionWheelDownloadArguments(
  target: AzureCliTarget,
  requirementsPath: string,
  wheelhouseDir: string
): string[] {
  if (!target.pythonVersion) {
    throw new Error(`Unsupported cross-extension target: ${target.platform}/${target.arch}`);
  }
  return [
    '-m', 'pip', 'download',
    '--disable-pip-version-check',
    '--dest', wheelhouseDir,
    '--platform', extensionWheelPlatformTag(target),
    '--python-version', target.pythonVersion,
    '--implementation', 'cp',
    '--only-binary=:all:',
    '--require-hashes',
    '--requirement', requirementsPath,
  ];
}

/** Builds pip arguments that resolve dependencies for the packaged macOS runtime. */
export function macOSCrossExtensionInstallArguments(
  target: AzureCliTarget,
  wheelPath: string,
  extensionDir: string,
  wheelhouseDir: string
): string[] {
  if (target.platform !== 'darwin' || target.arch !== 'arm64' || !target.pythonVersion) {
    throw new Error(`Unsupported cross-extension target: ${target.platform}/${target.arch}`);
  }
  return [
    '-m', 'pip', 'install',
    '--disable-pip-version-check',
    '--no-compile',
    '--target', extensionDir,
    '--no-index',
    '--find-links', wheelhouseDir,
    '--platform', 'macosx_11_0_arm64',
    '--python-version', target.pythonVersion,
    '--implementation', 'cp',
    '--only-binary=:all:',
    wheelPath,
  ];
}

/** Builds pip arguments that install an extension with the packaged Windows runtime. */
export function windowsExtensionInstallArguments(
  target: AzureCliTarget,
  wheelPath: string,
  extensionDir: string,
  wheelhouseDir: string
): string[] {
  if (target.platform !== 'win32') {
    throw new Error(`Unsupported Windows extension target: ${target.platform}/${target.arch}`);
  }
  return [
    '-m', 'pip', 'install',
    '--disable-pip-version-check',
    '--no-compile',
    '--target', extensionDir,
    '--no-index',
    '--find-links', wheelhouseDir,
    '--only-binary=:all:',
    wheelPath,
  ];
}

/** Returns a filesystem-safe digest for a fully staged Azure CLI bundle. */
export function azureCliCacheKey(target: AzureCliTarget): string {
  return createHash('sha256')
    .update(JSON.stringify(azureCliCacheIdentity(target)))
    .digest('hex');
}

/** Checks the reported CLI and extension versions against the pinned target. */
export function azureCliVersionDataMatchesTarget(
  target: AzureCliTarget,
  versionData: Record<string, any>
): boolean {
  if (versionData['azure-cli'] !== target.version) return false;
  const installedExtensions = versionData.extensions ?? {};
  return target.extensions.every(
    extension => installedExtensions[extension] === target.extensionVersions[extension]
  );
}

/** Returns configured extensions whose installed version is absent or stale. */
export function azureCliExtensionsToInstall(
  target: AzureCliTarget,
  installedExtensions: Record<string, string> = {}
): string[] {
  return target.extensions.filter(
    extension => installedExtensions[extension] !== target.extensionVersions[extension]
  );
}

/** Returns cached extensions that are not part of the reviewed target configuration. */
export function azureCliExtensionsToRemove(
  target: AzureCliTarget,
  installedExtensions: Record<string, string> = {}
): string[] {
  const configured = new Set(target.extensions);
  return Object.keys(installedExtensions).filter(extension => !configured.has(extension));
}

/** Requires an asynchronously verified build artifact. */
export async function verifyRequiredArtifact(
  verification: Promise<boolean>,
  artifactName: string
): Promise<void> {
  if (!(await verification)) {
    throw new Error(`${artifactName} checksum verification failed`);
  }
}

/** Installs every configured Azure CLI extension through the caller-provided installer. */
export function installRequiredExtensions(
  extensions: string[],
  install: (extension: string) => void
): void {
  for (const extension of extensions) {
    install(extension);
  }
}

const SUPPORTED_ARCHES = new Set(['arm64', 'x64']);
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);

/** Passes ZIP paths as literal data rather than interpolated PowerShell source. */
export function windowsZipExtraction(
  archivePath: string,
  outputDir: string,
  env: NodeJS.ProcessEnv = process.env
) {
  return {
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:AKS_ZIP_ARCHIVE -DestinationPath $env:AKS_ZIP_DESTINATION -Force",
    ],
    env: { ...env, AKS_ZIP_ARCHIVE: archivePath, AKS_ZIP_DESTINATION: outputDir },
  };
}

/** Resolves and validates the platform-specific Azure CLI runtime configuration. */
export function resolveAzureCliTarget(
  rootDir: string,
  platform: string = process.platform,
  arch?: string
): AzureCliTarget {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform for Azure CLI: ${platform}`);
  }

  const targetArch = resolveTargetArch(arch);
  if (!SUPPORTED_ARCHES.has(targetArch)) {
    throw new Error(`Unsupported architecture for Azure CLI: ${targetArch}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const externalTools = packageJson.config?.externalTools ?? {};
  const azureCli = (externalTools.azureCli ?? {}) as AzureCliConfig;
  const version = azureCli.version ?? '';
  if (!version) {
    throw new Error('config.externalTools.azureCli.version must be configured');
  }

  const target: AzureCliTarget = {
    platform,
    arch: targetArch,
    version,
    extensions: azureCli.extensions ?? [],
    extensionVersions: azureCli.extensionVersions ?? {},
    extensionPackages: azureCli.extensionPackages ?? {},
  };
  for (const extension of target.extensions) {
    if (!target.extensionVersions[extension]) {
      throw new Error(`No pinned version configured for Azure CLI extension ${extension}`);
    }
    const extensionPackage = target.extensionPackages[extension];
    if (!extensionPackage?.url || !extensionPackage.checksum) {
      throw new Error(`No verified package configured for Azure CLI extension ${extension}`);
    }
  }

  const python = externalTools.python as PythonConfig | undefined;
  target.pythonVersion = python?.version;
  if (!target.pythonVersion) {
    throw new Error('config.externalTools.python.version must be configured');
  }

  if (platform === 'win32') {
    target.cliPackage = azureCli.win32?.[targetArch];
    if (!target.cliPackage?.url || !target.cliPackage.checksum) {
      throw new Error(
        `No verified Azure CLI package configured for ${platform}/${targetArch}`
      );
    }
  } else {
    const unixPlatform = platform as 'darwin' | 'linux';
    target.python = python?.[unixPlatform]?.[targetArch];
    if (!target.python?.url || !target.python.checksum) {
      throw new Error(`No verified Python runtime configured for ${platform}/${targetArch}`);
    }
    target.cliPackage = azureCli[unixPlatform]?.[targetArch];
    if (!target.cliPackage?.url || !target.cliPackage.checksum) {
      throw new Error(
        `No verified Azure CLI package configured for ${platform}/${targetArch}`
      );
    }
  }

  const runtimeArch = target.cliPackage.runtimeArch || targetArch;
  target.extensionLockPath = path.join(
    rootDir,
    'build',
    `azure-cli-${platform}-${runtimeArch}-requirements.txt`
  );
  if (!fs.existsSync(target.extensionLockPath)) {
    throw new Error(`Azure CLI extension lock not found: ${target.extensionLockPath}`);
  }
  target.extensionLockChecksum = createHash('sha256')
    .update(fs.readFileSync(target.extensionLockPath))
    .digest('hex');
  return target;
}
