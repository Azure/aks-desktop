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

import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { executeCommandWithShellEnv } from './runCmd';

interface RegisterAKSClusterResult {
  success: boolean;
  message: string;
}

interface KubeConfig {
  clusters?: Array<{ name: string; [key: string]: any }>;
  contexts?: Array<{ name: string; [key: string]: any }>;
  users?: Array<{ name: string; user?: any }>;
  'current-context'?: string;
  [key: string]: any;
}

/**
 * Get paths for Python and az-kubelogin script based on the current platform.
 */
function getExecutablePaths(
  isDev: boolean,
  resourcesPath: string
): {
  pythonCmd: string;
  azKubeloginPath: string;
  azCliBinPath: string;
  azCliCmd: string;
} {
  const platform = process.platform;
  const externalToolsBinPath = path.join(resourcesPath, 'external-tools', 'bin');

  let pythonCmd: string;
  let azCliBinPath: string;
  let azCliCmd: string;

  if (platform === 'win32') {
    // On Windows, Python is directly in the az-cli\win32 directory
    const azCliWindowsPath = path.join(resourcesPath, 'external-tools', 'az-cli', 'win32');
    pythonCmd = path.join(azCliWindowsPath, 'python.exe');
    azCliBinPath = path.join(azCliWindowsPath, 'bin');
    azCliCmd = path.join(azCliBinPath, 'az.cmd');
  } else {
    // On Unix systems (Linux/macOS), Python is in the bin directory
    azCliBinPath = path.join(resourcesPath, 'external-tools', 'az-cli', platform, 'bin');
    pythonCmd = path.join(azCliBinPath, 'python3');
    azCliCmd = path.join(azCliBinPath, 'az');
  }

  return {
    pythonCmd,
    azKubeloginPath: path.join(externalToolsBinPath, 'az-kubelogin.py'),
    azCliBinPath,
    azCliCmd,
  };
}

/**
 * Add az-kubelogin.py exec configuration to kubeconfig.
 */
function addAzKubeloginToKubeconfig(
  kubeconfigYaml: string,
  isDev: boolean,
  resourcesPath: string
): string {
  let kubeconfig: KubeConfig;
  try {
    kubeconfig = yaml.parse(kubeconfigYaml);
  } catch (error) {
    console.error('[AKS] Error parsing kubeconfig YAML:', error);
    return kubeconfigYaml;
  }

  if (!kubeconfig || !kubeconfig.users) {
    return kubeconfigYaml;
  }

  const { pythonCmd, azKubeloginPath, azCliBinPath, azCliCmd } = getExecutablePaths(
    isDev,
    resourcesPath
  );
  const serverId = '6dae42f8-4368-4678-94ff-3960e28e3630'; // Azure Kubernetes Service AAD Server

  // Add exec configuration to each user
  for (const user of kubeconfig.users) {
    if (user.user) {
      console.log('[AKS] Configuring authentication for user:', user.name);

      // IMPORTANT: Remove ALL old Azure authentication methods
      // These conflict with our exec configuration
      if (user.user['auth-provider']) {
        console.log('[AKS] Removing old auth-provider configuration');
        delete user.user['auth-provider'];
      }

      // Remove any other auth fields that might conflict
      delete user.user.token;
      delete user.user['client-certificate'];
      delete user.user['client-certificate-data'];
      delete user.user['client-key'];
      delete user.user['client-key-data'];

      // Set up exec authentication with our bundled Python script
      // Include PATH and AZ_CLI_PATH in env
      const pathSeparator = process.platform === 'win32' ? ';' : ':';
      const currentPath = process.env.PATH || '';
      const newPath = `${azCliBinPath}${pathSeparator}${currentPath}`;

      user.user.exec = {
        apiVersion: 'client.authentication.k8s.io/v1beta1',
        command: pythonCmd,
        args: [azKubeloginPath, '--server-id', serverId],
        env: [
          {
            name: 'PATH',
            value: newPath,
          },
          {
            name: 'AZ_CLI_PATH',
            value: azCliCmd,
          },
        ],
        provideClusterInfo: false,
      };

      console.log('[AKS] ✅ Added exec configuration using Python script:', azKubeloginPath);
      console.log('[AKS] ✅ Azure CLI path set to:', azCliCmd);
    }
  }

  // Use yaml.stringify with options to preserve strings and prevent line wrapping
  // This ensures paths with spaces are properly quoted and not split across lines
  return yaml.stringify(kubeconfig, {
    lineWidth: 0, // Disable line wrapping
    defaultStringType: 'QUOTE_DOUBLE', // Quote strings to handle spaces properly
  });
}

