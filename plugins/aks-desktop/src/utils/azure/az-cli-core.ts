// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { runCommandAsync as execCommand } from '../shared/runCommandAsync';
import { getAzCommand } from './az-cli-path';

// Debug flag - set to true for development/debugging, false for production
// Can be controlled via:
// 1. NODE_ENV=development (automatic)
// 2. DEBUG_AZ_CLI=true environment variable
// 3. Manually set DEBUG_LOGS = true for debugging
const DEBUG_LOGS = process.env.NODE_ENV === 'development' || process.env.DEBUG_AZ_CLI === 'true';

// Helper function for debug logging
export const debugLog = (...args: any[]) => {
  if (DEBUG_LOGS) {
    console.debug(...args);
  }
};

// Validate that a string is a valid GUID (prevents KQL injection in Resource Graph queries)
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidGuid(value: string): boolean {
  return GUID_PATTERN.test(value);
}

// Helper to determine if error message implies re-login is needed
export function needsRelogin(error: string): boolean {
  return (
    error.includes('Interactive authentication is needed') ||
    error.includes('AADSTS700082') ||
    error.includes('AADSTS50173')
  );
}

export function runCommandAsync(
  command: string,
  args: string[],
  options?: {
    redactedArgs?: string[];
  }
): Promise<{ stdout: string; stderr: string }> {
  let actualCommand = command;
  if (command === 'az') {
    actualCommand = getAzCommand();
    debugLog('[AZ-CLI] Command resolution:', command, '→', actualCommand);
  }
  debugLog(
    '[AZ-CLI] Executing command:',
    actualCommand,
    'with args:',
    options?.redactedArgs ?? args
  );
  return execCommand(actualCommand, args);
}

export async function isAzCliInstalled(): Promise<boolean> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', ['version']);
    debugLog('Azure CLI version check:', stderr, stdout);

    if (stderr && isCliNotFoundError(stderr)) {
      debugLog('Azure CLI not found in PATH');
      return false;
    }

    // Parse JSON output from az version
    if (stdout) {
      try {
        const versionData = JSON.parse(stdout);
        if (versionData['azure-cli']) {
          debugLog('Azure CLI found, version:', versionData['azure-cli']);
          return true; // Azure CLI is installed
        } else {
          debugLog('Azure CLI version not detected in JSON output');
          return false;
        }
      } catch (parseError) {
        debugLog('Failed to parse Azure CLI version JSON:', parseError);
        return false;
      }
    } else {
      debugLog('Azure CLI version not detected in output');
      return false; // Azure CLI not found
    }
  } catch (error) {
    console.error('Error checking Azure CLI installation:', error);
    return false;
  }
}

export async function isAzCliLoggedIn(): Promise<boolean> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', [
      'account',
      'show',
      '--query',
      'user.name',
      '-o',
      'tsv',
    ]);

    if (stderr && isCliNotFoundError(stderr)) {
      debugLog('Azure CLI not found when checking login status');
      return false;
    }

    if (stdout.trim()) return true;
    if (needsRelogin(stderr)) console.warn('AKS-plugin: Azure CLI requires re-login');
    return false;
  } catch (error) {
    console.error('Error checking Azure CLI login status:', error);
    return false;
  }
}

// Azure CLI prefixes fatal errors with "ERROR: " in stderr
export function isAzError(stderr: string): boolean {
  return stderr.includes('ERROR: ');
}

export function isCliNotFoundError(output: string): boolean {
  return (
    output.includes('command not found') ||
    output.includes('not found') ||
    output.includes('Azure CLI (az) command not found')
  );
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Shared helper that runs an `az` CLI command and handles the common
 * error-handling pattern (relogin detection, az-error detection, JSON
 * parsing, and catch-block formatting).
 *
 * @param args          - CLI arguments passed to `az`.
 * @param debugLabel    - Label used in `debugLog` (e.g. "Creating managed identity:").
 * @param errorContext  - Human-readable phrase used in error messages
 *                        (e.g. "create managed identity").
 * @param parseOutput   - Optional function to extract a value from stdout.
 * @param checkStderr   - Optional callback invoked when stderr is non-empty,
 *                        *after* the relogin check but *before* the isAzError
 *                        check. Return a result object to short-circuit, or
 *                        `null` to fall through to the default error check.
 */
export async function runAzCommand<T>(
  args: string[],
  debugLabel: string,
  errorContext: string,
  parseOutput?: (stdout: string) => T,
  checkStderr?: (stderr: string) => { success: boolean; [key: string]: unknown } | null
): Promise<{ success: boolean; data?: T; error?: string; [key: string]: unknown }> {
  try {
    debugLog(debugLabel, 'az', args.join(' '));
    const { stdout, stderr } = await runCommandAsync('az', args);

    if (stderr) {
      if (needsRelogin(stderr)) {
        return {
          success: false,
          error: 'Authentication required. Please log in to Azure CLI: az login',
        };
      }

      if (checkStderr) {
        const earlyReturn = checkStderr(stderr);
        if (earlyReturn) {
          return earlyReturn;
        }
      }

      if (isAzError(stderr)) {
        return { success: false, error: `Failed to ${errorContext}: ${stderr}` };
      }
    }

    const data = parseOutput ? parseOutput(stdout) : undefined;
    return { success: true, data };
  } catch (error) {
    const msg = getErrorMessage(error);
    return { success: false, error: `Failed to ${errorContext}: ${msg}` };
  }
}
