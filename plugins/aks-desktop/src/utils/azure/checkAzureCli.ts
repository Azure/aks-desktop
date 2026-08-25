// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runCommandAsync } from './az-cli-core';

/**
 * Checks Azure CLI version.
 * Provides suggestions if requirements are not met.
 * Returns an object with status and suggestions.
 */

export async function checkAzureCli(): Promise<{
  cliInstalled: boolean;
  cliVersion: string | null;
  cliVersionOk: boolean;
  suggestions: string[];
}> {
  let cliInstalled = false;
  let cliVersion: string | null = null;
  let cliVersionOk = false;
  const suggestions: string[] = [];

  // Check Azure CLI version using JSON output
  const { stdout: versionStdout, stderr: versionStderr } = await runCommandAsync('az', ['version']);
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
        // 2.85.0 fixed the location logic for the managed namespace update
        // operation, which this plugin relies on; managed namespaces are
        // unreliable below it.
        cliVersionOk = major > 2 || (major === 2 && minor >= 85);
        if (!cliVersionOk) {
          suggestions.push(
            'Update Azure CLI to version 2.85 or newer: https://docs.microsoft.com/cli/azure/install-azure-cli'
          );
        }
      } else {
        suggestions.push(
          'Could not determine Azure CLI version. Please ensure Azure CLI is installed.'
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
    suggestions,
  };
}
