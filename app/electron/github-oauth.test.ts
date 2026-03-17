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

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock electron modules before importing the module under test
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-userdata' },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: vi.fn(),
}));

vi.mock('./secure-storage', () => ({
  handleSecureStorageSave: vi.fn(() => ({ success: true })),
}));

import { ipcMain, shell } from 'electron';
import { afterAll, afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import {
  DEV_CALLBACK_PORT,
  DEV_REDIRECT_URI,
  getDevServer,
  getPendingState,
  handleOAuthCallback,
  setPendingState,
  setupGitHubOAuthHandlers,
  STORAGE_KEY,
} from './github-oauth';
import { GITHUB_OAUTH_CALLBACK, GITHUB_OAUTH_REFRESH, GITHUB_OAUTH_START } from './ipc-channels';
import { handleSecureStorageSave } from './secure-storage';

/** Saves original fetch so tests can restore it after spying. */
const originalFetch = global.fetch;

function createMockMainWindow() {
  return {
    webContents: {
      send: vi.fn(),
    },
    focus: vi.fn(),
  } as any;
}

function mockFetchResponse(data: any, ok = true, status = 200) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok, status, json: () => Promise.resolve(data) })
  ) as any;
}

function restoreFetch() {
  global.fetch = originalFetch;
}

const TEST_REDIRECT_URI = 'test-app://oauth/callback';

describe('handleOAuthCallback', () => {
  let mockMainWindow: ReturnType<typeof createMockMainWindow>;

  beforeEach(() => {
    mockMainWindow = createMockMainWindow();
    setPendingState(null);
    (handleSecureStorageSave as Mock).mockClear();
    mockMainWindow.webContents.send.mockClear();
    mockMainWindow.focus.mockClear();
  });

  afterEach(() => {
    setPendingState(null);
    restoreFetch();
  });

  it('rejects mismatched CSRF state', async () => {
    setPendingState('expected-state');

    const url = new URL('test-app://oauth/callback?code=test-code&state=wrong-state');
    await handleOAuthCallback(url, mockMainWindow, TEST_REDIRECT_URI);

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(GITHUB_OAUTH_CALLBACK, {
      success: false,
      error: 'State mismatch — possible CSRF attack',
    });
    expect(mockMainWindow.focus).toHaveBeenCalled();
  });

  it('rejects missing code parameter', async () => {
    setPendingState('some-state');

    const url = new URL('test-app://oauth/callback?state=some-state');
    await handleOAuthCallback(url, mockMainWindow, TEST_REDIRECT_URI);

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(GITHUB_OAUTH_CALLBACK, {
      success: false,
      error: 'Missing authorization code',
    });
    expect(mockMainWindow.focus).toHaveBeenCalled();
  });

  it('rejects when no pending flow exists', async () => {
    // pendingState is null by default
    const url = new URL('test-app://oauth/callback?code=test-code&state=some-state');
    await handleOAuthCallback(url, mockMainWindow, TEST_REDIRECT_URI);

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(GITHUB_OAUTH_CALLBACK, {
      success: false,
      error: 'No pending OAuth flow',
    });
    expect(mockMainWindow.focus).toHaveBeenCalled();
  });

  it('exchanges code for tokens and sends success to renderer', async () => {
    setPendingState('valid-state');

    mockFetchResponse({
      access_token: 'ghu_test_access_token',
      refresh_token: 'ghr_test_refresh_token',
      expires_in: 28800,
    });

    const url = new URL('test-app://oauth/callback?code=auth-code-123&state=valid-state');
    await handleOAuthCallback(url, mockMainWindow, TEST_REDIRECT_URI);

    const sendCall = mockMainWindow.webContents.send.mock.calls[0];
    expect(sendCall[0]).toBe(GITHUB_OAUTH_CALLBACK);
    expect(sendCall[1].success).toBe(true);
    expect(sendCall[1].accessToken).toBe('ghu_test_access_token');
    expect(sendCall[1].refreshToken).toBe('ghr_test_refresh_token');
    expect(sendCall[1].expiresAt).toBeDefined();
    expect(mockMainWindow.focus).toHaveBeenCalled();

    // State should be cleared after successful flow
    expect(getPendingState()).toBeNull();
  });

  it('saves tokens to secure storage on success', async () => {
    setPendingState('valid-state');

    mockFetchResponse({
      access_token: 'ghu_access',
      refresh_token: 'ghr_refresh',
      expires_in: 3600,
    });

    const url = new URL('test-app://oauth/callback?code=code-456&state=valid-state');
    await handleOAuthCallback(url, mockMainWindow, TEST_REDIRECT_URI);

    expect(handleSecureStorageSave).toHaveBeenCalledWith(
      expect.stringContaining('secure-storage.json'),
      STORAGE_KEY,
      expect.stringContaining('"accessToken":"ghu_access"')
    );
  });

  it('propagates error from GitHub token endpoint to renderer', async () => {
    setPendingState('valid-state');

    mockFetchResponse({
      error: 'bad_verification_code',
      error_description: 'The code passed is incorrect or expired.',
    });

    const url = new URL('test-app://oauth/callback?code=expired-code&state=valid-state');
    await handleOAuthCallback(url, mockMainWindow, TEST_REDIRECT_URI);

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(GITHUB_OAUTH_CALLBACK, {
      success: false,
      error: 'The code passed is incorrect or expired.',
    });
  });

  it('reports non-ok HTTP responses from GitHub', async () => {
    setPendingState('valid-state');

    mockFetchResponse({}, false, 502);

    const url = new URL('test-app://oauth/callback?code=code-789&state=valid-state');
    await handleOAuthCallback(url, mockMainWindow, TEST_REDIRECT_URI);

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(GITHUB_OAUTH_CALLBACK, {
      success: false,
      error: 'GitHub token endpoint returned HTTP 502',
    });
  });
});

