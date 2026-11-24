// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { LOGIN_POLL_INTERVAL_MS, LOGIN_TIMEOUT_MS } from '../constants/timing';
import {
  getErrorMessage,
  isAzError,
  isCliNotFoundError,
  needsRelogin,
  runCommandAsync,
} from './az-cli-core';
import { getInstallationInstructions } from './az-cli-path';
import { AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT } from './az-token';
import {
  getNativeAccount,
  getNativeLoginError,
  hasNativeSession,
  initiateNativeLogin,
  isAzureExplicitlySignedOut,
  synchronizeNativeLogin,
} from './native-auth';

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
  /** Named CLI cloud containing this account. */
  environmentName?: string;
  /** Whether Azure CLI explicitly requires another login. */
  needsRelogin?: boolean;
  /** Actionable status error when account lookup fails. */
  error?: string;
}

/** Result returned after initiating authentication. */
export interface AzureLoginResult {
  /** Whether the login command completed without a terminal command error. */
  success: boolean;
  /** User-facing description of the result. */
  message: string;
  /** Device code to display while native authentication is pending. */
  userCode?: string;
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
async function readLoginStatus(subscriptionId?: string): Promise<AzureLoginStatus> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', [
      'account',
      'show',
      ...(subscriptionId ? ['--subscription', subscriptionId] : []),
      '-o',
      'json',
    ]);
    const accountOutput = stdout.trim();
    const errorOutput = stderr.trim();

    if (errorOutput && isCliNotFoundError(errorOutput)) {
      const instructions = getInstallationInstructions();
      return {
        isLoggedIn: false,
        error: `Azure CLI could not be started.\n\n${instructions}`,
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
        ...(typeof (account.cloudName ?? account.environmentName) === 'string'
          ? { environmentName: account.cloudName ?? account.environmentName }
          : {}),
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

let observedAccount: string | undefined;
let latestAccountObservation: Promise<AzureLoginStatus> | undefined;
const observedSubscriptionAccounts = new Map<string, { identity: string; tenantId?: string }>();
const latestSubscriptionObservations = new Map<string, Promise<AzureLoginStatus>>();

/**
 * Reads the current account and invalidates cached authentication on external changes.
 * Overlapping reads follow the newest observation instead of publishing stale results.
 * @returns Validated account status; lookup failures invalidate the previous context.
 */
export async function getLoginStatus(): Promise<AzureLoginStatus> {
  if (hasNativeSession() && !getNativeAccount()) await synchronizeNativeLogin();
  const nativeAccount = getNativeAccount();
  const nativeLoginError = getNativeLoginError();
  const readStatus = nativeAccount
    ? Promise.resolve({ isLoggedIn: true, ...nativeAccount })
    : isAzureExplicitlySignedOut()
    ? Promise.resolve({ isLoggedIn: false, error: 'Not logged in' })
    : hasNativeSession()
    ? Promise.resolve({
        isLoggedIn: false,
        needsRelogin: !nativeLoginError,
        error: nativeLoginError ?? 'Not logged in',
      })
    : readLoginStatus().then(status => {
        const account = getNativeAccount();
        if (account) return { isLoggedIn: true, ...account };
        if (isAzureExplicitlySignedOut()) return { isLoggedIn: false, error: 'Not logged in' };
        if (hasNativeSession()) {
          const error = getNativeLoginError();
          return {
            isLoggedIn: false,
            needsRelogin: !error,
            error: error ?? 'Not logged in',
          };
        }

        return status;
      });
  const observation: Promise<AzureLoginStatus> = readStatus.then(status => {
    if (latestAccountObservation && latestAccountObservation !== observation) {
      return latestAccountObservation;
    }
    const identity = JSON.stringify([
      status.isLoggedIn,
      status.username,
      status.tenantId,
      status.subscriptionId,
      status.environmentName,
    ]);
    if (identity !== observedAccount) {
      observedAccount = identity;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('azure-account-change'));
      }
    }
    return status;
  });
  latestAccountObservation = observation;
  return observation;
}

