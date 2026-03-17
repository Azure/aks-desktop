// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { secureStorageDelete, secureStorageLoad, secureStorageSave } from './secure-storage';

// GitHub App slug — used for the app installation URL.
const GITHUB_APP_SLUG =
  typeof process !== 'undefined' && process.env?.AKS_DESKTOP_GITHUB_APP_SLUG
    ? process.env.AKS_DESKTOP_GITHUB_APP_SLUG
    : 'aks-desktop';
export const GITHUB_APP_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;

const STORAGE_KEY = 'aks-desktop:github-auth';
const LOCALSTORAGE_FALLBACK_KEY = 'aks-desktop:github-auth-fallback';

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/** Result shape from the Electron main process OAuth callback. */
export interface OAuthCallbackResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  error?: string;
}

/** desktopApi methods exposed by the Electron preload script. */
interface DesktopApi {
  startGitHubOAuth: () => Promise<{ success: boolean; error?: string }>;
  onGitHubOAuthCallback: (callback: (result: OAuthCallbackResult) => void) => () => void;
  refreshGitHubOAuth: (refreshToken: string) => Promise<OAuthCallbackResult>;
}

function getDesktopApi(): DesktopApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (window as any).desktopApi as DesktopApi | undefined;
  if (!api) throw new Error('desktopApi not available — not running in Electron');
  return api;
}

/**
 * Opens the user's browser to the GitHub OAuth authorize page.
 * The Electron main process generates a CSRF state token and opens the URL.
 */
export const startBrowserOAuth = async (): Promise<void> => {
  const api = getDesktopApi();
  const result = await api.startGitHubOAuth();
  if (!result.success) {
    throw new Error(result.error ?? 'Failed to start GitHub OAuth flow');
  }
};

/**
 * Registers a listener for the OAuth callback from the Electron main process.
 * Returns an unsubscribe function.
 */
export const onOAuthCallback = (callback: (result: OAuthCallbackResult) => void): (() => void) => {
  const api = getDesktopApi();
  return api.onGitHubOAuthCallback(callback);
};

/**
 * Uses the refresh token to get a new access token via the Electron main process.
 * The main process makes the POST request directly (no CORS issues).
 * Returns { accessToken, refreshToken, expiresIn }.
 */
export const refreshAccessToken = async (refreshToken: string): Promise<TokenResponse> => {
  const api = getDesktopApi();
  const result = await api.refreshGitHubOAuth(refreshToken);

  if (!result.success || !result.accessToken || !result.refreshToken || !result.expiresAt) {
    throw new Error(`Token refresh failed: ${result.error ?? 'unknown error'}`);
  }

  const expiresIn = Math.max(
    0,
    Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000)
  );

  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn,
  };
};

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Checks if the access token has expired or will expire within the safety buffer.
 * Uses a 5-minute buffer so callers proactively refresh before actual expiry.
 * Treats invalid or unparsable expiry timestamps as expired for safety.
 */
export const isTokenExpired = (expiresAt: string): boolean => {
  const ts = new Date(expiresAt).getTime();
  if (Number.isNaN(ts)) {
    return true;
  }
  return ts - EXPIRY_BUFFER_MS <= Date.now();
};

/**
 * Validates a parsed JSON object has the expected StoredTokens shape.
 */
function validateTokens(parsed: unknown): StoredTokens | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.accessToken !== 'string' ||
    typeof obj.refreshToken !== 'string' ||
    typeof obj.expiresAt !== 'string'
  ) {
    return null;
  }
  return parsed as StoredTokens;
}

const IS_DEV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';

/**
 * Persists tokens using Electron safeStorage (OS-level encryption).
 * In development mode, falls back to localStorage when secure storage is unavailable.
 */
export const saveTokens = async (tokens: StoredTokens): Promise<void> => {
  const json = JSON.stringify(tokens);
  const saved = await secureStorageSave(STORAGE_KEY, json);
  if (!saved && IS_DEV) {
    try {
      localStorage.setItem(LOCALSTORAGE_FALLBACK_KEY, json);
    } catch {
      // Ignore — tokens remain in React state for the current session
    }
  }
};

/**
 * Loads saved tokens from Electron safeStorage.
 * In development mode, falls back to localStorage.
 * Returns null if tokens are missing/corrupted.
 */
export const loadTokens = async (): Promise<StoredTokens | null> => {
  const secure = await secureStorageLoad(STORAGE_KEY);
  if (secure) {
    try {
      return validateTokens(JSON.parse(secure));
    } catch {
      // Fall through to dev fallback
    }
  }
  if (IS_DEV) {
    try {
      const fallback = localStorage.getItem(LOCALSTORAGE_FALLBACK_KEY);
      if (fallback) return validateTokens(JSON.parse(fallback));
    } catch {
      // Ignore
    }
  }
  return null;
};

/**
 * Removes saved tokens from secure storage (and localStorage in dev mode).
 */
export const clearTokens = async (): Promise<void> => {
  await secureStorageDelete(STORAGE_KEY);
  if (IS_DEV) {
    try {
      localStorage.removeItem(LOCALSTORAGE_FALLBACK_KEY);
    } catch {
      // Ignore
    }
  }
};
