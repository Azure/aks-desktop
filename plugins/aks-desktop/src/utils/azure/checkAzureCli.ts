// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runCommandAsync } from './az-cli';

/**
 * Checks Azure CLI version and aks-preview extension status.
 * Provides suggestions if requirements are not met.
 * Returns an object with status and suggestions.
 */

export async function checkAzureCliAndAksPreview(): Promise<{
  cliInstalled: boolean;
  cliVersion: string | null;
  cliVersionOk: boolean;
  aksPreviewInstalled: boolean;
  suggestions: string[];
}> {
  let cliInstalled = false;
  let cliVersion: string | null = null;
  let cliVersionOk = false;
  let aksPreviewInstalled = false;
  const suggestions: string[] = [];

  // Check Azure CLI version
  const { stdout: versionStdout, stderr: versionStderr } = await runCommandAsync('az', [
    '--version',
  ]);
  if (
    versionStderr &&
    (versionStderr.includes('not found') || versionStderr.includes('command not found'))
  ) {
    suggestions.push(
      'Azure CLI is not installed. Install it from: https://docs.microsoft.com/cli/azure/install-azure-cli'
    );
  } else if (versionStdout) {
    cliInstalled = true;
    const match = versionStdout.match(/azure-cli\s+(\d+\.\d+\.\d+)/i);
    if (match) {
      cliVersion = match[1];
      const [major, minor] = cliVersion.split('.').map(Number);
      cliVersionOk = major > 2 || (major === 2 && minor >= 76);
      if (!cliVersionOk) {
        suggestions.push(
          'Update Azure CLI to version 2.76 or newer: https://docs.microsoft.com/cli/azure/install-azure-cli'
        );
      }
    } else {
      suggestions.push(
        'Could not determine Azure CLI version. Please ensure Azure CLI is installed.'
      );
    }
  }

  // Check aks-preview extension
  if (cliInstalled) {
    const { stdout: extStdout, stderr: extStderr } = await runCommandAsync('az', [
      'extension',
      'show',
      '--name',
      'aks-preview',
    ]);
    if (extStderr && extStderr.includes('not installed')) {
      suggestions.push('Install the az aks-preview extension: az extension add --name aks-preview');
    } else if (extStdout && extStdout.includes('aks-preview')) {
      aksPreviewInstalled = true;
    } else {
      suggestions.push('Install the az aks-preview extension: az extension add --name aks-preview');
    }
  }

  return {
    cliInstalled,
    cliVersion,
    cliVersionOk,
    aksPreviewInstalled,
    suggestions,
  };
}
