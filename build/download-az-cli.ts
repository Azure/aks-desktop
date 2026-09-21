#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Download and install Azure CLI with bundled Python for the current platform
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { execFileSync, execSync } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream } from 'fs';
import {
  canInvokePackagedRuntime,
  invalidInstalledAzureCliExtensions,
  missingInstalledWheelFiles,
} from './azure-cli-verification';
import {
  generateUnixAzWrapperScript,
  UNIX_AZ_CLI_EXTENSIONS_DIRNAME,
  generateWindowsAzWrapperScript,
  WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME,
  WINDOWS_AZ_CLI_ORIGINAL_FILENAME,
} from './az-cli-config';

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);
const { appDir: HEADLAMP_APP_DIR } = require(
  '../packages/headlamp-source/src/lib/paths.ts'
).resolveInstalledHeadlampPaths(ROOT_DIR);
const { copyDirectoryContents } = require(
  '../packages/headlamp-source/src/lib/file-operations.ts'
);
const { parseTargetArgs } = require('./build-target.ts');
const {
  azureCliCacheIdentity,
  azureCliExtensionsToInstall,
  azureCliExtensionsToRemove,
  azureCliVersionDataMatchesTarget,
  installRequiredExtensions,
  macOSCrossExtensionInstallArguments,
  resolveAzureCliTarget,
  verifyRequiredArtifact,
  windowsZipExtraction,
} = require('./azure-cli-config.ts');
const EXTERNAL_TOOLS_DIR = path.join(HEADLAMP_APP_DIR, 'resources', 'external-tools');
const AZ_CLI_DIR = path.join(EXTERNAL_TOOLS_DIR, 'az-cli');
const TEMP_DIR = path.join(os.tmpdir(), `az-cli-download-${process.pid}`);

// Detect current platform
const CURRENT_PLATFORM = process.platform;
if (!['linux', 'darwin', 'win32'].includes(CURRENT_PLATFORM)) {
  console.error(`❌ Unknown platform: ${CURRENT_PLATFORM}`);
  process.exit(1);
}

const args = parseTargetArgs(process.argv.slice(2));
const TARGET_PLATFORM = args.platform || CURRENT_PLATFORM;
if (TARGET_PLATFORM !== CURRENT_PLATFORM) {
  throw new Error(`Cannot stage ${TARGET_PLATFORM} tools from ${CURRENT_PLATFORM}`);
}
const target = resolveAzureCliTarget(ROOT_DIR, TARGET_PLATFORM, args.arch);
const PYTHON_URL = target.python?.url;
const PYTHON_CHECKSUM = target.python?.checksum;
const AZ_CLI_VERSION = target.version;
const AZ_CLI_URL = target.cliPackage?.url;
const AZ_CLI_CHECKSUM = target.cliPackage?.checksum;
const AZ_CLI_EXTENSIONS = target.extensions;
const AZ_CLI_EXTENSION_VERSIONS = target.extensionVersions;
const AZ_CLI_EXTENSION_PACKAGES = target.extensionPackages;
const AZ_CLI_EXTENSION_CACHE_DIR = process.env.AZ_CLI_EXTENSION_CACHE_DIR;

console.log('==========================================');
console.log(`Preparing Azure CLI v${AZ_CLI_VERSION}`);
console.log(`Target: ${target.platform}/${target.arch}`);
if (PYTHON_URL) {
  const pythonFilename = path.basename(PYTHON_URL);
  console.log(`Bundling Python from: ${pythonFilename}`);
}
console.log('==========================================');

const TARGET_DIR = path.join(AZ_CLI_DIR, CURRENT_PLATFORM);
const STAGED_TARGET_PATH = path.join(TARGET_DIR, '.target.json');
const stagedTarget = azureCliCacheIdentity(target);

fs.mkdirSync(TEMP_DIR, { recursive: true });

