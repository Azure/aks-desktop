// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import type { DisconnectResult, GitHubAuthState } from '../../types/github';
import { getCurrentUser } from './github-api';
import {
  clearTokens,
  loadTokens,
  saveTokens,
  type StoredTokens,
  type TokenResponse,
} from './github-auth';
import { initiateDeviceFlow, refreshDeviceToken, waitForDeviceTokens } from './github-device-flow';
import { isGitHubAccessDenied } from './github-errors';
import { GitHubOAuthError } from './github-oauth-transport';
import { createSessionOctokit } from './github-session-client';

interface Snapshot {
  authState: GitHubAuthState;
  octokit: Octokit | null;
}
interface LoginAttempt {
  owner: symbol;
  controller: AbortController;
  generation: number;
  promise: Promise<void>;
  saving: boolean;
  cancelledGeneration?: number;
}
class SessionError extends Error {}
const listeners = new Set<() => void>();
const owners = new Set<symbol>();
let generation = 0;
let version = 0;
let credentials: StoredTokens | null = null;
let client: Octokit | null = null;
let bootstrapped = false;
let cleanupBlocked = false;
let login: LoginAttempt | null = null;
let refreshTask: { controller: AbortController; promise: Promise<void> } | null = null;
let disconnectTask: Promise<DisconnectResult> | null = null;
let writes: Promise<void> = Promise.resolve();
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let refreshSuppressed = false;

function empty(restoring = false, error: string | null = null): GitHubAuthState {
  return {
    isAuthenticated: false,
    isRestoring: restoring,
    isAuthorizingBrowser: false,
    token: null,
    refreshToken: null,
    expiresAt: null,
    username: null,
    error,
    deviceAuthorization: null,
    isDisconnecting: false,
    disconnectError: null,
    sessionVersion: version,
  };
}
let snapshot: Snapshot = Object.freeze({ authState: Object.freeze(empty(true)), octokit: null });
const current = (expected: number) => generation === expected && !cleanupBlocked;
const usable = () =>
  !cleanupBlocked && credentials !== null && Date.parse(credentials.expiresAt) > Date.now();

function publish(patch: Partial<GitHubAuthState>): void {
  const authState = Object.freeze({ ...snapshot.authState, ...patch, sessionVersion: version });
  snapshot = Object.freeze({
    authState,
    octokit: authState.isAuthenticated && usable() ? client : null,
  });
  listeners.forEach(listener => {
    listener();
  });
}
function stopTimers(): void {
  clearTimeout(refreshTimer);
  clearTimeout(expiryTimer);
}
function invalidate(error: string | null = null): void {
  generation++;
  version++;
  login?.controller.abort();
  login = null;
  refreshTask?.controller.abort();
  refreshTask = null;
  stopTimers();
  credentials = null;
  client = null;
  refreshSuppressed = false;
  bootstrapped = true;
  publish(empty(false, error));
}
function errorMessage(error: unknown): string {
  return error instanceof GitHubOAuthError
    ? error.message
    : 'GitHub authentication failed. Please connect GitHub again.';
}
function tokensFrom(response: TokenResponse): StoredTokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: new Date(Date.now() + response.expiresIn * 1000).toISOString(),
  };
}

/** Every credential write and deletion passes through this one ordering boundary. */
function saveOrdered(
  tokens: StoredTokens,
  expected: number,
  attempt?: LoginAttempt
): Promise<boolean> {
  const operation = writes.then(async () => {
    if (!current(expected)) return false;
    const previous = attempt ? await loadTokens() : null;
    if (!current(expected)) return false;
    if (attempt) attempt.saving = true;
    let saved = false;
    try {
      saved = await saveTokens(tokens);
    } catch {
      /* A failed save never publishes a session. */
    }
    if (attempt?.cancelledGeneration === generation) {
      // Native IPC cannot be aborted once dispatched. Compensate in this same queue
      // before another login can write, preserving the value it replaced.
      let restored = false;
      try {
        restored = previous ? await saveTokens(previous) : (await clearTokens()).success;
      } catch {}
      if (attempt.cancelledGeneration === generation) {
        cleanupBlocked = !restored;
        publish({
          isDisconnecting: false,
          disconnectError: restored
            ? null
            : 'Saved GitHub credentials may remain. Retry disconnect before connecting again.',
        });
      }
    }
    if (attempt) attempt.saving = false;
    return saved && current(expected);
  });
  writes = operation.then(
    () => {},
    () => {}
  );
  return operation;
}

