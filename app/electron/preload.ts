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
    ];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },

  removeListener: (channel: string, func: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, func);
  },

  // Register AKS cluster
  registerAKSCluster: (
    subscriptionId: string,
    resourceGroup: string,
    clusterName: string,
    isAzureRBACEnabled: boolean,
    managedNamespace?: string
  ): Promise<{ success: boolean; message: string }> => {
    return ipcRenderer.invoke('register-aks-cluster', {
      subscriptionId,
      resourceGroup,
      clusterName,
      isAzureRBACEnabled,
      managedNamespace,
    });
  },

  // Get license file content
  getLicenseFile: (
    filename: 'LICENSE' | 'NOTICE.md'
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    return ipcRenderer.invoke('get-license-file', filename);
  },

  platform: process.platform,
});
