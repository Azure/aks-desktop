#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Post-build verification test for bundled external tools
 * Verifies that Azure CLI and Python (when needed) are bundled correctly
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';
import {
  aksMcpBinaryName,
  isSupportedAksMcpArch,
  matchesChecksum,
  readStagedTarget,
  resolveAksMcpTarget,
  resolveTargetArch,
} from './aks-mcp-config';
import {
  getExtensionTimeoutResult,
  readRequiredAzureCliExtensions,
} from './azure-cli-verification';
import {
  readStagedAzureCliTarget,
  resolveAzureCliTarget,
} from './az-cli-config';

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);
const CURRENT_PLATFORM = process.platform;
const STAGED_TARGET = readStagedTarget(ROOT_DIR);
const TARGET_ARCH = STAGED_TARGET?.arch ?? resolveTargetArch();
const AZURE_CLI_TARGET = resolveAzureCliTarget(ROOT_DIR, CURRENT_PLATFORM, TARGET_ARCH);

// Read product name from headlamp app package.json
const HEADLAMP_PACKAGE_JSON = path.join(ROOT_DIR, 'headlamp', 'app', 'package.json');
let PRODUCT_NAME = 'AKS desktop'; // Default fallback

try {
  const packageJson = JSON.parse(fs.readFileSync(HEADLAMP_PACKAGE_JSON, 'utf-8'));
  PRODUCT_NAME = packageJson.productName || PRODUCT_NAME;
} catch (error) {
  console.warn(`Warning: Could not read product name from ${HEADLAMP_PACKAGE_JSON}, using default: ${PRODUCT_NAME}`);
}

// Determine the correct build output directory based on platform. Packaging a
// non-host architecture puts the output in an arch-suffixed directory, so the
// staged target decides which one to inspect.
const DIST_DIR = path.join(ROOT_DIR, 'headlamp', 'app', 'dist');

function findPlatformDir(candidates: string[], fallback: string): string {
  return candidates.find(dir => fs.existsSync(path.join(DIST_DIR, dir))) ?? fallback;
}

let PLATFORM_DIR: string = '';

if (CURRENT_PLATFORM === 'win32') {
  PLATFORM_DIR = findPlatformDir([`win-${TARGET_ARCH}-unpacked`, 'win-unpacked'], 'win-unpacked');
} else if (CURRENT_PLATFORM === 'darwin') {
  PLATFORM_DIR = findPlatformDir([`mac-${TARGET_ARCH}`, 'mac'], 'mac');
} else {
  PLATFORM_DIR = findPlatformDir(
    [`linux-${TARGET_ARCH}-unpacked`, 'linux-unpacked'],
    'linux-unpacked'
  );
}

const BUILD_DIST_DIR = path.join(DIST_DIR, PLATFORM_DIR);

// On macOS, the app is bundled in a .app directory structure
let EXTERNAL_TOOLS_DIR: string;
if (CURRENT_PLATFORM === 'darwin') {
  EXTERNAL_TOOLS_DIR = path.join(BUILD_DIST_DIR, `${PRODUCT_NAME}.app`, 'Contents', 'Resources', 'external-tools');
} else {
  EXTERNAL_TOOLS_DIR = path.join(BUILD_DIST_DIR, 'resources', 'external-tools');
}

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

/**
 * Color output helpers
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color?: keyof typeof colors) {
  if (color && colors[color]) {
    console.log(`${colors[color]}${message}${colors.reset}`);
  } else {
    console.log(message);
  }
}

function logSuccess(message: string) {
  log(`✅ ${message}`, 'green');
}

function logError(message: string) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, 'cyan');
}

function logWarning(message: string) {
  log(`⚠️  ${message}`, 'yellow');
}

/**
 * Add test result
 */
function addResult(name: string, passed: boolean, message: string) {
  results.push({ name, passed, message });
  if (passed) {
    logSuccess(`${name}: ${message}`);
  } else {
    logError(`${name}: ${message}`);
  }
}

/**
 * Test: Verify external-tools directory exists
 */
function testExternalToolsDir(): void {
  const exists = fs.existsSync(EXTERNAL_TOOLS_DIR);
  addResult(
    'External tools directory',
    exists,
    exists
      ? `Found at ${EXTERNAL_TOOLS_DIR}`
      : `Not found at ${EXTERNAL_TOOLS_DIR}`
  );
}