/**
 * Reads the CLI account selected by a subscription without changing the active account.
 * This path is used only when no native session exists and remains subject to explicit sign-out.
 * Observations invalidate only that subscription's credentials and follow the newest read.
 */
export async function getSubscriptionLoginStatus(
  subscriptionId: string
): Promise<AzureLoginStatus> {
  if (hasNativeSession()) {
    return { isLoggedIn: false, error: 'Native Azure authentication is active' };
  }
  if (isAzureExplicitlySignedOut()) {
    return { isLoggedIn: false, error: 'Not logged in' };
  }
  const key = subscriptionId.toLowerCase();
  const observation: Promise<AzureLoginStatus> = readLoginStatus(subscriptionId).then(status => {
    const latest = latestSubscriptionObservations.get(key);
    if (latest && latest !== observation) return latest;
    if (hasNativeSession()) {
      return { isLoggedIn: false, error: 'Native Azure authentication is active' };
    }
    if (isAzureExplicitlySignedOut()) {
      return { isLoggedIn: false, error: 'Not logged in' };
    }
    const identity = JSON.stringify([
      status.isLoggedIn,
      status.username,
      status.tenantId,
      status.subscriptionId,
      status.environmentName,
    ]);
    const previous = observedSubscriptionAccounts.get(key);
    if (previous?.identity !== identity) {
      observedSubscriptionAccounts.set(key, { identity, tenantId: status.tenantId });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('azure-account-change', { detail: { subscriptionIds: [key] } })
        );
        if (
          previous?.tenantId &&
          status.tenantId &&
          previous.tenantId.toLowerCase() !== status.tenantId.toLowerCase()
        ) {
          window.dispatchEvent(
            new CustomEvent(AZURE_SUBSCRIPTION_TENANT_CHANGE_EVENT, {
              detail: { subscriptionIds: [key] },
            })
          );
        }
      }
    }
    return status;
  });
  latestSubscriptionObservations.set(key, observation);
  return observation;
}

/**
 * Starts native Azure login.
 *
 * @param signal - Cancels an in-progress native login.
 * @param selectedCloud - Explicit native cloud selection; otherwise use the CLI's active cloud.
 * @returns Login initiation result with a user-facing message.
 */
export async function initiateLogin(
  signal?: AbortSignal,
  selectedCloud?: string
): Promise<AzureLoginResult> {
  try {
    const cloudName = selectedCloud ?? (await getActiveLoginCloud(signal));
    if (signal?.aborted) throw new Error('Azure login was cancelled');
    const prompt = await initiateNativeLogin(signal, cloudName);
    return {
      success: true,
      message: prompt.message,
      userCode: prompt.userCode,
    };
  } catch (error) {
    console.error('Error initiating Azure login:', error);
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      message: `Failed to initiate login: ${errorMessage}`,
    };
  }
}

async function getActiveLoginCloud(signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Azure login was cancelled');
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Azure login was cancelled'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const { stdout, stderr } = await Promise.race([
      runCommandAsync('az', ['cloud', 'show', '--output', 'json']),
      cancelled,
    ]);
    if (isCliNotFoundError(stderr) || stderr.trim() === 'pluginRunCommand is not available.') {
      return 'AzureCloud';
    }
    if (isCommandFailure(stderr)) {
      throw new Error(`Could not determine the selected Azure CLI cloud: ${stderr.trim()}`);
    }
    let cloud: unknown;
    try {
      cloud = JSON.parse(stdout);
    } catch {
      throw new Error('Could not determine the selected Azure CLI cloud.');
    }
    if (
      !cloud ||
      typeof cloud !== 'object' ||
      typeof (cloud as { name?: unknown }).name !== 'string' ||
      !(cloud as { name: string }).name.trim()
    ) {
      throw new Error('Could not determine the selected Azure CLI cloud.');
    }
    return (cloud as { name: string }).name;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Reads native authentication status without falling back to an existing CLI account. */
export async function getNativeLoginStatus(): Promise<AzureLoginStatus> {
  await synchronizeNativeLogin();
  const account = getNativeAccount();
  const error = getNativeLoginError();
  return Promise.resolve(
    account
      ? { isLoggedIn: true, ...account }
      : { isLoggedIn: false, needsRelogin: !error, error: error ?? 'Not logged in' }
  );
}