// Cleanup function
const cleanup = () => {
  console.log('Cleaning up temporary files...');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

// Check if already installed
const azWrapperPath = path.join(TARGET_DIR, 'bin', CURRENT_PLATFORM === 'win32' ? 'az.cmd' : 'az-wrapper');
const pythonPath = CURRENT_PLATFORM === 'win32'
  ? undefined
  : path.join(TARGET_DIR, 'python', 'bin', 'python3');
let existingTarget;
try {
  existingTarget = JSON.parse(fs.readFileSync(STAGED_TARGET_PATH, 'utf8'));
} catch {
  existingTarget = undefined;
}
if (
  fs.existsSync(azWrapperPath) &&
  (pythonPath === undefined || fs.existsSync(pythonPath)) &&
  JSON.stringify(existingTarget) === JSON.stringify(stagedTarget)
) {
  try {
    const runtimeArch = target.cliPackage?.runtimeArch ?? target.arch;
    if (!canInvokePackagedRuntime(target.platform, runtimeArch)) {
      if (target.platform !== 'darwin' || target.arch !== 'arm64' || !pythonPath) {
        throw new Error(`Cannot structurally verify ${target.platform}/${runtimeArch}`);
      }
      verifyDarwinArm64Extensions(
        path.join(TARGET_DIR, UNIX_AZ_CLI_EXTENSIONS_DIRNAME)
      );
      execFileSync('lipo', [pythonPath, '-verify_arch', 'arm64']);
      verifyDarwinArm64Libraries(TARGET_DIR);
      console.log(`✅ Azure CLI cache structurally verified for ${target.platform}/${target.arch}`);
      console.log(`   Location: ${TARGET_DIR}`);
      process.exit(0);
    }

    const versionData = JSON.parse(
      execFileSync(azWrapperPath, ['version', '--output', 'json'], {
        encoding: 'utf8',
        timeout: 120000,
      })
    );
    if (azureCliVersionDataMatchesTarget(target, versionData)) {
      console.log(`✅ Azure CLI cache verified for ${target.platform}/${target.arch}`);
      console.log(`   Location: ${TARGET_DIR}`);
      process.exit(0);
    }
    console.log('Azure CLI cache versions do not match the pinned target; rebuilding.');
  } catch (error) {
    console.log(`Azure CLI cache verification failed; rebuilding: ${error}`);
  }
}
fs.rmSync(TARGET_DIR, { recursive: true, force: true });
fs.mkdirSync(TARGET_DIR, { recursive: true });

/**
 * Download a file from a URL
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`Downloading from ${url}...`);

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = createWriteStream(outputPath);

    const request = client.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          reject(new Error('Redirect without location header'));
          return;
        }
        file.close();
        fs.unlinkSync(outputPath);
        downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      fs.unlinkSync(outputPath);
      reject(err);
    });

    file.on('error', (err) => {
      fs.unlinkSync(outputPath);
      reject(err);
    });
  });
}

/**
 * Calculate SHA256 checksum of a file
 */
async function calculateChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

/**
 * Verify file checksum
 */
async function verifyChecksum(filePath: string, expectedChecksum: string, typeName: string): Promise<boolean> {
  if (!expectedChecksum) {
    console.log(`⚠️  WARNING: No checksum configured for ${typeName}`);
    console.log('   Skipping verification (not recommended for production)');
    return true;
  }

  console.log(`Verifying checksum for ${typeName}...`);

  const actualChecksum = await calculateChecksum(filePath);

  if (actualChecksum === expectedChecksum) {
    console.log(`✅ Checksum verified: ${typeName}`);
    return true;
  } else {
    console.error(`❌ ERROR: Checksum mismatch for ${typeName}`);
    console.error(`   Expected: ${expectedChecksum}`);
    console.error(`   Actual:   ${actualChecksum}`);
    console.error('');
    console.error('   This could indicate:');
    console.error('   - Downloaded file is corrupted');
    console.error('   - File has been tampered with');
    console.error('   - package.json checksums are outdated');
    console.error('');
    console.error('   For security, the installation will not proceed.');
    console.error('   To update checksums, run: sha256sum <file>');
    console.error(`   Then update package.json config.externalTools.*.${CURRENT_PLATFORM}.checksum`);
    return false;
  }
}

/**
 * Extract tar.gz file
 */
function extractTarGz(archivePath: string, outputDir: string): void {
  console.log('Extracting...');
  fs.mkdirSync(outputDir, { recursive: true });
  execSync(`tar -xzf "${archivePath}" -C "${outputDir}"`, { stdio: 'inherit' });
}

/**
 * Extract zip file
 */
function extractZip(archivePath: string, outputDir: string): void {
  console.log('Extracting...');
  fs.mkdirSync(outputDir, { recursive: true });

  if (process.platform === 'win32') {
    try {
      // Use PowerShell's Expand-Archive on Windows - it's more reliable than tar for ZIP files
      const extraction = windowsZipExtraction(archivePath, outputDir);
      execFileSync(extraction.command, extraction.args, { stdio: 'inherit', env: extraction.env });
    } catch (err) {
      console.error('Failed to extract ZIP.');
      throw err;
    }
  } else {
    execSync(`unzip -q "${archivePath}" -d "${outputDir}"`, { stdio: 'inherit' });
  }
}

function targetMarkerMatches(markerPath: string): boolean {
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(markerPath, 'utf8'))) ===
      JSON.stringify(stagedTarget);
  } catch {
    return false;
  }
}