/**
 * Test: Verify Azure CLI directory structure
 */
function testAzureCliStructure(): void {
  const azCliDir = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', CURRENT_PLATFORM);
  const exists = fs.existsSync(azCliDir);

  if (!exists) {
    addResult(
      'Azure CLI directory',
      false,
      `Platform-specific directory not found at ${azCliDir}`
    );
    return;
  }

  addResult(
    'Azure CLI directory',
    true,
    `Found at ${azCliDir}`
  );

  // Check for bin directory
  const binDir = path.join(azCliDir, 'bin');
  const binExists = fs.existsSync(binDir);
  addResult(
    'Azure CLI bin directory',
    binExists,
    binExists ? `Found at ${binDir}` : `Not found at ${binDir}`
  );
}

/** Test: verify setup staged the CLI requested by this package target. */
function testAzureCliTarget(): void {
  const staged = readStagedAzureCliTarget(ROOT_DIR);
  const matches =
    staged?.platform === AZURE_CLI_TARGET.platform &&
    staged.arch === AZURE_CLI_TARGET.arch &&
    staged.bundleArch === AZURE_CLI_TARGET.bundleArch &&
    staged.fingerprint === AZURE_CLI_TARGET.fingerprint;
  addResult(
    'Azure CLI target',
    matches,
    matches
      ? `Staged for ${staged.platform}/${staged.arch} (bundle ${staged.bundleArch})`
      : `Target marker does not match ${CURRENT_PLATFORM}/${TARGET_ARCH}`
  );
}

/**
 * Test: Verify Azure CLI executable exists and is executable
 */
function testAzureCliExecutable(): void {
  const azCliDir = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', CURRENT_PLATFORM);
  const binDir = path.join(azCliDir, 'bin');

  let azExecutable: string;
  if (CURRENT_PLATFORM === 'win32') {
    azExecutable = path.join(binDir, 'az.cmd');
  } else {
    azExecutable = path.join(binDir, 'az');
  }

  const exists = fs.existsSync(azExecutable);
  if (!exists) {
    addResult(
      'Azure CLI executable',
      false,
      `Not found at ${azExecutable}`
    );
    return;
  }

  addResult(
    'Azure CLI executable',
    true,
    `Found at ${azExecutable}`
  );

  // Check if executable on Unix systems
  if (CURRENT_PLATFORM !== 'win32') {
    try {
      const stats = fs.statSync(azExecutable);
      const isExecutable = !!(stats.mode & fs.constants.S_IXUSR);
      addResult(
        'Azure CLI executable permissions',
        isExecutable,
        isExecutable
          ? 'Executable flag is set'
          : 'Executable flag is NOT set'
      );
    } catch (error) {
      addResult(
        'Azure CLI executable permissions',
        false,
        `Failed to check permissions: ${error}`
      );
    }
  }

}

/**
 * Test: Verify Python is bundled (for Linux/macOS)
 */
function testPythonBundled(): void {
  // Python is only bundled on Linux/macOS
  if (CURRENT_PLATFORM === 'win32') {
    logInfo('Skipping Python test on Windows (not bundled separately)');
    return;
  }

  const azCliDir = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', CURRENT_PLATFORM);
  const binDir = path.join(azCliDir, 'bin');
  const pythonExecutable = path.join(binDir, 'python3');

  const exists = fs.existsSync(pythonExecutable);
  if (!exists) {
    addResult(
      'Python executable',
      false,
      `Not found at ${pythonExecutable}`
    );
    return;
  }

  addResult(
    'Python executable',
    true,
    `Found at ${pythonExecutable}`
  );

  // Check if executable
  try {
    const stats = fs.statSync(pythonExecutable);
    const isExecutable = !!(stats.mode & fs.constants.S_IXUSR);
    addResult(
      'Python executable permissions',
      isExecutable,
      isExecutable
        ? 'Executable flag is set'
        : 'Executable flag is NOT set'
    );
  } catch (error) {
    addResult(
      'Python executable permissions',
      false,
      `Failed to check permissions: ${error}`
    );
  }
}

/**
 * Test: Verify Python lib directory exists (for Linux/macOS)
 */
