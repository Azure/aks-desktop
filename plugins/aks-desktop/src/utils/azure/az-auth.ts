// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { LOGIN_POLL_INTERVAL_MS, LOGIN_TIMEOUT_MS } from '../constants/timing';
import {
  debugLog,
  getErrorMessage,
  isAzCliLoggedIn,
  isAzError,
  isCliNotFoundError,
  needsRelogin,
  runCommandAsync,
} from './az-cli-core';
import { getAzCommand, getInstallationInstructions } from './az-cli-path';

/** Azure CLI account state used by authentication flows. */
export interface AzureLoginStatus {
  /** Whether Azure CLI has a usable current account. */
  isLoggedIn: boolean;
  /** Signed-in account name when available. */
  username?: string;
  /** Current Azure tenant identifier when available. */
  tenantId?: string;
  /** Current Azure subscription identifier when available. */
  subscriptionId?: string;
  /** Whether Azure CLI explicitly requires another login. */
  needsRelogin?: boolean;
  /** Actionable status error when account lookup fails. */
  error?: string;
}

/** Result returned after invoking the Azure CLI login command. */
export interface AzureLoginResult {
  /** Whether the login command completed without a terminal command error. */
  success: boolean;
  /** User-facing description of the result. */
  message: string;
}

/** Account-status update emitted by {@link monitorLoginStatus}. */
export interface AzureLoginStatusUpdate {
  /** Whether login has completed. */
  isLoggedIn: boolean;
  /** User-facing progress, success, or failure message. */
  message: string;
}

const OPERATION_TIMED_OUT = Symbol('operation-timed-out');

/**
 * Waits for an operation until a shared deadline is reached.
 *
 * @param operation - Promise to wait for.
 * @param deadline - Absolute deadline in milliseconds since the Unix epoch.
 * @returns Operation result, or a timeout sentinel when the deadline wins.
 */
async function waitUntilDeadline<T>(
  operation: Promise<T>,
  deadline: number
): Promise<T | typeof OPERATION_TIMED_OUT> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<typeof OPERATION_TIMED_OUT>(resolve => {
    timeout = setTimeout(() => resolve(OPERATION_TIMED_OUT), Math.max(0, deadline - Date.now()));
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Determines whether raw stderr represents a failed command.
 *
 * @param stderr - Raw Azure CLI or command-bridge error output.
 * @returns Whether the command failed before producing usable output.
 */
function isCommandFailure(stderr: string): boolean {
  const error = stderr.trim();
  return (
    isAzError(error) ||
    error.startsWith('Command exited with code ') ||
    error.startsWith('Command execution error:') ||
    error.startsWith('Failed to execute command:') ||
    error === 'pluginRunCommand is not available.'
  );
}

/**
 * Reads and validates the current Azure CLI account.
 *
 * @returns Validated login status. Command and parsing failures are returned in `error`.
 */
export async function getLoginStatus(): Promise<AzureLoginStatus> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', ['account', 'show', '-o', 'json']);
    const accountOutput = stdout.trim();
    const errorOutput = stderr.trim();

    if (errorOutput && isCliNotFoundError(errorOutput)) {
      return {
        isLoggedIn: false,
        error: 'Azure CLI not found. Please install Azure CLI first.',
      };
    }

    if (errorOutput && isCommandFailure(errorOutput)) {
      const needsReloginFlag = needsRelogin(errorOutput);
      return {
        isLoggedIn: false,
        needsRelogin: needsReloginFlag,
        error: errorOutput,
      };
    }

    if (!accountOutput) {
      const needsReloginFlag = needsRelogin(errorOutput);
      if (needsReloginFlag) console.warn('AKS-plugin: Azure CLI requires re-login');
      return {
        isLoggedIn: false,
        needsRelogin: needsReloginFlag,
        error: errorOutput || 'Not logged in',
      };
    }

    try {
      const account = JSON.parse(accountOutput);
      if (
        !account ||
        typeof account !== 'object' ||
        Array.isArray(account) ||
        typeof account.id !== 'string' ||
        !account.id ||
        typeof account.tenantId !== 'string' ||
        !account.tenantId
      ) {
        return { isLoggedIn: false, error: 'Failed to parse account information' };
      }
      return {
        isLoggedIn: true,
        username: account.user?.name,
        tenantId: account.tenantId,
        subscriptionId: account.id,
      };
    } catch (err) {
      return { isLoggedIn: false, error: 'Failed to parse account information' };
    }
  } catch (error) {
    console.error('Error getting Azure login status:', error);
    return {
      isLoggedIn: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Reads the complete current Azure CLI account payload.
 *
 * @returns Parsed `az account show` response.
 * @throws When the command fails, requires login, returns no output, or returns malformed JSON.
 */
export async function getUserAccountInfo(): Promise<any> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'show', '-o', 'json']);
  const accountOutput = stdout.trim();
  const errorOutput = stderr.trim();
  if (errorOutput && isCommandFailure(errorOutput)) {
    const err: any = new Error(errorOutput);
    if (needsRelogin(errorOutput)) err.needsRelogin = true;
    throw err;
  }
  if (!accountOutput) {
    const err: any = new Error(errorOutput || 'Failed to get account info');
    if (needsRelogin(stderr)) err.needsRelogin = true;
    throw err;
  }
  return JSON.parse(accountOutput);
}

/**
 * Requests an access token from Azure CLI.
 *
 * @returns Parsed `az account get-access-token` response.
 * @throws When the command fails, requires login, returns no output, or returns malformed JSON.
 */
