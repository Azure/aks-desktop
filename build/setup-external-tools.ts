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

// Download and install Azure CLI (or use system az if AKS_DESKTOP_SYSTEM_AZ is set)
console.log('==========================================');
console.log('Installing Azure CLI...');
console.log('==========================================');

if (process.env.AKS_DESKTOP_SYSTEM_AZ) {
  // Check if system az is available
  try {
    const azVersion = execSync('az version --output tsv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log('Using system Azure CLI installation:');
    console.log(azVersion.trim());
    console.log('');
    console.log('Skipping bundled Azure CLI download (AKS_DESKTOP_SYSTEM_AZ is set).');

    // Create the az-cli directory structure so the rest of the setup doesn't fail
    const azCliBinDir = path.join(AZ_CLI_DIR, 'bin');
    fs.mkdirSync(azCliBinDir, { recursive: true });

    // Create a wrapper that delegates to the system az using its absolute path.
    // This avoids infinite recursion since Electron prepends az-cli/bin to PATH at runtime.
    if (PLATFORM === 'win32') {
      const systemAzPath = execSync('where az', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split(/\r?\n/)[0];
      fs.writeFileSync(path.join(azCliBinDir, 'az.cmd'), `@echo off\r\ncall "${systemAzPath}" %*\r\n`);
    } else {
      const systemAzPath = execSync('command -v az', { encoding: 'utf-8', shell: '/bin/sh', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      fs.writeFileSync(path.join(azCliBinDir, 'az-wrapper'), `#!/bin/sh\nexec "${systemAzPath}" "$@"\n`, { mode: 0o755 });
      const azSymlink = path.join(azCliBinDir, 'az');
      if (fs.existsSync(azSymlink)) fs.unlinkSync(azSymlink);
      fs.symlinkSync('az-wrapper', azSymlink);
    }

    console.log('✅ System Azure CLI wrapper created');
  } catch {
    console.error('❌ ERROR: AKS_DESKTOP_SYSTEM_AZ is set but "az" was not found on PATH.');
    console.error('   Install Azure CLI or unset AKS_DESKTOP_SYSTEM_AZ to download it automatically.');
    process.exit(1);
  }
} else {
  try {
    execSync(`npx --yes tsx "${path.join(SCRIPT_DIR, 'download-az-cli.ts')}"`, {
      stdio: 'inherit',
      cwd: ROOT_DIR
    });
  } catch (error) {
    console.error('❌ ERROR: Failed to install Azure CLI');
    process.exit(1);
  }
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