describe('github-oauth-refresh handler', () => {
  let refreshHandler: (...args: any[]) => any;

  beforeEach(() => {
    // Register handlers and capture them
    const mockIpcMain = ipcMain as any;
    mockIpcMain.handle.mockClear();
    (handleSecureStorageSave as Mock).mockClear();

    setupGitHubOAuthHandlers();

    // Find the refresh handler from the registered calls
    const handleCalls = mockIpcMain.handle.mock.calls;
    const refreshCall = handleCalls.find((call: any[]) => call[0] === GITHUB_OAUTH_REFRESH);
    if (refreshCall) {
      refreshHandler = refreshCall[1];
    }
  });

  afterEach(() => {
    restoreFetch();
  });

  it('returns new tokens on successful refresh', async () => {
    mockFetchResponse({
      access_token: 'ghu_new_access',
      refresh_token: 'ghr_new_refresh',
      expires_in: 28800,
    });

    const result = await refreshHandler({}, { refreshToken: 'ghr_old_refresh' });

    expect(result.success).toBe(true);
    expect(result.accessToken).toBe('ghu_new_access');
    expect(result.refreshToken).toBe('ghr_new_refresh');
    expect(result.expiresAt).toBeDefined();
  });

  it('saves refreshed tokens to secure storage', async () => {
    mockFetchResponse({
      access_token: 'ghu_refreshed',
      refresh_token: 'ghr_refreshed',
      expires_in: 3600,
    });

    await refreshHandler({}, { refreshToken: 'ghr_old' });

    expect(handleSecureStorageSave).toHaveBeenCalledWith(
      expect.stringContaining('secure-storage.json'),
      STORAGE_KEY,
      expect.stringContaining('"accessToken":"ghu_refreshed"')
    );
  });

  it('returns error for expired/invalid refresh token', async () => {
    mockFetchResponse({
      error: 'bad_refresh_token',
      error_description: 'The refresh token is invalid or expired.',
    });

    const result = await refreshHandler({}, { refreshToken: 'ghr_expired' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('The refresh token is invalid or expired.');
  });

  it('returns error on network failure', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network error'))) as any;

    const result = await refreshHandler({}, { refreshToken: 'ghr_test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('returns error on non-ok HTTP response', async () => {
    mockFetchResponse({}, false, 500);

    const result = await refreshHandler({}, { refreshToken: 'ghr_test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 500');
  });
});

describe('dev callback server', () => {
  let startHandler: (...args: any[]) => any;
  let mockMainWindow: ReturnType<typeof createMockMainWindow>;

  beforeEach(() => {
    mockMainWindow = createMockMainWindow();
    const mockIpcMain = ipcMain as any;
    mockIpcMain.handle.mockClear();
    (handleSecureStorageSave as Mock).mockClear();

    setupGitHubOAuthHandlers({ isDev: true, getMainWindow: () => mockMainWindow });

    const handleCalls = mockIpcMain.handle.mock.calls;
    const startCall = handleCalls.find((call: any[]) => call[0] === GITHUB_OAUTH_START);
    if (startCall) {
      startHandler = startCall[1];
    }
  });

  afterEach(() => {
    const server = getDevServer();
    if (server) {
      server.close();
    }
    setPendingState(null);
    restoreFetch();
  });

  afterAll(() => {
    const server = getDevServer();
    if (server) {
      server.close();
    }
  });

  it('starts a localhost HTTP server when auth begins', async () => {
    await startHandler();

    const server = getDevServer();
    expect(server).not.toBeNull();

    // Wait for the server to actually start listening
    await new Promise<void>(resolve => {
      if (server!.listening) {
        resolve();
      } else {
        server!.on('listening', resolve);
      }
    });

    expect(server!.listening).toBe(true);
    const addr = server!.address();
    expect(addr).not.toBeNull();
    expect(typeof addr === 'object' && addr?.port).toBe(DEV_CALLBACK_PORT);

    server!.close();
  });

  it('uses DEV_REDIRECT_URI for the authorization URL in dev mode', async () => {
    (shell.openExternal as Mock).mockClear();

    await startHandler();

    expect(shell.openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(DEV_REDIRECT_URI))
    );

    const server = getDevServer();
    if (server) server.close();
  });

  it('passes DEV_REDIRECT_URI to handleOAuthCallback for token exchange', async () => {
    setPendingState('dev-state');

    mockFetchResponse({
      access_token: 'ghu_dev_access',
      refresh_token: 'ghr_dev_refresh',
      expires_in: 28800,
    });

    // Call handleOAuthCallback directly with DEV_REDIRECT_URI (simulating what the server does)
    const url = new URL(
      `http://localhost:${DEV_CALLBACK_PORT}/oauth/callback?code=dev-code&state=dev-state`
    );
    await handleOAuthCallback(url, mockMainWindow, DEV_REDIRECT_URI);

    // Verify the fetch call uses the dev redirect URI
    const fetchCall = (global.fetch as Mock).mock.calls[0] as any[];
    const fetchBody = fetchCall[1].body;
    expect(fetchBody).toContain(encodeURIComponent(DEV_REDIRECT_URI).replace(/%/g, '%'));
    expect(fetchBody).toContain('redirect_uri=' + encodeURIComponent(DEV_REDIRECT_URI));

    // Verify tokens were sent to renderer
    const sendCall = mockMainWindow.webContents.send.mock.calls[0];
    expect(sendCall[0]).toBe(GITHUB_OAUTH_CALLBACK);
    expect(sendCall[1].success).toBe(true);
    expect(sendCall[1].accessToken).toBe('ghu_dev_access');
  });
});