function verifyDarwinArm64Libraries(rootDir: string): void {
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.name.endsWith('.so') || entry.name.endsWith('.dylib')) {
        execFileSync('lipo', [entryPath, '-verify_arch', 'arm64']);
      }
    }
  }
}

function verifyDarwinArm64Extensions(extensionDir: string): void {
  const invalidExtensions = invalidInstalledAzureCliExtensions(
    extensionDir,
    AZ_CLI_EXTENSION_VERSIONS
  );
  if (invalidExtensions.length > 0) {
    throw new Error(
      `Missing or stale Azure CLI extension metadata: ${invalidExtensions.join(', ')}`
    );
  }
  for (const extension of AZ_CLI_EXTENSIONS) {
    const missingFiles = missingInstalledWheelFiles(path.join(extensionDir, extension));
    if (missingFiles.length > 0) {
      throw new Error(
        `Incomplete Azure CLI extension ${extension}: ${missingFiles.slice(0, 5).join(', ')}`
      );
    }
  }
  verifyDarwinArm64Libraries(extensionDir);
}

async function installDarwinArm64Extensions(extensionDir: string): Promise<void> {
  const markerPath = path.join(extensionDir, '.target.json');
  if (targetMarkerMatches(markerPath)) {
    try {
      verifyDarwinArm64Extensions(extensionDir);
      console.log('✅ Reusing verified macOS ARM64 Azure CLI extensions');
      return;
    } catch (error) {
      console.log(`Azure CLI ARM64 extension cache verification failed; rebuilding: ${error}`);
    }
  }

  fs.rmSync(extensionDir, { recursive: true, force: true });
  fs.mkdirSync(extensionDir, { recursive: true });
  const hostPython = process.env.AZ_CLI_EXTENSION_INSTALL_PYTHON || 'python3';
  for (const extension of AZ_CLI_EXTENSIONS) {
    const extensionPackage = AZ_CLI_EXTENSION_PACKAGES[extension];
    const wheelName = path.basename(new URL(extensionPackage.url).pathname);
    const wheelPath = path.join(TEMP_DIR, wheelName);
    const installDir = path.join(extensionDir, extension);
    await downloadFile(extensionPackage.url, wheelPath);
    await verifyRequiredArtifact(
      verifyChecksum(wheelPath, extensionPackage.checksum, `${extension} extension`),
      `${extension} extension`
    );
    execFileSync(
      hostPython,
      macOSCrossExtensionInstallArguments(target, wheelPath, installDir),
      { stdio: 'inherit' }
    );
    const distributionName = extension.replaceAll('-', '_');
    const metadataPath = path.join(
      installDir,
      `${distributionName}-${AZ_CLI_EXTENSION_VERSIONS[extension]}.dist-info`,
      'METADATA'
    );
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Cross-installed extension metadata not found: ${metadataPath}`);
    }
  }
  verifyDarwinArm64Extensions(extensionDir);
  fs.writeFileSync(markerPath, `${JSON.stringify(stagedTarget, null, 2)}\n`);
}

/** Install official Unix Azure CLI and Python archives without pip resolution. */
async function installPrebuiltAzCliWithPython(platform: string): Promise<string[]> {
  if (!PYTHON_URL || !AZ_CLI_URL) {
    throw new Error(`Prebuilt Azure CLI or Python URL not configured for ${platform}/${target.arch}`);
  }

  const pythonArchive = path.join(TEMP_DIR, `python-${platform}.tar.gz`);
  const cliArchive = path.join(TEMP_DIR, `azure-cli-${platform}.tar.gz`);
  await Promise.all([
    downloadFile(PYTHON_URL, pythonArchive),
    downloadFile(AZ_CLI_URL, cliArchive),
  ]);
  await Promise.all([
    verifyRequiredArtifact(verifyChecksum(pythonArchive, PYTHON_CHECKSUM, 'Python'), 'Python'),
    verifyRequiredArtifact(
      verifyChecksum(cliArchive, AZ_CLI_CHECKSUM, `Azure CLI ${AZ_CLI_VERSION}`),
      `Azure CLI ${AZ_CLI_VERSION}`
    ),
  ]);

  const pythonExtractDir = path.join(TEMP_DIR, `python-${platform}`);
  extractTarGz(pythonArchive, pythonExtractDir);
  extractTarGz(cliArchive, TARGET_DIR);
  const pythonRoot = path.join(pythonExtractDir, 'python');
  if (!fs.existsSync(path.join(pythonRoot, 'bin', 'python3'))) {
    throw new Error('Python extraction failed - executable not found');
  }
  copyDirectoryContents(pythonRoot, path.join(TARGET_DIR, 'python'), true);

  const targetExtensionDir = path.join(TARGET_DIR, UNIX_AZ_CLI_EXTENSIONS_DIRNAME);
  const extensionDir = AZ_CLI_EXTENSION_CACHE_DIR
    ? path.resolve(AZ_CLI_EXTENSION_CACHE_DIR)
    : targetExtensionDir;
  fs.mkdirSync(extensionDir, { recursive: true });
  const stockAz = path.join(TARGET_DIR, 'bin', 'az');
  const bundledPython = path.join(TARGET_DIR, 'python', 'bin', 'python3');
  const extensionEnvironment = {
    ...process.env,
    AZ_PYTHON: bundledPython,
    AZURE_EXTENSION_DIR: extensionDir,
  };
  if (platform === 'darwin' && target.arch === 'arm64' && process.arch !== 'arm64') {
    execFileSync('lipo', [bundledPython, '-verify_arch', 'arm64']);
    await installDarwinArm64Extensions(extensionDir);
  } else {
    let versionData: Record<string, any> = { extensions: {} };
    try {
      versionData = JSON.parse(
        execFileSync(stockAz, ['version', '--output', 'json'], {
          encoding: 'utf8',
          env: extensionEnvironment,
        })
      );
    } catch (error) {
      console.log(`Azure CLI extension cache verification failed; rebuilding: ${error}`);
      fs.rmSync(extensionDir, { recursive: true, force: true });
      fs.mkdirSync(extensionDir, { recursive: true });
    }
    const extensionsToInstall = azureCliExtensionsToInstall(target, versionData.extensions);
    for (const extension of azureCliExtensionsToRemove(target, versionData.extensions)) {
      execFileSync(stockAz, ['extension', 'remove', '-n', extension], {
        stdio: 'inherit',
        env: extensionEnvironment,
      });
    }
    installRequiredExtensions(extensionsToInstall, (extension: string) => {
      if (versionData.extensions?.[extension]) {
        execFileSync(stockAz, ['extension', 'remove', '-n', extension], {
          stdio: 'inherit',
          env: extensionEnvironment,
        });
      }
      execFileSync(stockAz, [
        'extension', 'add', '-n', extension,
        '--version', AZ_CLI_EXTENSION_VERSIONS[extension],
        '--yes', '--allow-preview', 'true',
      ], {
        stdio: 'inherit',
        env: extensionEnvironment,
      });
    });
    const finalVersionData = JSON.parse(
      execFileSync(stockAz, ['version', '--output', 'json'], {
        encoding: 'utf8',
        env: extensionEnvironment,
      })
    );
    if (!azureCliVersionDataMatchesTarget(target, finalVersionData)) {
      throw new Error('Azure CLI or extension versions do not match the pinned target');
    }
  }
  if (extensionDir !== targetExtensionDir) {
    fs.rmSync(targetExtensionDir, { recursive: true, force: true });
    copyDirectoryContents(extensionDir, targetExtensionDir, true);
  }

  const binDir = path.join(TARGET_DIR, 'bin');
  const azWrapper = path.join(binDir, 'az-wrapper');
  fs.writeFileSync(azWrapper, generateUnixAzWrapperScript(), { mode: 0o755 });
  fs.rmSync(stockAz, { force: true });
  fs.symlinkSync('az-wrapper', stockAz);
  console.log(`✅ Prebuilt Azure CLI installed for ${platform}`);
  return [...AZ_CLI_EXTENSIONS];
}

/**
 * Install Azure CLI for Windows
 */
async function installAzCliWindows(): Promise<string[]> {
  console.log('📦 Downloading Windows Azure CLI (ZIP)...');
  if (!AZ_CLI_URL) {
    throw new Error(`Azure CLI URL not configured for win32/${target.arch}`);
  }
  const winZip = path.join(TEMP_DIR, `azure-cli-${AZ_CLI_VERSION}-x64.zip`);

  try {
    await downloadFile(AZ_CLI_URL, winZip);
  } catch (error) {
    console.error('❌ ERROR: Could not download Windows Azure CLI');
    throw error;
  }

  await verifyRequiredArtifact(
    verifyChecksum(winZip, AZ_CLI_CHECKSUM, `Azure CLI ${AZ_CLI_VERSION}`),
    `Azure CLI ${AZ_CLI_VERSION}`
  );

  extractZip(winZip, TARGET_DIR);

  // The zip's stock bin/az.cmd never sets AZURE_EXTENSION_DIR, so it would
  // load whatever a user (or an older version of this app) previously
  // installed under %USERPROFILE%\.azure\cliextensions - including a stale
  // aks-preview that shadows core commands this bundled version added.
  // Rename the stock script and put our own wrapper at bin/az.cmd so
  // azCliBinaryPath() keeps resolving to the same path.
  const binDir = path.join(TARGET_DIR, 'bin');
  const stockAzCmd = path.join(binDir, 'az.cmd');
  const originalAzCmd = path.join(binDir, WINDOWS_AZ_CLI_ORIGINAL_FILENAME);
  if (!fs.existsSync(stockAzCmd)) {
    throw new Error(
      `Expected ${stockAzCmd} from the extracted Windows Azure CLI zip, but it was not found`
    );
  }
  fs.renameSync(stockAzCmd, originalAzCmd);
  fs.writeFileSync(stockAzCmd, generateWindowsAzWrapperScript());
  const targetExtensionDir = path.join(TARGET_DIR, WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME);
  const extensionDir = AZ_CLI_EXTENSION_CACHE_DIR
    ? path.resolve(AZ_CLI_EXTENSION_CACHE_DIR)
    : targetExtensionDir;
  fs.mkdirSync(extensionDir, { recursive: true });

  console.log('✅ Windows Azure CLI ready');

  // Install the configured extensions into the same app-owned directory the
  // wrapper points AZURE_EXTENSION_DIR at, using the CLI's own bundled
  // python.exe (extracted at the top level of TARGET_DIR by the zip). A
  // Failed installs abort before the staged target marker is written, so an
  // incomplete bundle cannot pass as staged.
  const installedExtensions: string[] = [];
  if (AZ_CLI_EXTENSIONS && AZ_CLI_EXTENSIONS.length > 0) {
    const winPython = path.join(TARGET_DIR, 'python.exe');
    const extensionEnvironment = {
      ...process.env,
      AZURE_EXTENSION_DIR: extensionDir,
    };
    let versionData: Record<string, any> = { extensions: {} };
    try {
      versionData = JSON.parse(
        execFileSync(winPython, ['-m', 'azure.cli', 'version', '--output', 'json'], {
          encoding: 'utf8',
          env: extensionEnvironment,
        })
      );
    } catch (error) {
      console.log(`Azure CLI extension cache verification failed; rebuilding: ${error}`);
      fs.rmSync(extensionDir, { recursive: true, force: true });
      fs.mkdirSync(extensionDir, { recursive: true });
    }
    const extensionsToInstall = azureCliExtensionsToInstall(target, versionData.extensions);
    for (const extension of azureCliExtensionsToRemove(target, versionData.extensions)) {
      execFileSync(winPython, ['-m', 'azure.cli', 'extension', 'remove', '-n', extension], {
        stdio: 'inherit',
        env: extensionEnvironment,
      });
    }
    console.log(`Installing Azure CLI extensions: ${AZ_CLI_EXTENSIONS.join(', ')}`);
    for (const extension of extensionsToInstall) {
      console.log(`  → Installing extension: ${extension}`);
      try {
        if (versionData.extensions?.[extension]) {
          execFileSync(winPython, ['-m', 'azure.cli', 'extension', 'remove', '-n', extension], {
            stdio: 'inherit',
            env: extensionEnvironment,
          });
        }
        execFileSync(winPython, [
          '-m', 'azure.cli', 'extension', 'add', '-n', extension,
          '--version', AZ_CLI_EXTENSION_VERSIONS[extension],
          '--yes', '--allow-preview', 'true',
        ], {
          stdio: 'inherit',
          env: extensionEnvironment,
        });
      } catch (error) {
        console.error(`  ❌ ERROR: Failed to install extension ${extension}`);
        console.error(`     Error: ${error}`);
        throw error;
      }
      installedExtensions.push(extension);
    }
    const finalVersionData = JSON.parse(
      execFileSync(winPython, ['-m', 'azure.cli', 'version', '--output', 'json'], {
        encoding: 'utf8',
        env: extensionEnvironment,
      })
    );
    if (!azureCliVersionDataMatchesTarget(target, finalVersionData)) {
      throw new Error('Azure CLI or extension versions do not match the pinned target');
    }
    if (extensionDir !== targetExtensionDir) {
      fs.rmSync(targetExtensionDir, { recursive: true, force: true });
      copyDirectoryContents(extensionDir, targetExtensionDir, true);
    }
    console.log('✅ Extensions installation complete');
  }

  return AZ_CLI_EXTENSION_CACHE_DIR ? [...AZ_CLI_EXTENSIONS] : installedExtensions;
}

/**
 * Main installation flow
 */
async function main() {
  try {
    let installedExtensions: string[] = [];
    switch (CURRENT_PLATFORM) {
      case 'win32':
        installedExtensions = await installAzCliWindows();
        break;
      case 'darwin':
        console.log('🍎 Installing prebuilt macOS Azure CLI with bundled Python...');
        installedExtensions = await installPrebuiltAzCliWithPython('darwin');
        break;
      case 'linux':
        console.log('🐧 Installing prebuilt Linux Azure CLI with bundled Python...');
        installedExtensions = await installPrebuiltAzCliWithPython('linux');
        break;
    }

    fs.writeFileSync(STAGED_TARGET_PATH, `${JSON.stringify(stagedTarget, null, 2)}\n`);

    // Create platform-specific README
    const readmePath = path.join(TARGET_DIR, 'README.md');
    // todo: fix this on windows
    // const dirSize = execSync(`du -sh "${TARGET_DIR}" 2>/dev/null | cut -f1`, { encoding: 'utf-8' }).trim();
    const dirSize = 0;

    fs.writeFileSync(readmePath, `# Azure CLI for ${CURRENT_PLATFORM}

This directory contains the Azure CLI bundled with AKS desktop for ${CURRENT_PLATFORM}.

## Version

- Azure CLI version: ${AZ_CLI_VERSION}

## Platform

Current platform: **${CURRENT_PLATFORM}**

## Size

${dirSize}

## Usage

AKS desktop automatically uses this bundled Azure CLI with embedded Python.
**No system dependencies required!**

## Update

To update the bundled Azure CLI:
\`\`\`bash
rm -rf ${TARGET_DIR}
npm run build
\`\`\`
`);

    console.log('');
    console.log('==========================================');
    console.log('✅ Installation Complete');
    console.log('==========================================');
    console.log('');
    console.log(`Platform: ${CURRENT_PLATFORM}`);
    console.log(`Location: ${TARGET_DIR}`);
    console.log(`Size: ${dirSize}`);
    console.log('');
    console.log('✅ Fully standalone - No Python installation required!');
    console.log('');
  } catch (error) {
    console.error('❌ Installation failed:', error);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
