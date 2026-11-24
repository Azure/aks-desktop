// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/identity';
import { openExternalUrl } from '../shared/openExternalUrl';
import {
  allowImplicitAzureCli,
  blockImplicitAzureCli,
  isImplicitAzureCliBlocked,
} from './azure-auth-policy';
import { getNativeCloudConfiguration, NativeCloudConfiguration } from './azure-cloud-config';

interface AzureOAuthResult {
  success: boolean;
  error?: string;
  code?: string;
  sessionExpired?: boolean;
  pending?: boolean;
  account?: { username?: string; tenantId?: string };
  prompt?: NativeLoginPrompt;
  accessToken?: string;
  expiresOnTimestamp?: number;
}

interface PluginAzureOAuth {
  startAzureLogin(cloud: string, scope: string): Promise<AzureOAuthResult>;
  getAzureLoginStatus(): Promise<AzureOAuthResult>;
  getAzureToken(scope: string, tenantId?: string): Promise<AzureOAuthResult>;
  cancelAzureLogin(): Promise<AzureOAuthResult>;
  logoutAzure(): Promise<AzureOAuthResult>;
}

declare const pluginAzureOAuth: PluginAzureOAuth | undefined;

interface NativeAccount {
  username?: string;
  tenantId: string;
  subscriptionId: string;
  environmentName: NativeCloudConfiguration['name'];
}

export interface NativeLoginPrompt {
  userCode: string;
  verificationUri: string;
  message: string;
}

let account: NativeAccount | undefined;
let loginPending = false;
let loginError: string | undefined;
let loginGeneration = 0;
let explicitlySignedOut = false;
let nativeCloud: NativeCloudConfiguration | undefined;
let homeTenantId: string | undefined;
let completion: Promise<void> | undefined;
let removeAbortListener: (() => void) | undefined;

function bridge(): PluginAzureOAuth {
  if (typeof pluginAzureOAuth === 'undefined') {
    throw new Error('Desktop Azure authentication is not available.');
  }
  return pluginAzureOAuth;
}

function dispatchAccountChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('azure-account-change'));
  }
}

function resetNativeSession(): void {
  loginGeneration++;
  account = undefined;
  loginPending = false;
  loginError = undefined;
  nativeCloud = undefined;
  homeTenantId = undefined;
  completion = undefined;
  removeAbortListener?.();
  removeAbortListener = undefined;
}

async function failSession(message: string, signedOut = false): Promise<void> {
  const generation = loginGeneration;
  const cleanup = await bridge().logoutAzure();
  if (generation !== loginGeneration) return;
  resetNativeSession();
  loginError = cleanup.success
    ? message
    : `${message}. Main-process session cleanup failed: ${
        cleanup.error ?? 'Azure authentication failed'
      }`;
  explicitlySignedOut ||= signedOut;
  dispatchAccountChange();
}

async function completeNativeLogin(generation: number): Promise<void> {
  if (!loginPending || generation !== loginGeneration) return;
  const status = await bridge().getAzureLoginStatus();
  if (generation !== loginGeneration) return;
  if (!status.success) {
    await failSession(
      status.error ?? 'Azure authentication failed',
      status.sessionExpired === true
    );
    return;
  }
  if (status.pending) return;
  if (!status.account?.tenantId) {
    await failSession('Azure authentication response did not include a tenant.');
    return;
  }
  homeTenantId = status.account.tenantId;
  const { getSubscriptions } = await import('./az-subscriptions');
  if (generation !== loginGeneration) return;
  const subscriptions = await getSubscriptions(false, { strict: true });
  if (generation !== loginGeneration) return;
  const subscription = subscriptions.find(
    value => value.status === 'Enabled' && typeof value.id === 'string' && value.id
  );
  if (!subscription) {
    await failSession('No enabled Azure subscriptions were found for this account');
    return;
  }
  account = {
    username: status.account.username,
    tenantId: typeof subscription.tenant === 'string' ? subscription.tenant : homeTenantId,
    subscriptionId: subscription.id,
    environmentName: nativeCloud!.name,
  };
  explicitlySignedOut = false;
  loginPending = false;
  removeAbortListener?.();
  removeAbortListener = undefined;
  dispatchAccountChange();
}

/**
 * Starts capability-scoped desktop device authentication without requiring Azure CLI.
 *
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code
 */
