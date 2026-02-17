// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { secureStorageDelete, secureStorageLoad, secureStorageSave } from './secure-storage';

// GitHub App public client ID and slug — safe to embed in desktop app
// TODO: Replace with production app slug before release
const GITHUB_APP_CLIENT_ID = 'Iv23liWWbvrfIrA6WWj5';
const GITHUB_APP_SLUG = 'aks-desktop-testing';
export const GITHUB_APP_INSTALL_URL = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const STORAGE_KEY = 'aks-desktop:github-auth';

export interface DeviceFlowResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

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

function requireString(data: Record<string, unknown>, key: string): string {
  const val = data[key];
  if (typeof val !== 'string') throw new Error(`Missing or invalid field: ${key}`);
  return val;
}

function requireNumber(data: Record<string, unknown>, key: string): number {
  const val = data[key];
  if (typeof val !== 'number') throw new Error(`Missing or invalid field: ${key}`);
  return val;
}

/**
 * Makes a POST request to a GitHub OAuth endpoint via Headlamp's /externalproxy.
 * GitHub's OAuth endpoints don't return Access-Control-Allow-Origin headers,
 * so browser fetch() is blocked. Routing through the backend proxy avoids CORS.
 * Requires the target URL to be allowlisted in app-build-manifest.json proxy-urls.
 */
const githubOAuthPost = async (
  url: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> => {
  const response = await fetch('/externalproxy', {
    method: 'POST',
    headers: {
      'Forward-To': url,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    throw new Error(`GitHub OAuth request failed: ${response.statusText}`);
  }

  const text = await response.text();
  if (!text) {
    throw new Error('No response from GitHub OAuth endpoint');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from GitHub: ${text.slice(0, 200)}`);
  }
};

/**
 * Initiates the GitHub OAuth device flow.
 * Calls POST https://github.com/login/device/code with the client ID.
 * Returns the device code, user code, verification URI, and polling interval.
 */
export const initiateDeviceFlow = async (): Promise<DeviceFlowResponse> => {
  const data = await githubOAuthPost(DEVICE_CODE_URL, { client_id: GITHUB_APP_CLIENT_ID });

  if (data.error) {
    throw new Error(
      `Device flow initiation failed: ${
        (data.error_description as string) || (data.error as string)
      }`
    );
  }

  return {
    deviceCode: requireString(data, 'device_code'),
    userCode: requireString(data, 'user_code'),
    verificationUri: requireString(data, 'verification_uri'),
    expiresIn: requireNumber(data, 'expires_in'),
    interval: requireNumber(data, 'interval'),
  };
};

/**
 * Makes a single request to exchange the device code for an access token.
 * Returns { accessToken, refreshToken, expiresIn } on success.
 * Throws with error message matching the GitHub error type:
 *   'authorization_pending' (caller should keep polling),
 *   'slow_down' (caller increases interval),
 *   'expired_token' (flow expired),
 *   'access_denied' (user rejected)
 */
export const requestAccessToken = async (deviceCode: string): Promise<TokenResponse> => {
  const data = await githubOAuthPost(ACCESS_TOKEN_URL, {
    client_id: GITHUB_APP_CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  if (data.error) {
    throw new Error(data.error as string);
  }

  return {
    accessToken: requireString(data, 'access_token'),
    refreshToken: requireString(data, 'refresh_token'),
    expiresIn: requireNumber(data, 'expires_in'),
  };
};

/**
 * Uses the refresh token to get a new access token.
 * Returns { accessToken, refreshToken, expiresIn }.
 */
export const refreshAccessToken = async (refreshToken: string): Promise<TokenResponse> => {
  const data = await githubOAuthPost(ACCESS_TOKEN_URL, {
    client_id: GITHUB_APP_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  if (data.error) {
    throw new Error(
      `Token refresh failed: ${(data.error_description as string) || (data.error as string)}`
    );
  }

  return {
    accessToken: requireString(data, 'access_token'),
    refreshToken: requireString(data, 'refresh_token'),
    expiresIn: requireNumber(data, 'expires_in'),
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
  if (
    typeof (parsed as Record<string, unknown>)?.accessToken !== 'string' ||
    typeof (parsed as Record<string, unknown>)?.refreshToken !== 'string' ||
    typeof (parsed as Record<string, unknown>)?.expiresAt !== 'string'
  ) {
    return null;
  }
  return parsed as StoredTokens;
}

/**
 * Persists tokens using Electron safeStorage (OS-level encryption).
 * If secure storage is unavailable, tokens are not persisted — they remain
 * usable for the current session but will require re-authentication next time.
 */
export const saveTokens = async (tokens: StoredTokens): Promise<void> => {
  await secureStorageSave(STORAGE_KEY, JSON.stringify(tokens));
};

/**
 * Loads saved tokens from Electron safeStorage.
 * Returns null if secure storage is unavailable or tokens are missing/corrupted.
 */
export const loadTokens = async (): Promise<StoredTokens | null> => {
  const secure = await secureStorageLoad(STORAGE_KEY);
  if (!secure) return null;
  try {
    return validateTokens(JSON.parse(secure));
  } catch {
    return null;
  }
};

/**
 * Removes saved tokens from secure storage.
 */
export const clearTokens = async (): Promise<void> => {
  await secureStorageDelete(STORAGE_KEY);
};