async function establish(
  tokens: StoredTokens,
  expected: number,
  persist: boolean,
  attempt?: LoginAttempt
): Promise<void> {
  if (!current(expected)) return;
  credentials = tokens;
  client = createSessionOctokit(version, () => ({
    sessionVersion: version,
    accessToken: credentials?.accessToken ?? null,
    usable: usable(),
  }));
  const user = await getCurrentUser(client);
  if (!current(expected)) return;
  if (typeof user.login !== 'string' || !user.login.trim())
    throw new SessionError('Invalid GitHub identity');
  if (!usable()) throw new GitHubOAuthError('expired_token');
  if (persist && !(await saveOrdered(tokens, expected, attempt))) {
    if (current(expected)) throw new SessionError('Credential persistence failed');
    return;
  }
  if (!current(expected)) return;
  if (!usable()) throw new GitHubOAuthError('expired_token');
  publish({
    ...empty(),
    isAuthenticated: true,
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    username: user.login,
  });
  armTimers();
}

function armTimers(): void {
  stopTimers();
  if (!owners.size || !credentials || cleanupBlocked || !snapshot.authState.isAuthenticated) return;
  const expected = generation;
  const expiresAt = credentials.expiresAt;
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) {
    publish({ isAuthenticated: false, token: null });
    return;
  }
  expiryTimer = setTimeout(() => {
    if (current(expected) && credentials?.expiresAt === expiresAt) {
      publish({ isAuthenticated: false, token: null });
    }
  }, remaining);
  if (!refreshSuppressed && !refreshTask) {
    refreshTimer = setTimeout(() => {
      void refresh();
    }, Math.max(1, remaining - 5 * 60000));
  }
}

function refresh(): Promise<void> {
  if (refreshTask) return refreshTask.promise;
  if (!credentials || cleanupBlocked) return Promise.resolve();
  const expected = generation;
  const refreshToken = credentials.refreshToken;
  const task = { controller: new AbortController(), promise: Promise.resolve() };
  refreshTask = task;
  task.promise = (async () => {
    try {
      const response = await refreshDeviceToken(refreshToken, task.controller.signal);
      if (!current(expected) || task.controller.signal.aborted) return;
      const next = tokensFrom(response);
      // Dispatches use the rotated credential immediately, including while persistence is pending.
      credentials = next;
      if (!(await saveOrdered(next, expected))) {
        if (current(expected))
          invalidate('GitHub credentials could not be saved. Please connect GitHub again.');
        return;
      }
      if (!current(expected)) return;
      refreshSuppressed = false;
      publish({
        isAuthenticated: true,
        token: next.accessToken,
        refreshToken: next.refreshToken,
        expiresAt: next.expiresAt,
        error: null,
      });
    } catch (error) {
      if (!current(expected) || task.controller.signal.aborted) return;
      if (error instanceof GitHubOAuthError && error.retryable) {
        // Protocol retries are exhausted. Retain valid access until actual expiry, not an endless retry loop.
        refreshSuppressed = true;
        publish({
          isAuthenticated: usable(),
          token: usable() ? credentials?.accessToken ?? null : null,
          error: 'GitHub token refresh temporarily failed. Please try connecting again.',
        });
      } else {
        invalidate(errorMessage(error));
      }
    } finally {
      if (refreshTask === task) {
        refreshTask = null;
        armTimers();
      }
    }
  })();
  return task.promise;
}

async function restore(): Promise<void> {
  const expected = generation;
  publish({ isRestoring: true });
  try {
    const stored = await loadTokens();
    if (!current(expected)) return;
    if (!stored) {
      publish({ isRestoring: false });
      return;
    }
    version++;
    let tokens = stored;
    if (!(Date.parse(stored.expiresAt) > Date.now())) {
      const controller = new AbortController();
      const task = { controller, promise: Promise.resolve() };
      refreshTask = task;
      try {
        tokens = tokensFrom(await refreshDeviceToken(stored.refreshToken, controller.signal));
      } finally {
        if (refreshTask === task) refreshTask = null;
      }
      if (!current(expected) || controller.signal.aborted) return;
      // Refresh consumed the old credential. Preserve its replacement even if
      // the subsequent, independent profile lookup is temporarily unavailable.
      if (!(await saveOrdered(tokens, expected))) {
        if (current(expected)) throw new SessionError('Credential persistence failed');
        return;
      }
    }
    await establish(tokens, expected, false);
  } catch (error) {
    if (!current(expected)) return;
    const retryable =
      error instanceof GitHubOAuthError
        ? error.retryable
        : !(error instanceof SessionError) && !isGitHubAccessDenied(error);
    invalidate(errorMessage(error));
    if (retryable) bootstrapped = false;
  }
}