export async function getAccessToken(): Promise<any> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'get-access-token']);
  const tokenOutput = stdout.trim();
  const errorOutput = stderr.trim();
  if (errorOutput && isCommandFailure(errorOutput)) {
    const err: any = new Error(errorOutput);
    if (needsRelogin(errorOutput)) err.needsRelogin = true;
    throw err;
  }
  if (!tokenOutput) {
    const err: any = new Error(errorOutput || 'Failed to get access token');
    if (needsRelogin(stderr)) err.needsRelogin = true;
    throw err;
  }
  return JSON.parse(tokenOutput);
}

/**
 * Runs Azure CLI login and classifies command-level failures.
 *
 * @returns Login initiation result with a user-facing message.
 */
export async function initiateLogin(): Promise<AzureLoginResult> {
  try {
    debugLog('[AZ-CLI] ===== INITIATING LOGIN =====');
    debugLog('[AZ-CLI] Resolved command:', getAzCommand());
    debugLog(
      '[AZ-CLI] Is Electron?:',
      typeof window !== 'undefined' && (window as any).desktopApi !== undefined
    );
    debugLog('[AZ-CLI] Platform:', typeof process !== 'undefined' ? process.platform : 'unknown');

    const { stdout, stderr } = await runCommandAsync('az', ['login']);

    debugLog('[AZ-CLI] Login stdout:', stdout);
    debugLog('[AZ-CLI] Login stderr:', stderr);

    if (stderr && (isCliNotFoundError(stderr) || stderr.includes('ENOENT'))) {
      console.error('[AZ-CLI] Azure CLI not found error detected in stderr');
      const instructions = getInstallationInstructions();
      return {
        success: false,
        message: `Azure CLI not found. Please install Azure CLI first.\n\n${instructions}`,
      };
    }

    if (!stdout.trim() && stderr && isCommandFailure(stderr)) {
      return {
        success: false,
        message: `Failed to initiate login: ${stderr.trim()}`,
      };
    }

    // If we get here, login was initiated successfully
    debugLog('[AZ-CLI] Login initiated successfully');
    return {
      success: true,
      message: 'Login process initiated. Please complete authentication in your browser.',
    };
  } catch (error) {
    console.error('[AZ-CLI] Error initiating Azure login:', error);
    const errorMessage = getErrorMessage(error);

    // Check if it's an ENOENT error
    if (errorMessage.includes('ENOENT') || errorMessage.includes('spawn az ENOENT')) {
      console.error('[AZ-CLI] ENOENT error - Azure CLI command not found');
      const instructions = getInstallationInstructions();
      return {
        success: false,
        message: `Azure CLI not found. Please install Azure CLI first.\n\n${instructions}`,
      };
    }

    return {
      success: false,
      message: `Failed to initiate login: ${errorMessage}`,
    };
  }
}

/**
 * Polls Azure CLI account state and emits progress until success, failure, timeout, or cancellation.
 *
 * @param onStatusChange - Receives each progress or terminal status update.
 * @param intervalMs - Delay between status checks in milliseconds.
 * @returns Function that cancels pending and in-flight monitoring effects.
 */
export function monitorLoginStatus(
  onStatusChange: (status: AzureLoginStatusUpdate) => void,
  intervalMs = LOGIN_POLL_INTERVAL_MS
): () => void {
  let isPolling = true;
  let pollCount = 0;
  let pollingTimeout: ReturnType<typeof setTimeout> | null = null;
  const maxPolls = 60;

  /** Checks account state once and schedules the next check when appropriate. */
  const poll = async () => {
    if (!isPolling) return;
    pollCount++;

    try {
      const status = await getLoginStatus();
      if (!isPolling) return;

      if (status.isLoggedIn) {
        onStatusChange({ isLoggedIn: true, message: 'Login successful!' });
        isPolling = false;
      } else if (status.error && !status.needsRelogin && status.error !== 'Not logged in') {
        onStatusChange({ isLoggedIn: false, message: status.error });
        isPolling = false;
      } else if (pollCount >= maxPolls) {
        onStatusChange({ isLoggedIn: false, message: 'Login timeout. Please try again.' });
        isPolling = false;
      } else {
        const remaining = ((maxPolls - pollCount) * intervalMs) / 1000;
        onStatusChange({
          isLoggedIn: false,
          message: `Waiting for login... (${Math.floor(remaining / 60)}:${String(
            remaining % 60
          ).padStart(2, '0')})`,
        });
        pollingTimeout = setTimeout(poll, intervalMs);
      }
    } catch (error) {
      if (!isPolling) return;
      onStatusChange({ isLoggedIn: false, message: 'Error checking login status' });
      isPolling = false;
    }
  };

  poll();
  return () => {
    isPolling = false;
    if (pollingTimeout) {
      clearTimeout(pollingTimeout);
      pollingTimeout = null;
    }
  };
}

/**
 * Completes Azure CLI login within one shared deadline.
 *
 * @param timeoutMs - Maximum duration for status checks, login initiation, and polling.
 * @returns Whether a usable Azure CLI session was established before the deadline.
 */
export async function login(timeoutMs = LOGIN_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const initialStatus = await waitUntilDeadline(isAzCliLoggedIn(), deadline);
  if (initialStatus === OPERATION_TIMED_OUT) return false;
  if (initialStatus) return true;

  const init = await waitUntilDeadline(initiateLogin(), deadline);
  if (init === OPERATION_TIMED_OUT || !init.success) return false;

  return new Promise(resolve => {
    /** Checks login status once and schedules another bounded check when needed. */
    const poll = async () => {
      const status = await waitUntilDeadline(isAzCliLoggedIn(), deadline);
      if (status === OPERATION_TIMED_OUT) return resolve(false);
      if (status) return resolve(true);

      const remaining = deadline - Date.now();
      if (remaining <= 0) return resolve(false);
      setTimeout(poll, Math.min(LOGIN_POLL_INTERVAL_MS, remaining));
    };
    poll();
  });
}
