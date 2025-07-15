/**
 * Azure CLI Path Resolution Utility
 *
 * This module handles detection and resolution of Azure CLI paths,
 * supporting both bundled CLI (Windows) and system-installed CLI (all platforms).
 */

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Helper to check if running in Electron
function isElectron(): boolean {
  if (typeof window !== 'undefined' && (window as any).desktopApi) {
    return true;
  }
  // Also check for process.versions.electron
  if (typeof process !== 'undefined' && (process as any).versions?.electron) {
    return true;
  }
  return false;
}

// Helper to get the platform
function getPlatform(): string {
  if (typeof process !== 'undefined') {
    return process.platform;
  }
  return 'unknown';
}

/**
 * Get the path to bundled Azure CLI if running in Electron
 * @returns Path to bundled az CLI or null if not found/not in Electron
 */
export function getBundledAzPath(): string | null {
  if (!isElectron()) {
    console.log('[AZ-CLI] Not running in Electron');
    return null;
  }

  try {
    const platform = getPlatform();
    console.log('[AZ-CLI] Platform detected:', platform);

    // Get resources path from Electron
    // In production: process.resourcesPath
    // In development: we won't have bundled CLI
    if (typeof process !== 'undefined' && (process as any).resourcesPath) {
      const resourcesPath = (process as any).resourcesPath;
      console.log('[AZ-CLI] Resources path:', resourcesPath);

      let fs: any = null;
      try {
        if (typeof require !== 'undefined') {
          fs = require('fs');
        }
      } catch (e) {
        console.warn('[AZ-CLI] Could not load fs module:', e);
      }

      if (platform === 'win32') {
        // Windows: Use .cmd wrapper
        const azPath = `${resourcesPath}/az-cli/bin/az.cmd`;
        console.log('[AZ-CLI] Checking bundled Windows path:', azPath);
        if (fs && fs.existsSync(azPath)) {
          console.log('[AZ-CLI] ✅ Found bundled Windows Azure CLI');
          return azPath;
        } else {
          console.warn('[AZ-CLI] ❌ Bundled Windows Azure CLI not found at:', azPath);
        }
      } else if (platform === 'darwin') {
        // macOS: First try the wrapper (portable install), then check for direct az binary
        const wrapperPath = `${resourcesPath}/az-cli/bin/az-wrapper`;
        const directPath = `${resourcesPath}/az-cli/bin/az`;

        console.log('[AZ-CLI] Checking bundled macOS paths:', { wrapperPath, directPath });

        if (fs) {
          if (fs.existsSync(wrapperPath)) {
            console.log('[AZ-CLI] ✅ Found bundled macOS portable install (wrapper)');
            return wrapperPath;
          } else if (fs.existsSync(directPath)) {
            console.log('[AZ-CLI] ✅ Found bundled macOS binary (direct)');
            return directPath;
          } else {
            console.warn(
              '[AZ-CLI] ❌ Bundled macOS Azure CLI not found at:',
              wrapperPath,
              'or',
              directPath
            );
          }
        } else {
          // No fs available, return wrapper path and hope it exists
          console.log('[AZ-CLI] No fs module, returning wrapper path');
          return wrapperPath;
        }
      } else if (platform === 'linux') {
        // Linux: First try the wrapper (portable install), then check for direct az binary
        const wrapperPath = `${resourcesPath}/az-cli/bin/az-wrapper`;
        const directPath = `${resourcesPath}/az-cli/bin/az`;

        console.log('[AZ-CLI] Checking bundled Linux paths:', { wrapperPath, directPath });

        if (fs) {
          if (fs.existsSync(wrapperPath)) {
            console.log('[AZ-CLI] ✅ Found bundled Linux portable install (wrapper)');
            return wrapperPath;
          } else if (fs.existsSync(directPath)) {
            console.log('[AZ-CLI] ✅ Found bundled Linux binary (direct)');
            return directPath;
          } else {
            console.warn(
              '[AZ-CLI] ❌ Bundled Linux Azure CLI not found at:',
              wrapperPath,
              'or',
              directPath
            );
          }
        } else {
          // No fs available, return wrapper path and hope it exists
          console.log('[AZ-CLI] No fs module, returning wrapper path');
          return wrapperPath;
        }
      }
    } else {
      console.warn('[AZ-CLI] process.resourcesPath is not available');
    }
  } catch (error) {
    console.error('[AZ-CLI] Error detecting bundled path:', error);
  }

  console.log('[AZ-CLI] No bundled Azure CLI found, will fall back to system CLI');
  return null;
}

/**
 * Get the Azure CLI command to use
 *
 * The Electron main process adds the bundled Azure CLI bin directory to PATH,
 * so we can just use 'az' and it will find the bundled version automatically.
 *
 * @returns The command string to use for Azure CLI
 */
export function getAzCommand(): string {
  // The Electron main process has already added az-cli/bin to PATH
  // So we can just return 'az' and it will use the bundled version
  return 'az';
}

/**
 * Check if we should use the bundled CLI
 * @returns true if bundled CLI is available and should be used
 */
export function shouldUseBundledCli(): boolean {
  return getBundledAzPath() !== null;
}

/**
 * Get installation instructions based on platform
 * @returns Installation instructions string
 */
export function getInstallationInstructions(): string {
  const platform = getPlatform();

  if (platform === 'win32') {
    return `
Azure CLI is not installed or not found in PATH.

To install Azure CLI on Windows:
1. Download from: https://aka.ms/installazurecliwindowsx64
2. Or use WinGet: winget install Microsoft.AzureCLI
3. Restart AKS desktop after installation

For more info: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows
    `.trim();
  } else if (platform === 'darwin') {
    return `
Azure CLI is not installed or not found in PATH.

To install Azure CLI on macOS:
1. Using Homebrew: brew install azure-cli
2. Or download from: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos
3. Restart AKS desktop after installation

For more info: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos
    `.trim();
  } else {
    // Linux
    return `
Azure CLI is not installed or not found in PATH.

To install Azure CLI on Linux:
1. Run: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
2. Or see: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux
3. Restart AKS desktop after installation

For more info: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux
    `.trim();
  }
}
