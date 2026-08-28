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
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream } from 'fs';
import {
  azCliBinaryPath,
  azCliTargetDir,
  azCliTargetDirHasContent,
  expectedAzCliExtensions,
  generateWindowsAzWrapperScript,
  isAzCliStagedForTarget,
  readStagedAzCli,
  resolveAzCliVersion,
  WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME,
  WINDOWS_AZ_CLI_ORIGINAL_FILENAME,
  writeStagedAzCli,
} from './az-cli-config';

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);
const { appDir: HEADLAMP_APP_DIR } = require(
  '../packages/headlamp-source/scripts/paths.ts'
).resolveInstalledHeadlampPaths(ROOT_DIR);
const { copyDirectoryContents, removePathPattern } = require(
  '../packages/headlamp-source/scripts/file-operations.ts'
);
const EXTERNAL_TOOLS_DIR = path.join(HEADLAMP_APP_DIR, 'resources', 'external-tools');
const AZ_CLI_DIR = path.join(EXTERNAL_TOOLS_DIR, 'az-cli');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const TEMP_DIR = path.join(os.tmpdir(), `az-cli-download-${process.pid}`);

interface PlatformConfig {
  url?: string;
  checksum?: string;
  version?: string;
}

interface ToolConfig {
  version?: string;
  extensions?: string[];
  linux?: PlatformConfig;
  darwin?: PlatformConfig;
  win32?: PlatformConfig;
}

interface ExternalToolsConfig {
  python?: ToolConfig;
  azureCli?: ToolConfig;
}

interface Config {
  externalTools: ExternalToolsConfig;
}

// Detect current platform
const CURRENT_PLATFORM = process.platform;
if (!['linux', 'darwin', 'win32'].includes(CURRENT_PLATFORM)) {
  console.error(`❌ Unknown platform: ${CURRENT_PLATFORM}`);
  process.exit(1);
}

// Read configuration from package.json
let config: Config;
try {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  config = packageJson.config as Config;
} catch (error) {
  console.error(`❌ ERROR: Failed to read package.json at ${PACKAGE_JSON_PATH}`);
  console.error(error);
  process.exit(1);
}

const pythonConfig = config.externalTools.python?.[CURRENT_PLATFORM as keyof ToolConfig] as PlatformConfig;
const azureCliConfig = config.externalTools.azureCli;
const azureCliPlatformConfig = azureCliConfig?.[CURRENT_PLATFORM as keyof ToolConfig] as PlatformConfig;

const PYTHON_URL = pythonConfig?.url;
const PYTHON_CHECKSUM = pythonConfig?.checksum;
const AZ_CLI_VERSION = resolveAzCliVersion(azureCliConfig, CURRENT_PLATFORM);
const AZ_CLI_CHECKSUM = azureCliPlatformConfig?.checksum;
// The configured extension set, installed identically on every platform -
// including win32, via installAzCliWindows() below.
const AZ_CLI_EXTENSIONS = expectedAzCliExtensions(azureCliConfig, CURRENT_PLATFORM);

console.log('==========================================');
console.log(`Downloading Azure CLI v${AZ_CLI_VERSION}`);
console.log(`Platform: ${CURRENT_PLATFORM}`);
if (PYTHON_URL) {
  const pythonFilename = path.basename(PYTHON_URL);
  console.log(`Bundling Python from: ${pythonFilename}`);
}
console.log('==========================================');

const TARGET_DIR = azCliTargetDir(ROOT_DIR, CURRENT_PLATFORM);

// Create directory structure
fs.mkdirSync(TARGET_DIR, { recursive: true });
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

