// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runAzCommand } from './az-cli';

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

  // Check Azure CLI version using JSON output
  const { stdout: versionStdout, stderr: versionStderr } = await runAzCommand(['version']);
  if (
    versionStderr &&
    (versionStderr.includes('not found') || versionStderr.includes('command not found'))
  ) {
    suggestions.push(
      'Azure CLI is not installed. Install it from: https://docs.microsoft.com/cli/azure/install-azure-cli'
    );
  } else if (versionStdout) {
    try {
      const versionData = JSON.parse(versionStdout);
      cliInstalled = true;

      // Extract version from JSON
      if (versionData['azure-cli']) {
        cliVersion = versionData['azure-cli'];
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

      // Check aks-preview extension from JSON
      if (versionData.extensions && versionData.extensions['aks-preview']) {
        aksPreviewInstalled = true;
      } else {
        suggestions.push(
          'Install the az aks-preview extension: az extension add --name aks-preview'
        );
      }
    } catch (parseError) {
      // Fallback if JSON parsing fails
      suggestions.push(
        'Could not parse Azure CLI version information. Please ensure Azure CLI is installed.'
      );
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