/** Reads the CLI account independently of native authentication. */
export function getCliLoginStatus(subscriptionId?: string): Promise<AzureLoginStatus> {
  return readLoginStatus(subscriptionId);
}

let pendingCliLogin: Promise<AzureLoginResult> | undefined;

/**
 * Signs into Azure CLI with its browser-based flow and current selected cloud.
 * The bridge returns only when the command exits, so callers must show pending UI.
 */
export function initiateCliLogin(): Promise<AzureLoginResult> {
  if (!pendingCliLogin) {
    pendingCliLogin = runCliLogin().finally(() => {
      pendingCliLogin = undefined;
    });
  }
  return pendingCliLogin;
}

async function runCliLogin(): Promise<AzureLoginResult> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', ['login', '--output', 'json']);
    if (isCliNotFoundError(stderr)) {
      return {
        success: false,
        message: `Azure CLI could not be started.\n\n${getInstallationInstructions()}`,
      };
    }
    if (isCommandFailure(stderr)) {
      return { success: false, message: stderr.trim() };
    }
    let accounts: unknown;
    try {
      accounts = JSON.parse(stdout);
    } catch {
      return { success: false, message: stderr.trim() || 'Azure CLI login did not complete.' };
    }
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return {
        success: false,
        message: stderr.trim() || 'Azure CLI login did not return an account.',
      };
    }
    const native = getNativeAccount();
    const status = await getCliLoginStatus(native?.subscriptionId);
    if (!status.isLoggedIn) {
      return { success: false, message: status.error || 'Azure CLI login did not complete.' };
    }
    if (native) {
      if (native !== getNativeAccount()) {
        return {
          success: false,
          message: 'Azure account changed during CLI sign-in. Please retry.',
        };
      }
      if (
        !native.username ||
        !status.username ||
        !native.environmentName ||
        !status.environmentName
      ) {
        return {
          success: false,
          message:
            'Unable to verify that Azure CLI and native sign-in use the same account and cloud.',
        };
      }
      if (
        native.username.toLowerCase() !== status.username.toLowerCase() ||
        native.tenantId.toLowerCase() !== status.tenantId?.toLowerCase() ||
        native.subscriptionId.toLowerCase() !== status.subscriptionId?.toLowerCase() ||
        native.environmentName.toLowerCase() !== status.environmentName.toLowerCase()
      ) {
        return {
          success: false,
          message:
            'Azure CLI signed in with a different account, tenant, or cloud. Sign in again with the same account and cloud.',
        };
      }
    }
    return { success: true, message: 'Azure CLI sign-in successful.' };
  } catch (error) {
    return { success: false, message: `Azure CLI sign-in failed: ${getErrorMessage(error)}` };
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
 * Completes Azure login within one shared deadline.
 *
 * @param timeoutMs - Maximum duration for status checks, login initiation, and polling.
 * @returns Whether a usable Azure session was established before the deadline.
 */
export async function login(timeoutMs = LOGIN_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const initialStatus = await waitUntilDeadline(getNativeLoginStatus(), deadline);
  if (initialStatus === OPERATION_TIMED_OUT) return false;
  if (initialStatus.isLoggedIn) return true;

  const controller = new AbortController();
  const init = await waitUntilDeadline(initiateLogin(controller.signal), deadline);
  if (init === OPERATION_TIMED_OUT || !init.success) {
    controller.abort();
    return false;
  }

  return new Promise(resolve => {
    /** Checks login status once and schedules another bounded check when needed. */
    const poll = async () => {
      const status = await waitUntilDeadline(getNativeLoginStatus(), deadline);
      if (status === OPERATION_TIMED_OUT) {
        controller.abort();
        return resolve(false);
      }
      if (status.isLoggedIn) return resolve(true);

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        controller.abort();
        return resolve(false);
      }
      setTimeout(poll, Math.min(LOGIN_POLL_INTERVAL_MS, remaining));
    };
    poll();
  });
}
