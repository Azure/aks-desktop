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

import { contextBridge, ipcRenderer } from 'electron';

// IPC channel constants inlined here because the sandboxed preload environment
// only allows require('electron') — relative module imports are not supported.
const SECURE_STORAGE_SAVE = 'secure-storage-save';
const SECURE_STORAGE_LOAD = 'secure-storage-load';
const SECURE_STORAGE_DELETE = 'secure-storage-delete';
const GET_INSTALL_ID = 'get-install-id';
const GET_APP_INFO = 'get-app-info';
const GITHUB_OAUTH_START = 'github-oauth-start';
const GITHUB_OAUTH_REFRESH = 'github-oauth-refresh';
const GITHUB_OAUTH_CALLBACK = 'github-oauth-callback';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('desktopApi', {
  send: (channel: string, data: unknown) => {
    // allowed channels
    const validChannels = [
      'setMenu',
      'locale',
      'appConfig',
      'pluginsLoaded',
      'run-command',
      'plugin-manager',
      'request-backend-token',
      'request-plugin-permission-secrets',
      'open-plugin-folder',
      'request-backend-port',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel: string, func: (...args: unknown[]) => void) => {
    const validChannels = [
      'currentMenu',
      'setMenu',
      'locale',
      'appConfig',
      'command-stdout',
      'command-stderr',
      'command-exit',
      'plugin-manager',
      'backend-token',
      'plugin-permission-secrets',
      'open-about-dialog',
      'backend-port',
      GITHUB_OAUTH_CALLBACK,
    ];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => func(...args);
      ipcRenderer.on(channel, wrapper);
      return () => {
        ipcRenderer.removeListener(channel, wrapper);
      };
    }
    return () => {};
  },

  // No-op removeListener for backwards compatibility
  removeListener: () => {},

  // Register AKS cluster
  registerAKSCluster: (
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
    isAzureRBACEnabled: boolean,
    managedNamespace?: string,
    clusterType?: 'aks' | 'aksarc'
  ): Promise<{ success: boolean; message: string }> => {
    return ipcRenderer.invoke('register-aks-cluster', {
      subscriptionId,
      resourceGroup,
      clusterName,
      isAzureRBACEnabled,
      managedNamespace,
      clusterType,
    });
  },

  // Get license file content
  getLicenseFile: (
    filename: 'LICENSE' | 'NOTICE.md'
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('get-license-file', filename);
  },

  // aksd: Per-install UUID for anonymous usage telemetry
  getInstallId: (): Promise<string> => ipcRenderer.invoke(GET_INSTALL_ID),

  // aksd: Host info for telemetry session-start properties
  getAppInfo: (): Promise<{
    os: string;
    osRelease: string;
    arch: string;
    electronVersion: string;
  }> => ipcRenderer.invoke(GET_APP_INFO),

  platform: process.platform,

  // aksd: Secure storage — encrypt/decrypt via Electron safeStorage
  secureStorageSave: (
    key: string,
    value: string
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(SECURE_STORAGE_SAVE, { key, value });
  },

  secureStorageLoad: (
    key: string
  ): Promise<{ success: boolean; value?: string | null; error?: string }> => {
    return ipcRenderer.invoke(SECURE_STORAGE_LOAD, { key });
  },

  secureStorageDelete: (key: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(SECURE_STORAGE_DELETE, { key });
  },

  // aksd: GitHub OAuth web flow
  startGitHubOAuth: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(GITHUB_OAUTH_START);
  },

  onGitHubOAuthCallback: (
    callback: (result: {
      success: boolean;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: string;
      error?: string;
    }) => void
  ): (() => void) => {
    const wrapper = (_event: unknown, result: unknown) => callback(result as any);
    ipcRenderer.on(GITHUB_OAUTH_CALLBACK, wrapper);
    return () => ipcRenderer.removeListener(GITHUB_OAUTH_CALLBACK, wrapper);
  },

  // aksd: GitHub OAuth token refresh via main process (avoids CORS / proxy)
  refreshGitHubOAuth: (
    refreshToken: string
  ): Promise<{
    success: boolean;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    error?: string;
  }> => {
    return ipcRenderer.invoke(GITHUB_OAUTH_REFRESH, { refreshToken });
  },
});