// Check if already installed. A directory that exists but has no wrapper
// binary (e.g. an install interrupted before that final step) is still
// treated as an existing install - not an empty target - because it may
// already carry stale extensions (cliextensions/aks-preview) that must be
// wiped rather than silently overlaid by the fresh install below.
const azWrapperPath = azCliBinaryPath(ROOT_DIR, CURRENT_PLATFORM);
if (azCliTargetDirHasContent(ROOT_DIR, CURRENT_PLATFORM)) {
  const staged = readStagedAzCli(ROOT_DIR, CURRENT_PLATFORM);
  const isCurrent = isAzCliStagedForTarget(ROOT_DIR, CURRENT_PLATFORM, AZ_CLI_VERSION, AZ_CLI_EXTENSIONS);

  if (isCurrent) {
    console.log(`✅ Azure CLI already installed for ${CURRENT_PLATFORM}`);
    console.log(`   Location: ${TARGET_DIR}`);
    console.log('');
    console.log('To force re-download, remove the directory first:');
    console.log(`   rm -rf ${TARGET_DIR}`);
    process.exit(0);
  }

  // Either the staged install predates the current pin (or has no marker at
  // all, meaning it predates this check) and may still bundle an extension
  // set - such as aks-preview - that the current config no longer wants, or
  // it never reached the wrapper-script step and is simply incomplete. In
  // both cases it may still carry stale extensions, so wipe it and fall
  // through to a fresh download instead of overlaying onto it.
  const reason = fs.existsSync(azWrapperPath)
    ? `out of date (found ${staged?.version ?? 'unmarked install'}, expected ${AZ_CLI_VERSION})`
    : 'incomplete (missing az wrapper binary from a prior install)';
  console.log(`⚠️  Staged Azure CLI for ${CURRENT_PLATFORM} is ${reason}. Removing and re-downloading...`);
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

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
      execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${outputDir}' -Force"`, { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to extract ZIP.');
      throw err;
    }
  } else {
    execSync(`unzip -q "${archivePath}" -d "${outputDir}"`, { stdio: 'inherit' });
  }
}

/**
 * Install Azure CLI with Python (bundled for Linux and macOS)
 */