export const getGitHubSessionSnapshot = (): Snapshot => snapshot;
export function subscribeGitHubSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function isGitHubSessionCurrent(sessionVersion: number): boolean {
  return version === sessionVersion && snapshot.authState.isAuthenticated && usable();
}
export function retainGitHubSession(owner: symbol): () => void {
  owners.add(owner);
  if (!bootstrapped && !cleanupBlocked) {
    bootstrapped = true;
    void restore();
  } else {
    if (snapshot.authState.username && credentials && !usable() && !cleanupBlocked) {
      publish({ isAuthenticated: false, token: null });
      if (!refreshSuppressed) void refresh();
    } else armTimers();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    cancelDeviceLogin(owner);
    owners.delete(owner);
    if (!owners.size) stopTimers();
  };
}

export function startDeviceLogin(owner: symbol): Promise<void> {
  if (
    !owners.has(owner) ||
    cleanupBlocked ||
    disconnectTask ||
    login ||
    snapshot.authState.isRestoring ||
    snapshot.authState.isAuthenticated
  ) {
    return Promise.resolve();
  }
  if (!bootstrapped) {
    bootstrapped = true;
    return restore();
  }
  invalidate();
  const attempt: LoginAttempt = {
    owner,
    controller: new AbortController(),
    generation,
    promise: Promise.resolve(),
    saving: false,
  };
  login = attempt;
  publish({ isAuthorizingBrowser: true });
  attempt.promise = (async () => {
    try {
      const authorization = await initiateDeviceFlow(attempt.controller.signal);
      if (!current(attempt.generation) || attempt.controller.signal.aborted) return;
      const { userCode, verificationUri, expiresAt } = authorization;
      publish({ deviceAuthorization: Object.freeze({ userCode, verificationUri, expiresAt }) });
      const tokens = await waitForDeviceTokens(authorization, attempt.controller.signal);
      if (!current(attempt.generation) || attempt.controller.signal.aborted) return;
      await establish(tokensFrom(tokens), attempt.generation, true, attempt);
    } catch (error) {
      if (current(attempt.generation) && !attempt.controller.signal.aborted)
        invalidate(errorMessage(error));
    } finally {
      if (login === attempt) {
        login = null;
        publish({ isAuthorizingBrowser: false, deviceAuthorization: null });
      }
    }
  })();
  return attempt.promise;
}
function cancelLoginAttempt(): void {
  const attempt = login;
  if (!attempt || snapshot.authState.isAuthenticated) return;
  invalidate();
  if (attempt.saving) {
    attempt.cancelledGeneration = generation;
    cleanupBlocked = true;
    publish({ isDisconnecting: true });
  }
}
/** Dismissal/unmount only cancels the attempt initiated by that surface. */
export function cancelDeviceLogin(owner: symbol): void {
  if (login?.owner === owner) cancelLoginAttempt();
}
/** An explicit user Cancel acts on the shared attempt visible in every retained view. */
export function abortDeviceLogin(owner: symbol): void {
  if (owners.has(owner)) cancelLoginAttempt();
}

export function disconnectGitHub(): Promise<DisconnectResult> {
  if (disconnectTask) return disconnectTask;
  cleanupBlocked = true;
  invalidate();
  publish({ isDisconnecting: true });
  const operation = writes.then(async (): Promise<DisconnectResult> => {
    let result: DisconnectResult;
    try {
      result = await clearTokens();
    } catch {
      result = { success: false, reason: 'storage-failed' };
    }
    cleanupBlocked = !result.success;
    publish({
      isDisconnecting: false,
      disconnectError: result.success
        ? null
        : 'Saved GitHub credentials may remain. Retry disconnect before connecting again.',
    });
    return result;
  });
  writes = operation.then(
    () => {},
    () => {}
  );
  disconnectTask = operation.finally(() => {
    disconnectTask = null;
  });
  return disconnectTask;
}
