/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Portions (c) Microsoft Corp.

// aksd: GitHub OAuth web flow — handles auth start, deep-link callback, and token refresh
// entirely in the Electron main process to avoid CORS issues and eliminate the backend proxy.
//
// In production the callback arrives via the `headlamp://oauth/callback` custom URL scheme.
// In dev mode (ELECTRON_DEV) we spin up a temporary localhost HTTP server instead, because
// custom URL schemes are not registered during development (especially under WSL2).

import crypto from 'crypto';
import type { BrowserWindow } from 'electron';
import { app, ipcMain, shell } from 'electron';
import http from 'http';
import path from 'path';
import { GITHUB_OAUTH_CALLBACK, GITHUB_OAUTH_REFRESH, GITHUB_OAUTH_START } from './ipc-channels';
import { handleSecureStorageSave } from './secure-storage';

export const CLIENT_ID = 'Iv23liWWbvrfIrA6WWj5';
// The client secret is embedded intentionally. Native/desktop apps are "public clients" that
// cannot keep secrets — any user can extract them from the binary. Per RFC 8252 §8.5
// (https://datatracker.ietf.org/doc/html/rfc8252#section-8.5), secrets shipped in distributed
// native apps SHOULD NOT be treated as confidential. Security relies on the registered redirect
// URI, not the secret. GitHub Desktop, VS Code, and other Electron apps follow this pattern.
export const CLIENT_SECRET = '5a066cc6ca8d2c6f201c45f24f2f4e62905b5d95';
export const REDIRECT_URI = 'headlamp://oauth/callback';
export const DEV_CALLBACK_PORT = 48321;
export const DEV_REDIRECT_URI = `http://localhost:${DEV_CALLBACK_PORT}/oauth/callback`;
export const STORAGE_KEY = 'aks-desktop:github-auth';
export const TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const AUTH_URL = 'https://github.com/login/oauth/authorize';

/** Shape of the JSON response from GitHub's OAuth token endpoint. */
interface GitHubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Module-scoped pending CSRF state (single pending flow at a time). */
let pendingState: string | null = null;

/** Visible for testing — returns the current pending state. */
export function getPendingState(): string | null {
  return pendingState;
}

/**
 * Visible for testing — sets the pending state.
 * @param state - CSRF state string to store, or `null` to clear.
 */
export function setPendingState(state: string | null): void {
  pendingState = state;
}

/**
 * Saves token data to encrypted secure storage.
 * @param accessToken - GitHub OAuth access token.
 * @param refreshToken - GitHub OAuth refresh token.
 * @param expiresAt - ISO-8601 timestamp when the access token expires.
 */
function saveTokens(accessToken: string, refreshToken: string, expiresAt: string): void {
  const storagePath = path.join(app.getPath('userData'), 'secure-storage.json');
  const result = handleSecureStorageSave(
    storagePath,
    STORAGE_KEY,
    JSON.stringify({ accessToken, refreshToken, expiresAt })
  );
  if (!result.success) {
    console.error('Failed to persist tokens to secure storage:', result.error);
  }
}

/** Active dev callback server, if any. */
let devServer: http.Server | null = null;

/** Visible for testing — returns the active dev server. */
export function getDevServer(): http.Server | null {
  return devServer;
}

/** Stops the dev callback server if running. */
function stopDevServer(): void {
  if (devServer) {
    devServer.close();
    devServer = null;
  }
}

/**
 * Starts a temporary localhost HTTP server that handles a single OAuth callback,
 * then shuts itself down. Used in dev mode where custom URL schemes aren't registered.
 */
