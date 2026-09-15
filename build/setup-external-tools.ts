#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Setup external tools for AKS desktop
 * This script downloads and configures Azure CLI and related tools
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const SCRIPT_DIR = __dirname;
const ROOT_DIR = path.dirname(SCRIPT_DIR);

console.log('==========================================');
console.log('Setting up external tools for AKS desktop');
console.log('==========================================');
console.log('');

// Detect platform
const PLATFORM = process.platform;
if (!['linux', 'darwin', 'win32'].includes(PLATFORM)) {
  console.error(`❌ Unknown platform: ${PLATFORM}`);
  process.exit(1);
}

console.log(`Platform: ${PLATFORM}`);
console.log('');

// Define paths after platform is detected
const EXTERNAL_TOOLS_DIR = path.join(ROOT_DIR, 'headlamp', 'app', 'resources', 'external-tools');
const EXTERNAL_TOOLS_BIN = path.join(EXTERNAL_TOOLS_DIR, 'bin');
const AZ_CLI_DIR = path.join(EXTERNAL_TOOLS_DIR, 'az-cli', PLATFORM);

// Download and install Azure CLI
console.log('==========================================');
console.log('Installing Azure CLI...');
console.log('==========================================');

try {
  execSync(`npx --yes tsx "${path.join(SCRIPT_DIR, 'download-az-cli.ts')}"`, {
    stdio: 'inherit',
    cwd: ROOT_DIR
  });
} catch (error) {
  console.error('❌ ERROR: Failed to install Azure CLI');
  process.exit(1);
}

console.log('');

// Create bin directory for external tools scripts
fs.mkdirSync(EXTERNAL_TOOLS_BIN, { recursive: true });

// Install az-kubelogin.py script
const KUBELOGIN_SCRIPT = path.join(SCRIPT_DIR, 'az-kubelogin.py');

if (fs.existsSync(KUBELOGIN_SCRIPT)) {
  console.log('==========================================');
  console.log('Installing az-kubelogin.py...');
  console.log('==========================================');

  const targetScript = path.join(EXTERNAL_TOOLS_BIN, 'az-kubelogin.py');
  fs.copyFileSync(KUBELOGIN_SCRIPT, targetScript);

  // Make executable on Unix systems
  if (PLATFORM !== 'win32') {
    fs.chmodSync(targetScript, 0o755);
  }

  console.log(`✅ az-kubelogin.py installed to: ${EXTERNAL_TOOLS_BIN}`);
  console.log('');
}

console.log('==========================================');
console.log('✅ External tools setup complete!');
console.log('==========================================');
console.log('');
console.log('Installed tools:');

// Check what was installed
const azCliBinPath = path.join(AZ_CLI_DIR, 'bin');
const azPath = PLATFORM === 'win32'
  ? path.join(azCliBinPath, 'az.cmd')
  : path.join(azCliBinPath, 'az');

if (fs.existsSync(azPath)) {
  console.log(`  - Azure CLI (${azPath})`);
}

const kubeloginScriptPath = path.join(EXTERNAL_TOOLS_BIN, 'az-kubelogin.py');
if (fs.existsSync(kubeloginScriptPath)) {
  console.log(`  - az-kubelogin.py (${kubeloginScriptPath})`);
}

console.log('');
