// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const POLICY_KEY = 'aks-desktop:azure-auth-policy';
const PROBE_KEY = 'aks-desktop:azure-auth-policy-probe';
const CLI_ALLOWED = 'cli-allowed';
const CLI_BLOCKED = 'cli-blocked';

let blockedInMemory = false;
let explicitlyAllowedInMemory = false;
let explicitWriteFailed = false;

/**
 * Persist only the authentication policy, never credentials. Fresh installations
 * retain the historical CLI fallback, but unreadable or unwritable storage fails closed.
 */
export function isImplicitAzureCliBlocked(): boolean {
  if (blockedInMemory) return true;
  try {
    let policy = localStorage.getItem(POLICY_KEY);
    if (explicitWriteFailed && explicitlyAllowedInMemory) return false;
    if (policy !== null && policy !== CLI_ALLOWED && policy !== CLI_BLOCKED) return true;
    // Never rewrite the policy while probing: another renderer may have blocked it.
    if (policy !== CLI_BLOCKED) {
      localStorage.setItem(PROBE_KEY, '1');
      if (localStorage.getItem(PROBE_KEY) !== '1') return true;
      localStorage.removeItem(PROBE_KEY);
      policy = localStorage.getItem(POLICY_KEY);
      if (policy !== null && policy !== CLI_ALLOWED && policy !== CLI_BLOCKED) return true;
    }
    return policy === CLI_BLOCKED;
  } catch {
    return !explicitlyAllowedInMemory;
  }
}

/** Blocks CLI reuse in memory and returns whether the policy was persisted. */
export function blockImplicitAzureCli(): boolean {
  blockedInMemory = true;
  explicitlyAllowedInMemory = false;
  explicitWriteFailed = false;
  try {
    localStorage.setItem(POLICY_KEY, CLI_BLOCKED);
    if (localStorage.getItem(POLICY_KEY) === CLI_BLOCKED) return true;
  } catch {
    // Keep the in-memory block when storage is unavailable.
  }
  console.warn('Could not persist Azure sign-in policy; it may not survive an app reload.');
  return false;
}

/** Records an explicit choice to use Azure CLI after a successful CLI sign-in. */
export function allowImplicitAzureCli(): void {
  blockedInMemory = false;
  explicitlyAllowedInMemory = true;
  try {
    localStorage.setItem(POLICY_KEY, CLI_ALLOWED);
    explicitWriteFailed = false;
  } catch {
    explicitWriteFailed = true;
    console.warn('Could not persist Azure CLI sign-in policy; it may not survive an app reload.');
  }
}