function startDevCallbackServer(getMainWindow: () => BrowserWindow | null): void {
  stopDevServer();

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/oauth/callback')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const urlObj = new URL(req.url, `http://127.0.0.1:${DEV_CALLBACK_PORT}`);
    const mainWindow = getMainWindow();

    if (!mainWindow) {
      res.writeHead(503);
      res.end('Main window not available');
      return;
    }

    await handleOAuthCallback(urlObj, mainWindow, DEV_REDIRECT_URI);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<html><body><h2>Authorization complete</h2><p>You can close this tab and return to AKS Desktop.</p></body></html>'
    );

    // Shut down after handling the callback
    stopDevServer();
  });

  server.listen(DEV_CALLBACK_PORT, '127.0.0.1', () => {
    console.log(`Dev OAuth callback server listening on http://localhost:${DEV_CALLBACK_PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('Dev OAuth callback server error:', err);
    devServer = null;
  });

  devServer = server;
}

/** Registers IPC handlers for the GitHub OAuth web flow. */
export function setupGitHubOAuthHandlers(options?: {
  isDev?: boolean;
  getMainWindow?: () => BrowserWindow | null;
}): void {
  const isDev = options?.isDev ?? false;
  const getMainWindow = options?.getMainWindow ?? (() => null);
  const redirectUri = isDev ? DEV_REDIRECT_URI : REDIRECT_URI;

  ipcMain.handle(GITHUB_OAUTH_START, async () => {
    try {
      const state = crypto.randomUUID();
      pendingState = state;

      if (isDev) {
        startDevCallbackServer(getMainWindow);
      }

      const scope = encodeURIComponent('repo read:org');
      const url = `${AUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=${scope}&state=${state}`;
      await shell.openExternal(url);

      return { success: true };
    } catch (error) {
      console.error('Failed to start GitHub OAuth flow:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    GITHUB_OAUTH_REFRESH,
    async (_event, { refreshToken }: { refreshToken: string }) => {
      try {
        const body = new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        });

        const response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          return {
            success: false,
            error: `GitHub token endpoint returned HTTP ${response.status}`,
          };
        }

        const {
          access_token: accessToken,
          refresh_token: newRefreshToken,
          expires_in: expiresIn,
          error,
          error_description: errorDescription,
        } = (await response.json()) as GitHubTokenResponse;

        if (error) {
          return { success: false, error: errorDescription || error };
        }

        if (!accessToken || !newRefreshToken) {
          return {
            success: false,
            error: 'GitHub token response missing access or refresh token',
          };
        }

        const expiresAt = new Date(Date.now() + (expiresIn ?? 0) * 1000).toISOString();

        saveTokens(accessToken, newRefreshToken, expiresAt);

        return { success: true, accessToken, refreshToken: newRefreshToken, expiresAt };
      } catch (error) {
        console.error('Failed to refresh GitHub OAuth token:', error);
        return { success: false, error: String(error) };
      }
    }
  );
}

/**
 * Handles the OAuth callback by exchanging the authorization code for tokens.
 * @param url - Callback URL containing `code` and `state` query parameters.
 * @param mainWindow - Electron BrowserWindow to send the result to via IPC.
 * @param redirectUri - Redirect URI used in the token exchange request (must match the one used to start the flow).
 */
export async function handleOAuthCallback(
  url: URL,
  mainWindow: BrowserWindow,
  redirectUri: string = REDIRECT_URI
): Promise<void> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  try {
    if (!code) {
      throw new Error('Missing authorization code');
    }

    if (!pendingState) {
      throw new Error('No pending OAuth flow');
    }

    if (state !== pendingState) {
      throw new Error('State mismatch — possible CSRF attack');
    }

    pendingState = null;

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`GitHub token endpoint returned HTTP ${response.status}`);
    }

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      error,
      error_description: errorDescription,
    } = (await response.json()) as GitHubTokenResponse;

    if (error) {
      throw new Error(errorDescription || error);
    }

    if (!accessToken || !refreshToken) {
      throw new Error('GitHub token response missing access or refresh token');
    }

    const expiresAt = new Date(Date.now() + (expiresIn ?? 0) * 1000).toISOString();

    saveTokens(accessToken, refreshToken, expiresAt);

    mainWindow.webContents.send(GITHUB_OAUTH_CALLBACK, {
      success: true,
      accessToken,
      refreshToken,
      expiresAt,
    });
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    mainWindow.webContents.send(GITHUB_OAUTH_CALLBACK, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  mainWindow.focus();
}