/**
 * Merge a new cluster config into the existing kubeconfig.
 */
function mergeKubeconfig(existingConfig: string, newConfig: string): KubeConfig {
  let existing: KubeConfig;
  try {
    existing = existingConfig ? yaml.parse(existingConfig) : {};
  } catch {
    existing = {};
  }

  let newCfg: KubeConfig;
  try {
    newCfg = yaml.parse(newConfig);
  } catch (error) {
    console.error('[AKS] Error parsing new kubeconfig:', error);
    return existing;
  }

  // Initialize existing config if empty
  if (!existing || Object.keys(existing).length === 0) {
    return newCfg;
  }

  // Merge clusters
  if (!existing.clusters) {
    existing.clusters = [];
  }
  for (const cluster of newCfg.clusters || []) {
    const idx = existing.clusters.findIndex(c => c.name === cluster.name);
    if (idx >= 0) {
      existing.clusters[idx] = cluster; // Replace
    } else {
      existing.clusters.push(cluster); // Add
    }
  }

  // Merge contexts
  if (!existing.contexts) {
    existing.contexts = [];
  }
  for (const context of newCfg.contexts || []) {
    const idx = existing.contexts.findIndex(c => c.name === context.name);
    if (idx >= 0) {
      existing.contexts[idx] = context; // Replace
    } else {
      existing.contexts.push(context); // Add
    }
  }

  // Merge users
  if (!existing.users) {
    existing.users = [];
  }
  for (const user of newCfg.users || []) {
    const idx = existing.users.findIndex(u => u.name === user.name);
    if (idx >= 0) {
      existing.users[idx] = user; // Replace
    } else {
      existing.users.push(user); // Add
    }
  }

  // Set current context to the new cluster
  if (newCfg['current-context']) {
    existing['current-context'] = newCfg['current-context'];
  }

  return existing;
}

/**
 * Register an AKS cluster by running az aks get-credentials and configuring authentication.
 *
 * @param subscriptionId - Azure subscription ID
 * @param resourceGroup - Azure resource group name
 * @param clusterName - AKS cluster name
 * @param isDev - Whether running in development mode
 * @param resourcesPath - Path to resources directory
 * @param managedNamespace - Optional managed namespace name to use for scoped credentials
 * @returns Promise with success status and message
 */
