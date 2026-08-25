// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { debugLog, getErrorMessage, isAzError, needsRelogin, runCommandAsync } from './az-cli-core';

export async function isExtensionInstalled(
  extensionName: string
): Promise<{ installed: boolean; error?: string }> {
  try {
    debugLog(`Checking if ${extensionName} extension is installed...`);
    const { stdout, stderr } = await runCommandAsync('az', [
      'extension',
      'show',
      '--name',
      extensionName,
    ]);

    debugLog(`[AZ-CLI] ${extensionName} extension check - stdout:`, stdout);
    debugLog(`[AZ-CLI] ${extensionName} extension check - stderr:`, stderr);

    if (stderr && stderr.includes('not installed')) {
      debugLog(`[AZ-CLI] ${extensionName} extension is NOT installed`);
      return { installed: false };
    }

    if (stderr && needsRelogin(stderr)) {
      return {
        installed: false,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (stderr && isAzError(stderr)) {
      return { installed: false, error: `Failed to check extension ${extensionName}: ${stderr}` };
    }

    debugLog(`[AZ-CLI] ${extensionName} extension is installed`);
    return { installed: true };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    debugLog(`[AZ-CLI] ${extensionName} extension check - error:`, errorMessage);
    if (errorMessage.includes('not installed')) {
      return { installed: false };
    }
    return { installed: false, error: errorMessage };
  }
}

export async function installExtension(
  extensionName: string,
  options?: { allowPreview?: boolean }
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  try {
    debugLog(`[AZ-CLI] Installing ${extensionName} extension...`);
    const args = ['extension', 'add', '-n', extensionName];
    if (options?.allowPreview) {
      args.push('--allow-preview', 'true');
    }

    const { stdout, stderr } = await runCommandAsync('az', args);

    debugLog(`[AZ-CLI] ${extensionName} extension install - stdout:`, stdout);
    debugLog(`[AZ-CLI] ${extensionName} extension install - stderr:`, stderr);

    if (stderr && isAzError(stderr)) {
      debugLog(`[AZ-CLI] ${extensionName} extension installation FAILED`);
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to install ${extensionName} extension: ${stderr}`,
      };
    }

    debugLog(`[AZ-CLI] ${extensionName} extension installed successfully`);
    return { success: true, stdout, stderr };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    debugLog(`[AZ-CLI] ${extensionName} extension install - error:`, errorMessage);
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to install ${extensionName} extension: ${errorMessage}`,
    };
  }
}

export async function configureAzureCliExtensions(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    debugLog('[AZ-CLI] Configuring Azure CLI to auto-install extensions...');

    const result1 = await runCommandAsync('az', [
      'config',
      'set',
      'extension.use_dynamic_install=yes_without_prompt',
    ]);
    debugLog(
      '[AZ-CLI] Config set use_dynamic_install - stdout:',
      result1.stdout,
      'stderr:',
      result1.stderr
    );

    if (result1.stderr && isAzError(result1.stderr)) {
      return {
        success: false,
        error: `Failed to configure extension auto-install: ${result1.stderr}`,
      };
    }

    const result2 = await runCommandAsync('az', [
      'config',
      'set',
      'extension.dynamic_install_allow_preview=true',
    ]);
    debugLog(
      '[AZ-CLI] Config set allow_preview - stdout:',
      result2.stdout,
      'stderr:',
      result2.stderr
    );

    if (result2.stderr && isAzError(result2.stderr)) {
      return {
        success: false,
        error: `Failed to configure extension preview install: ${result2.stderr}`,
      };
    }

    debugLog('[AZ-CLI] Azure CLI extension auto-install configured successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    debugLog('[AZ-CLI] Failed to configure Azure CLI extensions:', errorMessage);
    return {
      success: false,
      error: `Failed to configure Azure CLI extensions: ${errorMessage}`,
    };
  }
}

async function runRegistrationCommand(
  args: string[],
  label: string
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  try {
    debugLog(`Registering ${label}...`);
    const { stdout, stderr } = await runCommandAsync('az', args);

    if (stderr && isAzError(stderr)) {
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to register ${label}: ${stderr}`,
      };
    }

    return { success: true, stdout, stderr };
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to register ${label}: ${getErrorMessage(error)}`,
    };
  }
}

export function registerContainerServiceProvider(subscriptionId?: string) {
  const args = ['provider', 'register', '-n', 'Microsoft.ContainerService'];
  if (subscriptionId) {
    args.push('--subscription', subscriptionId);
  }
  return runRegistrationCommand(args, 'Microsoft.ContainerService provider');
}