function testPythonLibDirectory(): void {
  // Python libs are only bundled on Linux/macOS
  if (CURRENT_PLATFORM === 'win32') {
    logInfo('Skipping Python lib test on Windows (not bundled separately)');
    return;
  }

  const azCliDir = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', CURRENT_PLATFORM);
  const libDir = path.join(azCliDir, 'lib');

  const exists = fs.existsSync(libDir);
  if (!exists) {
    addResult(
      'Python lib directory',
      false,
      `Not found at ${libDir}`
    );
    return;
  }

  addResult(
    'Python lib directory',
    true,
    `Found at ${libDir}`
  );

  // Check for python3.X directory
  const libContents = fs.readdirSync(libDir);
  const pythonLibDir = libContents.find(item => item.startsWith('python3.'));

  if (!pythonLibDir) {
    addResult(
      'Python standard library',
      false,
      'Python3.X directory not found in lib'
    );
    return;
  }

  addResult(
    'Python standard library',
    true,
    `Found ${pythonLibDir} in lib directory`
  );
}

/**
 * Test: Verify Azure CLI can be invoked
 */
function testAzureCliInvocation(): void {
  const azCliDir = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', CURRENT_PLATFORM);
  const binDir = path.join(azCliDir, 'bin');

  let azExecutable: string;
  if (CURRENT_PLATFORM === 'win32') {
    azExecutable = path.join(binDir, 'az.cmd');
  } else {
    azExecutable = path.join(binDir, 'az');
  }

  if (!fs.existsSync(azExecutable)) {
    addResult(
      'Azure CLI invocation',
      false,
      'Executable not found, skipping invocation test'
    );
    return;
  }

  const requiredExtensions = readRequiredAzureCliExtensions(ROOT_DIR);

  try {
    // Try to get version with increased timeout for CI environments
    const version = execSync(`"${azExecutable}" version --output json`, {
      encoding: 'utf-8',
      timeout: 120000, // Increased to 120 seconds for CI environments
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    }).trim();

    const versionData = JSON.parse(version);
    const azureCliVersion = versionData['azure-cli'];

    addResult(
      'Azure CLI invocation',
      azureCliVersion === AZURE_CLI_TARGET.version,
      azureCliVersion === AZURE_CLI_TARGET.version
        ? `Successfully invoked pinned version: ${azureCliVersion}`
        : `Found version ${azureCliVersion}, expected ${AZURE_CLI_TARGET.version}`
    );

    // Every extension the build configures must actually be there. The
    // installers in download-az-cli.ts abort on a failed install, but this
    // is an independent post-build integrity check of what actually got
    // staged — a stale external-tools directory that predates the current
    // config can still ship missing one: without `connectedk8s`, for
    // instance, no AKS Hybrid & Edge cluster can be discovered or connected
    // at all. Every platform pre-installs the configured extensions —
    // Windows into the app-owned cliextensions directory its az.cmd wrapper
    // points AZURE_EXTENSION_DIR at — so every platform is verified.
    const bundledExtensions = versionData.extensions ?? {};
    const missingExtensions = requiredExtensions.filter(name => !bundledExtensions[name]);

    addResult(
      'Azure CLI extensions',
      missingExtensions.length === 0,
      missingExtensions.length === 0
        ? `All required extensions bundled: ${requiredExtensions.join(', ')}`
        : `Missing required extension(s): ${missingExtensions.join(', ')}`
    );

    // aks-preview shadows the core `az aks namespace` implementation the
    // plugin now depends on, so it must never be bundled.
    const aksPreviewVersion = versionData.extensions?.['aks-preview'];
    addResult(
      'aks-preview extension absent',
      !aksPreviewVersion,
      aksPreviewVersion
        ? `aks-preview extension ${aksPreviewVersion} is bundled and shadows the core "az aks namespace" command`
        : 'aks-preview extension is not bundled, as expected'
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ETIMEDOUT')) {
      logWarning(`Azure CLI invocation timed out (this can happen in CI environments)`);
      addResult(
        'Azure CLI invocation',
        false,
        'Timed out before the bundled CLI could be validated'
      );
      const extensionResult = getExtensionTimeoutResult(requiredExtensions);
      addResult(extensionResult.name, extensionResult.passed, extensionResult.message);
    } else {
      addResult(
        'Azure CLI invocation',
        false,
        `Failed to invoke: ${errorMessage}`
      );
    }
  }
}