export async function registerAKSCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  isAzureRBACEnabled: boolean,
  isDev: boolean,
  resourcesPath: string,
  managedNamespace?: string
): Promise<RegisterAKSClusterResult> {
  const tempKubeconfigPath = path.join(os.tmpdir(), `kubeconfig-${Date.now()}.yaml`);

  try {
    // Step 1: Get the kubeconfig to a temporary file with --format azure
    // Use namespace get-credentials if a managed namespace is provided
    const args: string[] = ['aks'];

    if (managedNamespace) {
      console.log(
        '[AKS] Getting namespace credentials for cluster:',
        clusterName,
        'namespace:',
        managedNamespace
      );
      args.push(
        'namespace',
        'get-credentials',
        '--cluster-name',
        clusterName,
        '--resource-group',
        resourceGroup,
        '--name',
        managedNamespace,
        '--subscription',
        subscriptionId
      );
    } else {
      console.log('[AKS] Getting credentials for cluster:', clusterName);
      args.push(
        'get-credentials',
        '--subscription',
        subscriptionId,
        '--resource-group',
        resourceGroup,
        '--name',
        clusterName,
        '--format',
        'azure'
      );
    }

    args.push('--file', tempKubeconfigPath);

    try {
      // Use the shared command execution logic from runCmd.ts
      const result = await executeCommandWithShellEnv('az', args);

      if (result.code !== 0) {
        const errorMsg = `Failed to get credentials: ${result.stderr || 'Unknown error'}`;
        console.error('[AKS] ❌', errorMsg);
        return {
          success: false,
          message: errorMsg,
        };
      }
    } catch (error: any) {
      const errorMsg = `Failed to get credentials: ${error.message || 'Unknown error'}`;
      console.error('[AKS] ❌', errorMsg);
      return {
        success: false,
        message: errorMsg,
      };
    }

    if (!fs.existsSync(tempKubeconfigPath)) {
      return {
        success: false,
        message: 'Failed to create temporary kubeconfig file',
      };
    }

    console.log('[AKS] Temporary kubeconfig created:', tempKubeconfigPath);

    // Step 2: Read and modify the temporary kubeconfig
    const tempKubeconfig = fs.readFileSync(tempKubeconfigPath, 'utf8');
    let modifiedKubeconfig: string;
    if (tempKubeconfig.includes('command: kubelogin')) {
      console.log('[AKS] Adding az-kubelogin to kubeconfig since Azure RBAC is enabled');
      modifiedKubeconfig = addAzKubeloginToKubeconfig(tempKubeconfig, isDev, resourcesPath);
    } else {
      console.log('[AKS] Skipping az-kubelogin since Azure RBAC is disabled');
      modifiedKubeconfig = tempKubeconfig;
    }

    // Step 3: Merge into main kubeconfig
    const kubeconfigPath = path.join(os.homedir(), '.kube', 'config');
    const kubeconfigDir = path.dirname(kubeconfigPath);

    // Ensure .kube directory exists
    if (!fs.existsSync(kubeconfigDir)) {
      fs.mkdirSync(kubeconfigDir, { recursive: true });
    }

    // Read existing kubeconfig or start with empty
    let existingKubeconfig = '';
    if (fs.existsSync(kubeconfigPath)) {
      existingKubeconfig = fs.readFileSync(kubeconfigPath, 'utf8');
      console.log('[AKS] Merging with existing kubeconfig');
    } else {
      console.log('[AKS] Creating new kubeconfig');
    }

    // Merge configs
    const mergedConfig = mergeKubeconfig(existingKubeconfig, modifiedKubeconfig);

    // Stringify with options to prevent line wrapping and properly quote strings
    const finalKubeconfig = yaml.stringify(mergedConfig, {
      lineWidth: 0, // Disable line wrapping
      defaultStringType: 'QUOTE_DOUBLE', // Quote strings to handle spaces properly
    });

    // Write the final kubeconfig
    console.log('[AKS] Writing kubeconfig to:', kubeconfigPath);
    fs.writeFileSync(kubeconfigPath, finalKubeconfig, 'utf8');

    // Clean up temporary file
    fs.unlinkSync(tempKubeconfigPath);

    console.log('[AKS] ✅ Cluster registered successfully');
    return {
      success: true,
      message: `Cluster '${clusterName}' registered successfully. Kubeconfig written to ${kubeconfigPath}`,
    };
  } catch (error: any) {
    console.error('[AKS] ❌ Error registering cluster:', error.message);

    // Clean up temporary file if it exists
    if (fs.existsSync(tempKubeconfigPath)) {
      try {
        fs.unlinkSync(tempKubeconfigPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      success: false,
      message: error.message || 'Unknown error occurred',
    };
  }
}
