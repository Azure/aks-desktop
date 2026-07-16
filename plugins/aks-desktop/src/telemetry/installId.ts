// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

const KEY = 'aksdInstallId';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * In-memory cache so the install ID is stable within a session even when
 * localStorage.setItem throws (quota, private mode). Without this, repeated
 * calls in a degraded environment would mint a new UUID each time and split
 * one user into many in App Insights.
 */
let cachedInstallId: string | undefined;

/**
 * Return the per-install UUID, generating and persisting one if needed.
 *
 * Backed by renderer localStorage with an in-memory fallback cache. A
 * corrupt/non-v4 stored value is regenerated. If localStorage is unavailable
 * (private mode, quota, etc.), the freshly minted UUID is cached for the
 * lifetime of the module so subsequent calls return the same value — the
 * contract is "approximately per install", with session-level stability as
 * the floor.
 *
 * Pseudonymous: never concatenated with PII before use as an App Insights
 * correlation key.
 */
export function getOrCreateInstallId(): string {
  if (cachedInstallId) return cachedInstallId;

  try {
    const existing = localStorage.getItem(KEY);
    if (existing && UUID_V4_RE.test(existing)) {
      cachedInstallId = existing;
      return existing;
    }
  } catch {
    // localStorage.getItem can throw if storage is disabled. Fall through.
  }

  const fresh = crypto.randomUUID();
  // Cache BEFORE attempting setItem so a throw still produces a stable ID.
  cachedInstallId = fresh;
  try {
    localStorage.setItem(KEY, fresh);
  } catch {
    // Quota or storage disabled — session-only via cachedInstallId.
  }
  return fresh;
}

/**
 * Test-only: clear the in-memory cache so each test starts from a clean
 * slate. Not part of the public runtime contract.
 */
export function __resetInstallIdCacheForTests(): void {
  cachedInstallId = undefined;
}