async function installAzCliWithPython(platform: string): Promise<string[]> {
  let pythonBin: string;

  // Download and use bundled Python for both Linux and macOS
  if (!PYTHON_URL) {
    console.error(`❌ ERROR: No Python URL configured for platform: ${platform}`);
    console.error(`   Please add python.${platform}.url to package.json config.externalTools`);
    throw new Error('Python URL not configured');
  }

  const pythonArchive = path.join(TEMP_DIR, `python-${platform}.tar.gz`);

  // Download Python
  try {
    await downloadFile(PYTHON_URL, pythonArchive);
  } catch (error) {
    console.error('❌ ERROR: Failed to download Python');
    throw error;
  }

  // Verify checksum
  if (PYTHON_CHECKSUM) {
    const verified = await verifyChecksum(pythonArchive, PYTHON_CHECKSUM, 'Python');
    if (!verified) {
      throw new Error('Python checksum verification failed');
    }
  }

  // Extract Python
  const pythonExtractDir = path.join(TEMP_DIR, `python-${platform}`);
  extractTarGz(pythonArchive, pythonExtractDir);

  // Find the python directory (it's nested in python/install/)
  const pythonRoot = path.join(pythonExtractDir, 'python');
  if (!fs.existsSync(pythonRoot)) {
    throw new Error('Python extraction failed - directory not found');
  }

  console.log('Installing Azure CLI using bundled Python...');
  pythonBin = path.join(pythonRoot, 'bin', 'python3');

  // Create a virtual environment
  const venvDir = path.join(TEMP_DIR, `venv-${platform}`);
  execSync(`"${pythonBin}" -m venv "${venvDir}"`, { stdio: 'inherit' });

  // Install Azure CLI in the venv
  const venvPython = path.join(venvDir, 'bin', 'python');
  const venvPip = path.join(venvDir, 'bin', 'pip');

  console.log('Upgrading pip...');
  execSync(`"${venvPip}" install --upgrade pip setuptools wheel`, { stdio: 'inherit' });

  console.log('Installing Azure CLI packages...');
  execSync(`"${venvPip}" install azure-cli==${AZ_CLI_VERSION}`, { stdio: 'inherit' });

  // Install Azure CLI extensions. A failed install must abort the build
  // rather than be swallowed: writeStagedAzCli() only runs once main()'s
  // switch on CURRENT_PLATFORM returns successfully, so throwing here means
  // no marker is written and the incomplete bundle can't pass as staged.
  const installedExtensions: string[] = [];
  if (AZ_CLI_EXTENSIONS && AZ_CLI_EXTENSIONS.length > 0) {
    console.log(`Installing Azure CLI extensions: ${AZ_CLI_EXTENSIONS.join(', ')}`);
    for (const extension of AZ_CLI_EXTENSIONS) {
      console.log(`  → Installing extension: ${extension}`);
      try {
        execSync(`"${venvPython}" -m azure.cli extension add -n ${extension}`, {
          stdio: 'inherit',
          env: {
            ...process.env,
            AZURE_EXTENSION_DIR: path.join(venvDir, 'extensions')
          }
        });
      } catch (error) {
        console.error(`  ❌ ERROR: Failed to install extension ${extension}`);
        console.error(`     Error: ${error}`);
        throw error;
      }
      installedExtensions.push(extension);
    }
    console.log('✅ Extensions installation complete');
  }

  // Copy Python and Azure CLI to target
  console.log(`Copying bundled Python and Azure CLI to ${TARGET_DIR}...`);
  copyDirectoryContents(pythonRoot, TARGET_DIR);

  // Copy Azure CLI packages from venv to bundled Python's site-packages
  const pythonVersion = execSync(`"${pythonBin}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"`, { encoding: 'utf-8' }).trim();
  const venvSitePackages = path.join(venvDir, 'lib', `python${pythonVersion}`, 'site-packages');
  const targetSitePackages = path.join(TARGET_DIR, 'lib', `python${pythonVersion}`, 'site-packages');

  if (fs.existsSync(venvSitePackages)) {
    console.log('Copying Azure CLI packages...');
    copyDirectoryContents(venvSitePackages, targetSitePackages);
  }

  // Copy Azure CLI extensions
  const venvExtensionsDir = path.join(venvDir, 'extensions');
  const targetExtensionsDir = path.join(TARGET_DIR, 'cliextensions');
  if (fs.existsSync(venvExtensionsDir)) {
    console.log('Copying Azure CLI extensions...');
    copyDirectoryContents(venvExtensionsDir, targetExtensionsDir);
  }

  // Create wrapper script
  const binDir = path.join(TARGET_DIR, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const azWrapper = path.join(binDir, 'az-wrapper');

  // Both Linux and macOS: Use bundled Python
  fs.writeFileSync(azWrapper, `#!/bin/bash
# Azure CLI wrapper - uses bundled Python

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"

# Set AZ_INSTALLER environment variable
export AZ_INSTALLER="BUNDLED"

# Use bundled extensions directory
export AZURE_EXTENSION_DIR="$CLI_DIR/cliextensions"

# Run Python with the azure.cli module using the bundled Python
exec "$SCRIPT_DIR/python3" -m azure.cli "$@"
`, { mode: 0o755 });

  // Create 'az' symlink
  const azSymlink = path.join(binDir, 'az');
  if (fs.existsSync(azSymlink)) {
    fs.unlinkSync(azSymlink);
  }
  fs.symlinkSync('az-wrapper', azSymlink);

  // Cleanup to reduce size
  console.log('Optimizing bundle size...');

  // Remove pip, setuptools, and wheel (not needed after installation)
  const cleanupDirs = [
    path.join(targetSitePackages, 'pip'),
    path.join(targetSitePackages, 'pip-*'),
    path.join(targetSitePackages, 'setuptools'),
    path.join(targetSitePackages, 'setuptools-*'),
    path.join(targetSitePackages, 'wheel'),
    path.join(targetSitePackages, 'wheel-*'),
    // Remove .dist-info directories for removed packages
    path.join(targetSitePackages, 'pip*.dist-info'),
    path.join(targetSitePackages, 'setuptools*.dist-info'),
    path.join(targetSitePackages, 'wheel*.dist-info'),
  ];

  for (const dir of cleanupDirs) {
    try {
      removePathPattern(dir);
    } catch (error) {
      // Ignore errors - directory might not exist
    }
  }

  // Remove __pycache__ directories and .pyc files in test directories
  try {
    execSync(`find "${targetSitePackages}" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`find "${targetSitePackages}" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true`, { stdio: 'pipe' });
  } catch (error) {
    // Ignore errors
  }

  // Remove unnecessary Python standard library components
  const stdlibCleanup = [
    path.join(TARGET_DIR, 'lib', `python${pythonVersion}`, 'idlelib'),  // IDLE IDE
    path.join(TARGET_DIR, 'lib', `python${pythonVersion}`, 'lib2to3'),  // Python 2 to 3 converter
    path.join(TARGET_DIR, 'lib', `python${pythonVersion}`, 'tkinter'),  // GUI toolkit
    path.join(TARGET_DIR, 'lib', `python${pythonVersion}`, 'ensurepip'), // pip installer
    path.join(TARGET_DIR, 'lib', `python${pythonVersion}`, 'distutils'), // Deprecated
    path.join(TARGET_DIR, 'lib', 'tcl8*'),
    path.join(TARGET_DIR, 'lib', 'tk8*'),
    path.join(TARGET_DIR, 'lib', 'Tix*'),
    path.join(TARGET_DIR, 'lib', 'itcl*'),
    path.join(TARGET_DIR, 'lib', 'thread*'),
  ];

  for (const dir of stdlibCleanup) {
    try {
      removePathPattern(dir);
    } catch (error) {
      // Ignore errors
    }
  }

  console.log(`✅ Azure CLI installed for ${platform}`);

  return installedExtensions;
}

/**
 * Install Azure CLI for Windows
 */
async function installAzCliWindows(): Promise<string[]> {
  console.log('📦 Downloading Windows Azure CLI (ZIP)...');
  const winUrl = `https://azcliprod.blob.core.windows.net/zip/azure-cli-${AZ_CLI_VERSION}-x64.zip`;
  const winZip = path.join(TEMP_DIR, `azure-cli-${AZ_CLI_VERSION}-x64.zip`);

  try {
    await downloadFile(winUrl, winZip);
  } catch (error) {
    console.error('❌ ERROR: Could not download Windows Azure CLI');
    throw error;
  }

  // Enforce the pinned checksum, as the Python archive path does. verifyChecksum()
  // reports a mismatch by returning false rather than throwing, so the result has to
  // be inspected — a try/catch around it can never fire, which previously let a
  // corrupted or substituted archive be bundled after printing a message saying the
  // installation would not proceed.
  if (AZ_CLI_CHECKSUM) {
    const verified = await verifyChecksum(winZip, AZ_CLI_CHECKSUM, `Azure CLI ${AZ_CLI_VERSION}`);
    if (!verified) {
      throw new Error(`Azure CLI ${AZ_CLI_VERSION} checksum verification failed`);
    }
  }

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
  const extensionDir = path.join(TARGET_DIR, WINDOWS_AZ_CLI_EXTENSIONS_DIRNAME);
  fs.mkdirSync(extensionDir, { recursive: true });

  console.log('✅ Windows Azure CLI ready');

  // Install the configured extensions into the same app-owned directory the
  // wrapper points AZURE_EXTENSION_DIR at, using the CLI's own bundled
  // python.exe (extracted at the top level of TARGET_DIR by the zip). A
  // failed install must abort the build rather than be swallowed, matching
  // installAzCliWithPython: writeStagedAzCli() only runs once main()'s
  // switch on CURRENT_PLATFORM returns successfully, so throwing here means
  // no marker is written and the incomplete bundle can't pass as staged.
  const installedExtensions: string[] = [];
  if (AZ_CLI_EXTENSIONS && AZ_CLI_EXTENSIONS.length > 0) {
    const winPython = path.join(TARGET_DIR, 'python.exe');
    console.log(`Installing Azure CLI extensions: ${AZ_CLI_EXTENSIONS.join(', ')}`);
    for (const extension of AZ_CLI_EXTENSIONS) {
      console.log(`  → Installing extension: ${extension}`);
      try {
        execSync(`"${winPython}" -m azure.cli extension add -n ${extension}`, {
          stdio: 'inherit',
          env: {
            ...process.env,
            AZURE_EXTENSION_DIR: extensionDir,
          },
        });
      } catch (error) {
        console.error(`  ❌ ERROR: Failed to install extension ${extension}`);
        console.error(`     Error: ${error}`);
        throw error;
      }
      installedExtensions.push(extension);
    }
    console.log('✅ Extensions installation complete');
  }

  return installedExtensions;
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
        console.log('🍎 Installing macOS Azure CLI with bundled Python...');
        installedExtensions = await installAzCliWithPython('darwin');
        break;
      case 'linux':
        console.log('🐧 Installing Linux Azure CLI with bundled Python...');
        installedExtensions = await installAzCliWithPython('linux');
        break;
    }

    // Record what actually got installed, not what was requested - an
    // extension whose install fails now aborts before reaching here (see
    // installAzCliWithPython), but deriving the marker from the real result
    // keeps it accurate independent of that invariant.
    writeStagedAzCli(ROOT_DIR, CURRENT_PLATFORM, { version: AZ_CLI_VERSION, extensions: installedExtensions });

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