export async function initiateNativeLogin(
  signal?: AbortSignal,
  cloudName = 'AzureCloud'
): Promise<NativeLoginPrompt> {
  if (signal?.aborted) throw new Error('Azure login was cancelled');
  const oauth = bridge();
  const cloud = getNativeCloudConfiguration(cloudName);
  if (!blockImplicitAzureCli()) {
    throw new Error(
      'Azure sign-in policy could not be saved; enable application storage and retry.'
    );
  }
  resetNativeSession();
  const generation = loginGeneration;
  nativeCloud = cloud;
  loginPending = true;
  if (signal) {
    const onAbort = () => {
      if (generation !== loginGeneration || !loginPending) return;
      void oauth.cancelAzureLogin();
      resetNativeSession();
      dispatchAccountChange();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  }
  const result = await oauth.startAzureLogin(cloud.name, cloud.arm.scope);
  if (generation !== loginGeneration) {
    throw new Error('Azure login was cancelled');
  }
  if (signal?.aborted) {
    await oauth.cancelAzureLogin();
    throw new Error('Azure login was cancelled');
  }
  if (!result.success || !result.prompt) {
    await failSession(result.error ?? 'Azure authentication failed');
    throw new Error(result.error ?? 'Azure authentication failed');
  }
  openExternalUrl(result.prompt.verificationUri || cloud.deviceLoginUrl);
  return result.prompt;
}

/** Synchronizes pending renderer state with the main-process authentication session. */
export async function synchronizeNativeLogin(): Promise<void> {
  if (!loginPending) return;
  if (!completion) {
    const generation = loginGeneration;
    const operation = completeNativeLogin(generation).catch(async error => {
      if (generation !== loginGeneration) return;
      await failSession(error instanceof Error ? error.message : 'Azure authentication failed');
    });
    const tracked = operation.finally(() => {
      if (completion === tracked) completion = undefined;
    });
    completion = tracked;
  }
  await completion;
}

/** Returns the in-memory account established by native authentication. */
export function getNativeAccount(): NativeAccount | undefined {
  return account;
}

/** Updates the selected subscription tenant after a verified CLI login. */
export function updateNativeAccountTenant(subscriptionId: string, tenantId: string): boolean {
  if (!account || account.subscriptionId.toLowerCase() !== subscriptionId.toLowerCase()) {
    return false;
  }
  if (account.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
    account = { ...account, tenantId };
  }
  return true;
}

/** Returns the latest terminal native-login error, if any. */
export function getNativeLoginError(): string | undefined {
  return loginError;
}

/** Returns whether native login has established or is establishing a session. */
export function hasNativeSession(): boolean {
  return loginPending || account !== undefined;
}

/** Returns the active native cloud, including during subscription discovery. */
export function getNativeCloudName(): NativeCloudConfiguration['name'] | undefined {
  return hasNativeSession() ? nativeCloud?.name : undefined;
}

/** Identifies the current native login attempt or session. */
export function getNativeAuthGeneration(): number {
  return loginGeneration;
}

/** Returns whether sign-out or a terminal credential failure blocks implicit CLI access. */
export function isAzureExplicitlySignedOut(): boolean {
  return explicitlySignedOut || (!hasNativeSession() && isImplicitAzureCliBlocked());
}

/** Allows CLI account discovery following an explicit choice to sign in with the CLI. */
export function allowAzureCliFallback(): void {
  allowImplicitAzureCli();
  explicitlySignedOut = false;
}

/** Signs out and prevents automatic reuse of an Azure CLI account. */
export async function logoutNative(): Promise<boolean> {
  let oauth: PluginAzureOAuth;
  try {
    oauth = bridge();
  } catch (error) {
    if (hasNativeSession()) throw error;
    const persisted = blockImplicitAzureCli();
    resetNativeSession();
    explicitlySignedOut = true;
    dispatchAccountChange();
    return persisted;
  }
  const persisted = blockImplicitAzureCli();
  const generation = loginGeneration;
  const result = await oauth.logoutAzure();
  if (generation !== loginGeneration) {
    throw new Error('Azure account changed during sign-out');
  }
  if (!result.success) {
    throw new Error(result.error ?? 'Azure native sign-out failed');
  }
  resetNativeSession();
  explicitlySignedOut = true;
  dispatchAccountChange();
  return persisted;
}

/** In-memory credential backed by the main-process public-client session. */
export const nativeCredential: TokenCredential = {
  async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken> {
    if (!hasNativeSession()) throw new Error('Azure login is required');
    const scope = Array.isArray(scopes) ? scopes[0] : scopes;
    if (!scope || (Array.isArray(scopes) && scopes.length !== 1)) {
      throw new Error('Exactly one token scope is required');
    }
    const signal = options?.abortSignal;
    const abortError = () =>
      (signal as { reason?: unknown } | undefined)?.reason ??
      new DOMException('Token request was aborted', 'AbortError');
    if (signal?.aborted) throw abortError();
    const load = async () => {
      const generation = loginGeneration;
      const tenantId = options?.tenantId ?? account?.tenantId;
      const result = await bridge().getAzureToken(normalizeNativeScope(scope), tenantId);
      if (generation !== loginGeneration) throw new Error('Azure login was cancelled');
      if (result.sessionExpired) {
        await failSession(result.error ?? 'Azure login expired', true);
        throw new Error(result.error ?? 'Azure token request failed');
      }
      if (signal?.aborted) throw abortError();
      if (
        !result.success ||
        typeof result.accessToken !== 'string' ||
        typeof result.expiresOnTimestamp !== 'number'
      ) {
        throw new Error(result.error ?? 'Azure token request failed');
      }
      return {
        token: result.accessToken,
        expiresOnTimestamp: result.expiresOnTimestamp,
      };
    };
    if (!signal) return load();
    let onAbort: () => void;
    return new Promise<AccessToken>((resolve, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      load().then(resolve, reject);
    }).finally(() => signal.removeEventListener('abort', onAbort!));
  },
};

/**
 * Maps ARM endpoint scopes used by Azure SDK callers to the configured resource identifier.
 *
 * Azure resource identifiers can retain a trailing slash, producing a double slash before
 * `.default`; see https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#trailing-slash-and-default
 */
function normalizeNativeScope(scope: string): string {
  if (!nativeCloud) return scope;
  for (const service of [nativeCloud.arm, nativeCloud.graph]) {
    const endpoint = service.endpoint.replace(/\/+$/, '');
    if (scope === `${endpoint}/.default` || scope === `${endpoint}//.default`) {
      return service.scope;
    }
  }
  return scope;
}