/**
 * Test: Verify Python can be invoked (for Linux/macOS)
 */
function testPythonInvocation(): void {
  // Python is only bundled on Linux/macOS
  if (CURRENT_PLATFORM === 'win32') {
    logInfo('Skipping Python invocation test on Windows');
    return;
  }

  const azCliDir = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', CURRENT_PLATFORM);
  const binDir = path.join(azCliDir, 'bin');
  const pythonExecutable = path.join(binDir, 'python3');

  if (!fs.existsSync(pythonExecutable)) {
    addResult(
      'Python invocation',
      false,
      'Executable not found, skipping invocation test'
    );
    return;
  }

  try {
    const version = execSync(`"${pythonExecutable}" --version`, {
      encoding: 'utf-8',
      timeout: 60000, // Increased to 60 seconds for CI environments
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    addResult(
      'Python invocation',
      true,
      `Successfully invoked: ${version}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ETIMEDOUT')) {
      logWarning(`Python invocation timed out (this can happen in CI environments)`);
      addResult(
        'Python invocation',
        false,
        'Timed out before the bundled Python could be validated'
      );
    } else {
      addResult(
        'Python invocation',
        false,
        `Failed to invoke: ${errorMessage}`
      );
    }
  }
}

/**
 * Test: Verify az-kubelogin.py exists
 */
function testKubeloginScript(): void {
  const binDir = path.join(EXTERNAL_TOOLS_DIR, 'bin');
  const kubeloginScript = path.join(binDir, 'az-kubelogin.py');

  const exists = fs.existsSync(kubeloginScript);
  addResult(
    'az-kubelogin.py script',
    exists,
    exists ? `Found at ${kubeloginScript}` : `Not found at ${kubeloginScript}`
  );

  if (exists && CURRENT_PLATFORM !== 'win32') {
    try {
      const stats = fs.statSync(kubeloginScript);
      const isExecutable = !!(stats.mode & fs.constants.S_IXUSR);
      addResult(
        'az-kubelogin.py permissions',
        isExecutable,
        isExecutable
          ? 'Executable flag is set'
          : 'Executable flag is NOT set'
      );
    } catch (error) {
      addResult(
        'az-kubelogin.py permissions',
        false,
        `Failed to check permissions: ${error}`
      );
    }
  }
}

/**
 * Test: Verify the aks-mcp binary was packaged for the target architecture
 */
function testAksMcpBinary(): void {
  const binDir = path.join(EXTERNAL_TOOLS_DIR, 'bin');
  const aksMcpBinary = path.join(binDir, aksMcpBinaryName(CURRENT_PLATFORM));
  const exists = fs.existsSync(aksMcpBinary);

  // No release asset exists for architectures such as armv7l, so shipping
  // nothing is correct there and shipping something means it is the wrong CPU.
  if (!isSupportedAksMcpArch(TARGET_ARCH)) {
    addResult(
      'aks-mcp binary',
      !exists,
      exists
        ? `Unexpected binary at ${aksMcpBinary} for unsupported architecture ${TARGET_ARCH}`
        : `Correctly omitted for unsupported architecture ${TARGET_ARCH}`
    );
    return;
  }

  addResult(
    'aks-mcp binary',
    exists,
    exists ? `Found at ${aksMcpBinary}` : `Not found at ${aksMcpBinary}`
  );

  if (!exists) {
    return;
  }

  // Native packaging jobs must prove that the packaged binary can actually
  // start. Cross-architecture jobs still get checksum validation below, but
  // cannot safely execute a binary for a different CPU on every build host.
  const helperArch = CURRENT_PLATFORM === 'darwin' ? 'x64' : TARGET_ARCH;
  if (helperArch === process.arch) {
    try {
      const version = execFileSync(aksMcpBinary, ['--version'], {
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
      }).trim();
      addResult(
        'aks-mcp invocation',
        version.startsWith('aks-mcp version '),
        version.split(/\r?\n/, 1)[0] || 'Version output was empty'
      );
    } catch (error) {
      addResult(
        'aks-mcp invocation',
        false,
        `Failed to execute packaged binary: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // The checksum is architecture specific, so this also catches a binary built
  // for the wrong CPU during cross-architecture packaging.
  try {
    const { version, expectedChecksum } = resolveAksMcpTarget(
      ROOT_DIR,
      CURRENT_PLATFORM,
      TARGET_ARCH
    );
    const matches = matchesChecksum(aksMcpBinary, expectedChecksum);
    addResult(
      'aks-mcp checksum',
      matches,
      matches
        ? `Matches pinned ${version} checksum for ${CURRENT_PLATFORM}/${TARGET_ARCH}`
        : `Does not match the pinned ${version} checksum for ${CURRENT_PLATFORM}/${TARGET_ARCH}`
    );
  } catch (error) {
    addResult(
      'aks-mcp checksum',
      false,
      `Failed to resolve expected checksum: ${error instanceof Error ? error.message : error}`
    );
  }

  if (CURRENT_PLATFORM !== 'win32') {
    try {
      const stats = fs.statSync(aksMcpBinary);
      const isExecutable = !!(stats.mode & fs.constants.S_IXUSR);
      addResult(
        'aks-mcp permissions',
        isExecutable,
        isExecutable ? 'Executable flag is set' : 'Executable flag is NOT set'
      );
    } catch (error) {
      addResult(
        'aks-mcp permissions',
        false,
        `Failed to check permissions: ${error}`
      );
    }
  }
}

/**
 * Test: Verify README file exists
 */
function testReadmeExists(): void {
  const azCliDir = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', CURRENT_PLATFORM);
  const readmePath = path.join(azCliDir, 'README.md');

  const exists = fs.existsSync(readmePath);
  addResult(
    'README.md',
    exists,
    exists ? `Found at ${readmePath}` : `Not found at ${readmePath}`
  );
}

/**
 * Print summary of test results
 */
function printSummary(): void {
  console.log('');
  log('========================================', 'blue');
  log('           TEST SUMMARY', 'blue');
  log('========================================', 'blue');
  console.log('');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  log(`Platform: ${CURRENT_PLATFORM}`, 'cyan');
  log(`Total tests: ${total}`, 'cyan');
  logSuccess(`Passed: ${passed}`);

  if (failed > 0) {
    logError(`Failed: ${failed}`);
  }

  console.log('');

  if (failed > 0) {
    log('Failed tests:', 'red');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        logError(`  - ${r.name}: ${r.message}`);
      });
    console.log('');
  }

  log('========================================', 'blue');
  console.log('');

  if (failed > 0) {
    process.exit(1);
  } else {
    logSuccess('All tests passed! ✨');
  }
}

/**
 * Main test runner
 */
function main(): void {
  log('========================================', 'cyan');
  log('  POST-BUILD VERIFICATION TESTS', 'cyan');
  log('========================================', 'cyan');
  console.log('');
  logInfo(`Platform: ${CURRENT_PLATFORM}`);
  logInfo(`Build directory: ${BUILD_DIST_DIR}`);
  logInfo(`Testing bundled tools at: ${EXTERNAL_TOOLS_DIR}`);
  console.log('');

  // First check if build directory exists
  if (!fs.existsSync(BUILD_DIST_DIR)) {
    logError(`Build directory not found: ${BUILD_DIST_DIR}`);
    logError('Please run the build first:');
    console.log('');
    console.log('  npm run build              # Build for current platform');
    console.log('  npm run build:linux        # Build for Linux');
    console.log('  npm run build:mac          # Build for macOS');
    console.log('  npm run build:win          # Build for Windows');
    console.log('  npm run build:unpacked     # Build unpacked for current platform');
    console.log('');
    process.exit(1);
  }

  // Run all tests
  testExternalToolsDir();
  testAzureCliStructure();
  testAzureCliTarget();
  testAzureCliExecutable();
  testPythonBundled();
  testPythonLibDirectory();
  testKubeloginScript();
  testAksMcpBinary();
  testReadmeExists();

  console.log('');
  log('Running invocation tests...', 'yellow');
  console.log('');

  testAzureCliInvocation();
  testPythonInvocation();

  // Print summary
  printSummary();
}

// Run tests
main();
