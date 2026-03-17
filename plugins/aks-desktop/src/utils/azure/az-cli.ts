// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Refactored Azure CLI utility functions for Headlamp plugin using the shared run-command wrapper (runCommandAsync)
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';
import { runCommandAsync as execCommand } from '../shared/runCommandAsync';
import { getAzCommand, getInstallationInstructions } from './az-cli-path';

// Debug flag - set to true for development/debugging, false for production
// Can be controlled via:
// 1. NODE_ENV=development (automatic)
// 2. DEBUG_AZ_CLI=true environment variable
// 3. Manually set DEBUG_LOGS = true for debugging
const DEBUG_LOGS = process.env.NODE_ENV === 'development' || process.env.DEBUG_AZ_CLI === 'true';

// Helper function for debug logging
const debugLog = (...args: any[]) => {
  if (DEBUG_LOGS) {
    console.debug(...args);
  }
};

// Validate that a string is a valid GUID (prevents KQL injection in Resource Graph queries)
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidGuid(value: string): boolean {
  return GUID_PATTERN.test(value);
}

// Helper to determine if error message implies re-login is needed
function needsRelogin(error: string): boolean {
  return (
    error.includes('Interactive authentication is needed') ||
    error.includes('AADSTS700082') ||
    error.includes('AADSTS50173')
  );
}

export function runCommandAsync(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  let actualCommand = command;
  if (command === 'az') {
    actualCommand = getAzCommand();
    debugLog('[AZ-CLI] Command resolution:', command, '→', actualCommand);
  }
  debugLog('[AZ-CLI] Executing command:', actualCommand, 'with args:', args);
  return execCommand(actualCommand, args);
}

export async function isAzCliInstalled(): Promise<boolean> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', ['version']);
    debugLog('Azure CLI version check:', stderr, stdout);

    // Check if stderr contains "command not found" or "not found" messages
    if (
      stderr &&
      (stderr.includes('command not found') ||
        stderr.includes('not found') ||
        stderr.includes('Azure CLI (az) command not found'))
    ) {
      debugLog('Azure CLI not found in PATH');
      return false;
    }

    // Parse JSON output from az version
    if (stdout) {
      try {
        const versionData = JSON.parse(stdout);
        if (versionData['azure-cli']) {
          debugLog('Azure CLI found, version:', versionData['azure-cli']);
          return true; // Azure CLI is installed
        } else {
          debugLog('Azure CLI version not detected in JSON output');
          return false;
        }
      } catch (parseError) {
        debugLog('Failed to parse Azure CLI version JSON:', parseError);
        return false;
      }
    } else {
      debugLog('Azure CLI version not detected in output');
      return false; // Azure CLI not found
    }
  } catch (error) {
    console.error('Error checking Azure CLI installation:', error);
    return false;
  }
}

// Check if aks-preview extension is installed
export async function isAksPreviewExtensionInstalled(): Promise<{
  installed: boolean;
  error?: string;
}> {
  try {
    const { stderr } = await runCommandAsync('az', ['extension', 'show', '--name', 'aks-preview']);

    if (stderr && stderr.includes('not installed')) {
      return { installed: false };
    }

    // If we get here without error, the extension is installed
    return { installed: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('not installed')) {
      return { installed: false };
    }
    return { installed: false, error: errorMessage };
  }
}

// Install aks-preview extension
export async function installAksPreviewExtension(): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  try {
    debugLog('Installing aks-preview extension...');
    const { stdout, stderr } = await runCommandAsync('az', [
      'extension',
      'add',
      '-n',
      'aks-preview',
    ]);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to install aks-preview extension: ${stderr}`,
      };
    }

    return {
      success: true,
      stdout,
      stderr,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to install aks-preview extension: ${errorMessage}`,
    };
  }
}

// Check if alertsmanagement extension is installed
export async function isAlertsManagementExtensionInstalled(): Promise<{
  installed: boolean;
  error?: string;
}> {
  try {
    debugLog('Checking if alertsmanagement extension is installed...');
    const { stdout, stderr } = await runCommandAsync('az', [
      'extension',
      'show',
      '--name',
      'alertsmanagement',
    ]);

    debugLog('[AZ-CLI] alertsmanagement extension check - stdout:', stdout);
    debugLog('[AZ-CLI] alertsmanagement extension check - stderr:', stderr);

    if (stderr && stderr.includes('not installed')) {
      debugLog('[AZ-CLI] alertsmanagement extension is NOT installed');
      return { installed: false };
    }

    debugLog('[AZ-CLI] alertsmanagement extension is installed');
    return { installed: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    debugLog('[AZ-CLI] alertsmanagement extension check - error:', errorMessage);
    if (errorMessage.includes('not installed')) {
      return { installed: false };
    }
    return { installed: false, error: errorMessage };
  }
}

// Install alertsmanagement extension
export async function installAlertsManagementExtension(): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  try {
    debugLog('[AZ-CLI] Installing alertsmanagement extension...');
    const { stdout, stderr } = await runCommandAsync('az', [
      'extension',
      'add',
      '-n',
      'alertsmanagement',
      '--allow-preview',
      'true',
    ]);

    debugLog('[AZ-CLI] alertsmanagement extension install - stdout:', stdout);
    debugLog('[AZ-CLI] alertsmanagement extension install - stderr:', stderr);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      debugLog('[AZ-CLI] alertsmanagement extension installation FAILED');
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to install alertsmanagement extension: ${stderr}`,
      };
    }

    debugLog('[AZ-CLI] alertsmanagement extension installed successfully');
    return {
      success: true,
      stdout,
      stderr,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    debugLog('[AZ-CLI] alertsmanagement extension install - error:', errorMessage);
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to install alertsmanagement extension: ${errorMessage}`,
    };
  }
}

// Configure Azure CLI to auto-install extensions without prompts
export async function configureAzureCliExtensions(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    debugLog('[AZ-CLI] Configuring Azure CLI to auto-install extensions...');

    const result1 = await runCommandAsync('az', [
      'config',
      'set',
      'extension.use_dynamic_install=yes_without_prompt',
    ]);
    debugLog(
      '[AZ-CLI] Config set use_dynamic_install - stdout:',
      result1.stdout,
      'stderr:',
      result1.stderr
    );

    const result2 = await runCommandAsync('az', [
      'config',
      'set',
      'extension.dynamic_install_allow_preview=true',
    ]);
    debugLog(
      '[AZ-CLI] Config set allow_preview - stdout:',
      result2.stdout,
      'stderr:',
      result2.stderr
    );

    debugLog('[AZ-CLI] Azure CLI extension auto-install configured successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    debugLog('[AZ-CLI] Failed to configure Azure CLI extensions:', errorMessage);
    return {
      success: false,
      error: `Failed to configure Azure CLI extensions: ${errorMessage}`,
    };
  }
}

// Check if ManagedNamespacePreview feature is registered
export async function isManagedNamespacePreviewRegistered({
  subscription,
}: {
  subscription: string;
}): Promise<{
  registered: boolean;
  state?: string;
  error?: string;
}> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', [
      'feature',
      'show',
      '--namespace',
      'Microsoft.ContainerService',
      '--name',
      'ManagedNamespacePreview',
      '--subscription',
      subscription,
    ]);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      return { registered: false, error: stderr };
    }

    try {
      const featureInfo = JSON.parse(stdout);
      const state = featureInfo?.properties?.state;

      // Feature is considered registered only if state is "Registered"
      // Other possible states: "Unregistered", "Registering", "NotRegistered", etc.
      const isRegistered = state === 'Registered';

      return {
        registered: isRegistered,
        state: state,
      };
    } catch (parseError) {
      return { registered: false, error: 'Failed to parse feature status' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { registered: false, error: errorMessage };
  }
}

// Register ManagedNamespacePreview feature
export async function registerManagedNamespacePreview(): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  try {
    debugLog('Registering ManagedNamespacePreview feature...');
    const { stdout, stderr } = await runCommandAsync('az', [
      'feature',
      'register',
      '--namespace',
      'Microsoft.ContainerService',
      '--name',
      'ManagedNamespacePreview',
    ]);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to register ManagedNamespacePreview feature: ${stderr}`,
      };
    }

    return {
      success: true,
      stdout,
      stderr,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to register ManagedNamespacePreview feature: ${errorMessage}`,
    };
  }
}

// Register Microsoft.ContainerService provider
export async function registerContainerServiceProvider(): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  try {
    debugLog('Registering Microsoft.ContainerService provider...');
    const { stdout, stderr } = await runCommandAsync('az', [
      'provider',
      'register',
      '-n',
      'Microsoft.ContainerService',
    ]);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to register Microsoft.ContainerService provider: ${stderr}`,
      };
    }

    return {
      success: true,
      stdout,
      stderr,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to register Microsoft.ContainerService provider: ${errorMessage}`,
    };
  }
}

export async function isAzCliLoggedIn(): Promise<boolean> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', [
      'account',
      'show',
      '--query',
      'user.name',
      '-o',
      'tsv',
    ]);

    // Check if stderr indicates Azure CLI is not found
    if (
      stderr &&
      (stderr.includes('command not found') ||
        stderr.includes('not found') ||
        stderr.includes('Azure CLI (az) command not found'))
    ) {
      debugLog('Azure CLI not found when checking login status');
      return false;
    }

    if (stdout.trim()) return true;
    if (needsRelogin(stderr)) console.warn('AKS-plugin: Azure CLI requires re-login');
    return false;
  } catch (error) {
    console.error('Error checking Azure CLI login status:', error);
    return false;
  }
}

export async function getLoginStatus(): Promise<{
  isLoggedIn: boolean;
  username?: string;
  tenantId?: string;
  subscriptionId?: string;
  needsRelogin?: boolean;
  error?: string;
}> {
  try {
    const { stdout, stderr } = await runCommandAsync('az', ['account', 'show', '-o', 'json']);

    // Check if stderr indicates Azure CLI is not found
    if (
      stderr &&
      (stderr.includes('command not found') ||
        stderr.includes('not found') ||
        stderr.includes('Azure CLI (az) command not found'))
    ) {
      return {
        isLoggedIn: false,
        error: 'Azure CLI not found. Please install Azure CLI first.',
      };
    }

    if (!stdout) {
      const needsReloginFlag = needsRelogin(stderr);
      if (needsReloginFlag) console.warn('AKS-plugin: Azure CLI requires re-login');
      return {
        isLoggedIn: false,
        needsRelogin: needsReloginFlag,
        error: stderr || 'Not logged in',
      };
    }

    try {
      const account = JSON.parse(stdout);
      return {
        isLoggedIn: true,
        username: account.user?.name,
        tenantId: account.tenantId,
        subscriptionId: account.id,
      };
    } catch (err) {
      return { isLoggedIn: false, error: 'Failed to parse account information' };
    }
  } catch (error) {
    console.error('Error getting Azure login status:', error);
    return {
      isLoggedIn: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getUserAccountInfo(): Promise<any> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'show', '-o', 'json']);
  if (!stdout) {
    const err: any = new Error(stderr || 'Failed to get account info');
    if (needsRelogin(stderr)) err.needsRelogin = true;
    throw err;
  }
  return JSON.parse(stdout);
}

export async function getAccessToken(): Promise<any> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'get-access-token']);
  if (!stdout) {
    const err: any = new Error(stderr || 'Failed to get access token');
    if (needsRelogin(stderr)) err.needsRelogin = true;
    throw err;
  }
  return JSON.parse(stdout);
}

export async function initiateLogin(): Promise<{ success: boolean; message: string }> {
  try {
    debugLog('[AZ-CLI] ===== INITIATING LOGIN =====');
    debugLog('[AZ-CLI] Resolved command:', getAzCommand());
    debugLog(
      '[AZ-CLI] Is Electron?:',
      typeof window !== 'undefined' && (window as any).desktopApi !== undefined
    );
    debugLog('[AZ-CLI] Platform:', typeof process !== 'undefined' ? process.platform : 'unknown');

    const { stdout, stderr } = await runCommandAsync('az', ['login']);

    debugLog('[AZ-CLI] Login stdout:', stdout);
    debugLog('[AZ-CLI] Login stderr:', stderr);

    // Check if stderr contains error about Azure CLI not being found
    if (
      stderr &&
      (stderr.includes('command not found') ||
        stderr.includes('az: not found') ||
        stderr.includes('Azure CLI (az) command not found') ||
        stderr.includes('ENOENT') ||
        stderr.includes('spawn az ENOENT'))
    ) {
      console.error('[AZ-CLI] Azure CLI not found error detected in stderr');
      const instructions = getInstallationInstructions();
      return {
        success: false,
        message: `Azure CLI not found. Please install Azure CLI first.\n\n${instructions}`,
      };
    }

    // If we get here, login was initiated successfully
    debugLog('[AZ-CLI] Login initiated successfully');
    return {
      success: true,
      message: 'Login process initiated. Please complete authentication in your browser.',
    };
  } catch (error) {
    console.error('[AZ-CLI] Error initiating Azure login:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check if it's an ENOENT error
    if (errorMessage.includes('ENOENT') || errorMessage.includes('spawn az ENOENT')) {
      console.error('[AZ-CLI] ENOENT error - Azure CLI command not found');
      const instructions = getInstallationInstructions();
      return {
        success: false,
        message: `Azure CLI not found. Please install Azure CLI first.\n\n${instructions}`,
      };
    }

    return {
      success: false,
      message: `Failed to initiate login: ${errorMessage}`,
    };
  }
}

export function monitorLoginStatus(
  onStatusChange: (status: { isLoggedIn: boolean; message: string }) => void,
  intervalMs = 5000
): () => void {
  let isPolling = true;
  let pollCount = 0;
  const maxPolls = 60;

  const poll = async () => {
    if (!isPolling) return;
    pollCount++;

    try {
      const status = await getLoginStatus();
      if (status.isLoggedIn) {
        onStatusChange({ isLoggedIn: true, message: 'Login successful!' });
        isPolling = false;
      } else {
        const remaining = ((maxPolls - pollCount) * intervalMs) / 1000;
        onStatusChange({
          isLoggedIn: false,
          message: `Waiting for login... (${Math.floor(remaining / 60)}:${String(
            remaining % 60
          ).padStart(2, '0')})`,
        });
        if (pollCount >= maxPolls) {
          onStatusChange({ isLoggedIn: false, message: 'Login timeout. Please try again.' });
          isPolling = false;
        } else {
          setTimeout(poll, intervalMs);
        }
      }
    } catch (error) {
      onStatusChange({ isLoggedIn: false, message: 'Error checking login status' });
      isPolling = false;
    }
  };

  poll();
  return () => {
    isPolling = false;
  };
}

export async function login(timeoutMs = 300000): Promise<boolean> {
  if (await isAzCliLoggedIn()) return true;
  const init = await initiateLogin();
  if (!init.success) return false;

  const start = Date.now();
  return new Promise(resolve => {
    const poll = async () => {
      if (await isAzCliLoggedIn()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(poll, 5000);
    };
    poll();
  });
}

export async function getSubscriptionIds(): Promise<string[]> {
  const { stdout, stderr } = await runCommandAsync('az', [
    'account',
    'list',
    '--query',
    '[].id',
    '-o',
    'tsv',
  ]);
  if (!stdout) throw new Error(stderr || 'Failed to get subscription IDs');
  return stdout.trim().split(/\r?\n/).filter(Boolean);
}

export async function getSubscriptions(): Promise<any[]> {
  const { stdout, stderr } = await runCommandAsync('az', ['account', 'list', '-o', 'json']);
  if (!stdout) throw new Error(stderr || 'Failed to get subscriptions');
  return JSON.parse(stdout).map((sub: any) => ({
    id: sub.id,
    name: sub.name,
    tenant: sub.tenantId,
    tenantName: sub.tenantDisplayName,
    status: sub.state,
  }));
}

export async function getTenants(): Promise<any[]> {
  const { stdout, stderr } = await runCommandAsync('az', [
    'account',
    'tenant',
    'list',
    '-o',
    'json',
  ]);
  if (!stdout) throw new Error(stderr || 'Failed to get tenants');
  return JSON.parse(stdout).map((tenant: any) => ({
    id: tenant.tenantId,
    name: tenant.displayName || tenant.tenantId,
    domain: tenant.domains?.[0] || '',
    status: 'Active',
  }));
}

export async function getClusters(subscriptionId?: string, query?: string): Promise<any[]> {
  const clusters: any[] = [];

  if (subscriptionId) {
    // Try Azure Resource Graph first (10x faster than az aks list)
    try {
      const filterAad = query?.includes('aadProfile');
      const graphClusters = await getClustersViaGraph(subscriptionId, filterAad);
      return graphClusters;
    } catch (graphError) {
      console.warn('Resource Graph query failed, falling back to az aks list:', graphError);
    }

    // Fallback to az aks list
    const command = ['aks', 'list', '--subscription', subscriptionId];

    // Add query parameter if provided
    if (query) {
      command.push('--query', query);
    }

    // Always add JSON output format
    command.push('-o', 'json');

    const { stdout, stderr } = await runCommandAsync('az', command);

    if (stderr) {
      // Check if stderr contains only warnings (not actual errors)
      const isWarningOnly =
        stderr.includes('WARNING:') &&
        !stderr.includes('ERROR:') &&
        !stderr.includes('error:') &&
        !stderr.includes('failed') &&
        !stderr.includes('Failed');

      if (!isWarningOnly) {
        throw new Error(stderr);
      }
      // If it's just warnings, continue processing stdout
    }
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout);
        parsed.forEach((cluster: any) => {
          clusters.push({
            name: cluster.name,
            subscription: subscriptionId,
            resourceGroup: cluster.resourceGroup,
            location: cluster.location,
            version: cluster.kubernetesVersion,
            status: cluster.provisioningState,
            powerState: cluster.powerState?.code || 'Unknown',
            nodeCount:
              cluster.agentPoolProfiles?.reduce(
                (acc: number, pool: any) => acc + (pool.count || 0),
                0
              ) || 0,
          });
        });
      } catch (error) {
        throw error;
      }
    }
  } else {
    // Fetch clusters from all subscriptions (original behavior)
    const subs = await getSubscriptions();

    for (const sub of subs) {
      const { stdout } = await runCommandAsync('az', [
        'aks',
        'list',
        '--subscription',
        sub.id,
        '-o',
        'json',
      ]);
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          parsed.forEach((cluster: any) => {
            clusters.push({
              id: cluster.id,
              name: cluster.name,
              subscription: sub.id,
              resourceGroup: cluster.resourceGroup,
              location: cluster.location,
              version: cluster.kubernetesVersion,
              status: cluster.provisioningState,
              powerState: cluster.powerState?.code || 'Unknown',
              nodeCount:
                cluster.agentPoolProfiles?.reduce(
                  (acc: number, pool: any) => acc + (pool.count || 0),
                  0
                ) || 0,
              vmSize: cluster.agentPoolProfiles?.[0]?.vmSize || '',
            });
          });
        } catch {
          // ignore parse errors
        }
      }
    }
  }
  return clusters;
}

export async function getResourceGroups(subscriptionId: string): Promise<any[]> {
  debugLog('Fetching resource groups for subscription:', subscriptionId);
  const { stdout } = await runCommandAsync('az', [
    'group',
    'list',
    '--subscription',
    subscriptionId,
    '--query',
    '[].{id:id,name:name,location:location}',
    '-o',
    'json',
  ]);

  // az group list --subscription "82acd5bb-4206-47d4-9c12-a65db028483d" --query "[].name" -o tsv

  // if (stderr && needsRelogin(stderr)) {
  //   throw new Error('Please log in to Azure CLI: az login');
  // }

  // if (stderr) {
  //   throw new Error(`Failed to list resource groups: ${stderr}`);
  // }

  try {
    const resourceGroups = JSON.parse(stdout);
    return resourceGroups.map((rg: any) => ({
      id: rg.id,
      name: rg.name,
      location: rg.location,
      subscriptionId: subscriptionId,
    }));
  } catch (error) {
    throw new Error('Failed to parse resource groups response');
  }
}

export async function getResourceGroupLocation(options: {
  resourceGroupName: string;
  subscriptionId: string;
}): Promise<string> {
  const { resourceGroupName, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    throw new Error(`Invalid subscription ID format: '${subscriptionId}'`);
  }
  if (!isValidAzResourceName(resourceGroupName)) {
    throw new Error(`Invalid resource group name: '${resourceGroupName}'`);
  }

  const result = await runAzCommand(
    [
      'group',
      'show',
      '--name',
      resourceGroupName,
      '--subscription',
      subscriptionId,
      '--query',
      'location',
      '-o',
      'tsv',
    ],
    'Fetching resource group location:',
    'get resource group location',
    stdout => stdout.trim()
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? `Resource group '${resourceGroupName}' returned no location`);
  }

  return result.data;
}

export async function resourceGroupExists(options: {
  resourceGroupName: string;
  subscriptionId: string;
}): Promise<{ exists: boolean; error?: string }> {
  const { resourceGroupName, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { exists: false, error: `Invalid subscription ID format: '${subscriptionId}'` };
  }
  if (!isValidAzResourceName(resourceGroupName)) {
    return { exists: false, error: `Invalid resource group name: '${resourceGroupName}'` };
  }

  const result = await runAzCommand(
    ['group', 'exists', '--name', resourceGroupName, '--subscription', subscriptionId],
    'Checking resource group exists:',
    'check resource group existence',
    stdout => stdout.trim().toLowerCase() === 'true'
  );

  if (!result.success) {
    return { exists: false, error: result.error ?? 'Failed to check resource group existence' };
  }

  return { exists: result.data === true };
}

export async function createResourceGroup(options: {
  resourceGroupName: string;
  location: string;
  subscriptionId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { resourceGroupName, location, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: `Invalid subscription ID format: '${subscriptionId}'` };
  }
  if (!isValidAzResourceName(resourceGroupName)) {
    return { success: false, error: `Invalid resource group name: '${resourceGroupName}'` };
  }

  const result = await runAzCommand(
    [
      'group',
      'create',
      '--name',
      resourceGroupName,
      '--location',
      location,
      '--subscription',
      subscriptionId,
      '--tags',
      'purpose=GitHub Actions Identity',
      'createdBy=AKS Desktop',
    ],
    'Creating resource group:',
    'create resource group'
  );

  return { success: result.success, error: result.error };
}

export async function getLocations(subscriptionId: string): Promise<any[]> {
  debugLog('Fetching Azure locations for subscription:', subscriptionId);
  const { stdout, stderr } = await runCommandAsync('az', [
    'account',
    'list-locations',
    '--query',
    '[].{name:name,displayName:displayName,id:id}',
    '-o',
    'json',
  ]);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Please log in to Azure CLI: az login');
  }

  if (stderr && stderr.includes('ERROR: unrecognized arguments')) {
    console.error('Failed to get locations:', stderr);
    throw new Error(`Failed to get locations: ${stderr}`);
  }

  // Log warnings but don't fail on them (like deprecation warnings)
  if (
    stderr &&
    !stderr.includes('UserWarning') &&
    !stderr.includes('pkg_resources is deprecated')
  ) {
    console.warn('Locations command warnings:', stderr);
  }

  try {
    const locations = JSON.parse(stdout || '[]');
    return locations
      .map((loc: any) => ({
        name: loc.name,
        displayName: loc.displayName,
        id: loc.id,
      }))
      .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));
  } catch (error) {
    console.error('Failed to parse locations response:', error);
    throw new Error('Failed to parse locations response');
  }
}

export async function getVmSizes(subscriptionId: string, location: string): Promise<any[]> {
  debugLog('Fetching VM sizes for location:', location);
  const { stdout, stderr } = await runCommandAsync('az', [
    'vm',
    'list-sizes',
    '--subscription',
    subscriptionId,
    '--location',
    location,
    '--query',
    '[?contains(name, `Standard_D`) || contains(name, `Standard_B`)].{name:name,cores:numberOfCores,memoryInMB:memoryInMB,diskSizeInMB:osDiskSizeInMB}',
    '-o',
    'json',
  ]);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    console.error('Failed to get VM sizes:', stderr);
    // Return common AKS VM sizes as fallback
    return [
      { name: 'Standard_DS2_v2', cores: 2, memoryInMB: 7168, diskSizeInMB: 14336 },
      { name: 'Standard_DS3_v2', cores: 4, memoryInMB: 14336, diskSizeInMB: 28672 },
      { name: 'Standard_DS4_v2', cores: 8, memoryInMB: 28672, diskSizeInMB: 57344 },
      { name: 'Standard_D4s_v3', cores: 4, memoryInMB: 16384, diskSizeInMB: 32768 },
    ];
  }

  try {
    const vmSizes = JSON.parse(stdout || '[]');
    // Filter and sort by cores, then by memory
    return vmSizes
      .filter((vm: any) => vm.cores >= 2 && vm.cores <= 32) // Reasonable range for AKS
      .sort((a: any, b: any) => a.cores - b.cores || a.memoryInMB - b.memoryInMB)
      .slice(0, 20); // Limit to 20 most common sizes
  } catch (error) {
    console.error('Failed to parse VM sizes response:', error);
    // Return common AKS VM sizes as fallback
    return [
      { name: 'Standard_DS2_v2', cores: 2, memoryInMB: 7168, diskSizeInMB: 14336 },
      { name: 'Standard_DS3_v2', cores: 4, memoryInMB: 14336, diskSizeInMB: 28672 },
      { name: 'Standard_DS4_v2', cores: 8, memoryInMB: 28672, diskSizeInMB: 57344 },
      { name: 'Standard_D4s_v3', cores: 4, memoryInMB: 16384, diskSizeInMB: 32768 },
    ];
  }
}

// Check AKS cluster status
export async function getAksClusterStatus(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
}): Promise<{
  provisioningState: string;
  powerState: string;
  kubernetesVersion: string;
  ready: boolean;
}> {
  const { subscriptionId, resourceGroup, clusterName } = options;

  const args = [
    'aks',
    'show',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
    '--output',
    'json',
  ];

  debugLog('Checking AKS cluster status:', 'az', args.join(' '));

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    console.error('Failed to get cluster status:', stderr);
    throw new Error(`Failed to get cluster status: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    const provisioningState = result.provisioningState || 'Unknown';
    const powerState = result.powerState?.code || 'Unknown';
    const kubernetesVersion = result.kubernetesVersion || 'Unknown';
    const ready = provisioningState === 'Succeeded' && powerState === 'Running';

    debugLog(
      `Cluster status: provisioningState=${provisioningState}, powerState=${powerState}, ready=${ready}`
    );

    return {
      provisioningState,
      powerState,
      kubernetesVersion,
      ready,
    };
  } catch (error) {
    console.error('Failed to parse cluster status response:', error);
    throw new Error(`Failed to parse cluster status: ${error}`);
  }
}

// Get cluster capabilities (SKU, network policy, addons)
export async function getClusterCapabilities(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
}): Promise<ClusterCapabilities> {
  const { subscriptionId, resourceGroup, clusterName } = options;

  const args = [
    'aks',
    'show',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
    '--query',
    '{sku:sku.name,aadProfile:aadProfile,azureRbacEnabled:aadProfile.enableAzureRbac,networkPolicy:networkProfile.networkPolicy,networkPlugin:networkProfile.networkPlugin,prometheusEnabled:azureMonitorProfile.metrics.enabled,containerInsightsEnabled:addonProfiles.omsagent.enabled,kedaEnabled:workloadAutoScalerProfile.keda.enabled,vpaEnabled:workloadAutoScalerProfile.verticalPodAutoscaler.enabled}',
    '--output',
    'json',
  ];

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && stderr.includes('ERROR:')) {
    console.error('Failed to get cluster capabilities:', stderr);
    throw new Error(`Failed to get cluster capabilities: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    return {
      sku: (result.sku as ClusterCapabilities['sku']) || null,
      aadEnabled: result.aadProfile !== null && result.aadProfile !== undefined,
      azureRbacEnabled: result.azureRbacEnabled ?? null,
      networkPolicy: (result.networkPolicy as ClusterCapabilities['networkPolicy']) || 'none',
      networkPlugin: (result.networkPlugin as ClusterCapabilities['networkPlugin']) || null,
      prometheusEnabled: result.prometheusEnabled ?? null,
      containerInsightsEnabled: result.containerInsightsEnabled ?? null,
      kedaEnabled: result.kedaEnabled ?? null,
      vpaEnabled: result.vpaEnabled ?? null,
    };
  } catch (error) {
    console.error('Failed to parse cluster capabilities response:', error);
    throw new Error(`Failed to parse cluster capabilities: ${error}`);
  }
}

// Enable a cluster addon (azure-monitor-metrics, keda, or vpa)
export async function enableClusterAddon(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  addon: 'azure-monitor-metrics' | 'keda' | 'vpa';
}): Promise<{ success: boolean; error?: string }> {
  const { subscriptionId, resourceGroup, clusterName, addon } = options;

  const addonFlags: Record<string, string[]> = {
    'azure-monitor-metrics': ['--enable-azure-monitor-metrics'],
    keda: ['--enable-keda'],
    vpa: ['--enable-vpa'],
  };

  const flags = addonFlags[addon];
  if (!flags) {
    return { success: false, error: `Unknown addon: ${addon}` };
  }

  const args = [
    'aks',
    'update',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
    ...flags,
    '--no-wait',
  ];

  const { stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    return { success: false, error: 'Authentication required. Please log in to Azure CLI.' };
  }

  if (stderr && stderr.includes('ERROR:')) {
    return { success: false, error: `Failed to enable ${addon}: ${stderr}` };
  }

  return { success: true };
}

// Get AKS cluster kubeconfig credentials
export async function getAksKubeconfig(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  mergeWithExisting?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  kubeconfigPath?: string;
}> {
  const { subscriptionId, resourceGroup, clusterName, mergeWithExisting = true } = options;

  const args = [
    'aks',
    'get-credentials',
    '--subscription',
    subscriptionId,
    '--resource-group',
    resourceGroup,
    '--name',
    clusterName,
  ];

  // Add merge flag if requested (default behavior)
  if (mergeWithExisting) {
    args.push('--overwrite-existing');
  } else {
    args.push('--file', `~/.kube/config-${clusterName}`);
  }

  debugLog('Getting AKS kubeconfig:', 'az', args.join(' '));

  const { stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    console.error('Failed to get kubeconfig:', stderr);
    throw new Error(`Failed to get kubeconfig: ${stderr}`);
  }

  const kubeconfigPath = mergeWithExisting ? '~/.kube/config' : `~/.kube/config-${clusterName}`;

  return {
    success: true,
    message: mergeWithExisting
      ? `Kubeconfig merged successfully. Cluster context '${clusterName}' is now available.`
      : `Kubeconfig saved to ${kubeconfigPath}`,
    kubeconfigPath,
  };
}

// Azure Container Registry functions
export async function getContainerRegistries(subscriptionId: string): Promise<any[]> {
  const { stdout, stderr } = await runCommandAsync('az', [
    'acr',
    'list',
    '--subscription',
    subscriptionId,
    '--output',
    'json',
  ]);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    console.error('Failed to get container registries:', stderr);
    throw new Error(`Failed to get container registries: ${stderr}`);
  }

  try {
    const registries = JSON.parse(stdout || '[]');
    return registries.map((registry: any) => ({
      id: registry.id,
      name: registry.name,
      resourceGroup: registry.resourceGroup,
      loginServer: registry.loginServer,
      location: registry.location,
      sku: registry.sku?.name || 'Basic',
    }));
  } catch (error) {
    console.error('Failed to parse container registries response:', error);
    return [];
  }
}

export async function getContainerImages(
  subscriptionId: string,
  registryName?: string
): Promise<any[]> {
  try {
    let allImages: any[] = [];

    if (registryName) {
      // Get images from specific registry
      const images = await getImagesFromRegistry(subscriptionId, registryName);
      allImages = allImages.concat(images);
    } else {
      // Get all registries first, then get images from each
      const registries = await getContainerRegistries(subscriptionId);

      for (const registry of registries) {
        try {
          const images = await getImagesFromRegistry(subscriptionId, registry.name);
          allImages = allImages.concat(images);
        } catch (error) {
          console.warn(`Failed to get images from registry ${registry.name}:`, error);
          // Continue with other registries
        }
      }
    }

    return allImages;
  } catch (error) {
    console.error('Failed to get container images:', error);
    return [];
  }
}

async function getImagesFromRegistry(subscriptionId: string, registryName: string): Promise<any[]> {
  // First get list of repositories
  const { stdout: repoStdout, stderr: repoStderr } = await runCommandAsync('az', [
    'acr',
    'repository',
    'list',
    '--name',
    registryName,
    '--subscription',
    subscriptionId,
    '--output',
    'json',
  ]);

  if (repoStderr && needsRelogin(repoStderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (repoStderr && (repoStderr.includes('ERROR') || repoStderr.includes('error'))) {
    console.error(`Failed to get repositories from ${registryName}:`, repoStderr);
    return [];
  }

  let repositories: string[] = [];
  try {
    repositories = JSON.parse(repoStdout || '[]');
  } catch (error) {
    console.error('Failed to parse repositories response:', error);
    return [];
  }

  const allImages: any[] = [];
  const MAX_REPOSITORIES = 10; // Limit to first 10 repositories for performance
  const MAX_IMAGES_TOTAL = 50; // Stop after collecting 50 images total

  // Limit repositories for performance
  const limitedRepositories = repositories.slice(0, MAX_REPOSITORIES);

  // Get images from each repository
  for (const repository of limitedRepositories) {
    try {
      // Early termination if we have enough images
      if (allImages.length >= MAX_IMAGES_TOTAL) {
        debugLog(`Limiting results to ${MAX_IMAGES_TOTAL} images for performance`);
        break;
      }

      const { stdout: tagStdout, stderr: tagStderr } = await runCommandAsync('az', [
        'acr',
        'repository',
        'show-tags',
        '--name',
        registryName,
        '--repository',
        repository,
        '--subscription',
        subscriptionId,
        '--output',
        'json',
        '--orderby',
        'time_desc',
        '--top',
        '5', // Reduced to 5 most recent tags per repository for performance
      ]);

      if (tagStderr && tagStderr.includes('ERROR')) {
        console.warn(`Failed to get tags for ${repository}:`, tagStderr);
        continue;
      }

      const tags = JSON.parse(tagStdout || '[]');

      for (const tag of tags) {
        // Skip expensive manifest call for better performance
        // Use basic info only - users can see size/details after deployment
        allImages.push({
          id: `${registryName}/${repository}:${tag}`,
          name: repository.split('/').pop() || repository,
          repository,
          tag,
          registry: `${registryName}.azurecr.io`,
          registryName,
          createdTime: new Date().toISOString().split('T')[0], // Use current date as fallback
          size: 'Unknown', // Skip size lookup for performance
          digest: '',
        });

        // Early termination check within tag loop
        if (allImages.length >= MAX_IMAGES_TOTAL) {
          break;
        }
      }
    } catch (error) {
      console.warn(`Failed to process repository ${repository}:`, error);
    }
  }

  return allImages;
}

// Get managed namespaces from an AKS cluster
export async function getManagedNamespaces(options: {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<string[]> {
  const { clusterName, resourceGroup, subscriptionId } = options;

  const args = [
    'aks',
    'namespace',
    'list',
    '--cluster-name',
    clusterName,
    '--resource-group',
    resourceGroup,
  ];

  // Add subscription if provided
  if (subscriptionId) {
    args.push('--subscription', subscriptionId);
  }

  args.push('--output', 'json');

  debugLog('Getting managed namespaces:', 'az', args.join(' '));

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    console.error('Failed to get managed namespaces:', stderr);
    // Fall back to empty array if command fails
    return [];
  }

  try {
    const result = JSON.parse(stdout || '[]');

    // Extract namespace names from the response
    if (Array.isArray(result)) {
      return result.map((ns: any) => ns.name || ns).filter(Boolean);
    }

    // If it's an object with a namespaces property
    if (result.namespaces && Array.isArray(result.namespaces)) {
      return result.namespaces.map((ns: any) => ns.name || ns).filter(Boolean);
    }

    return [];
  } catch (error) {
    console.error('Failed to parse managed namespaces response:', error);
    return [];
  }
}

// Get all managed namespaces across all clusters in a subscription
export async function getManagedNamespacesForSubscription(subscriptionId: string): Promise<
  Array<{
    name: string;
    clusterName: string;
    resourceGroup: string;
    properties?: any;
  }>
> {
  const args = ['aks', 'namespace', 'list', '--subscription', subscriptionId, '--output', 'json'];

  debugLog('Getting managed namespaces for subscription:', 'az', args.join(' '));

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    console.error('Failed to get managed namespaces:', stderr);
    return [];
  }

  try {
    const result = JSON.parse(stdout || '[]');

    if (Array.isArray(result)) {
      // Parse the response to extract namespace details
      // The name field is in format "clusterName/namespaceName"
      const mapped = result.map((ns: any) => {
        // Split the name to get cluster and namespace
        const nameParts = (ns.name || '').split('/');
        const clusterName = nameParts.length > 1 ? nameParts[0] : '';
        const namespaceName = nameParts.length > 1 ? nameParts[1] : ns.name || '';

        return {
          name: namespaceName,
          clusterName: clusterName,
          resourceGroup: ns.resourceGroup || ns.resourceGroupName || '',
          properties: ns.properties || {},
        };
      });

      const filtered = mapped.filter(ns => ns.name && ns.clusterName);
      return filtered;
    }

    return [];
  } catch (error) {
    console.error('Failed to parse managed namespaces response:', error);
    console.error('stdout was:', stdout);
    return [];
  }
}

// Get detailed properties of a specific managed namespace
export async function getManagedNamespaceDetails(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId?: string;
}): Promise<any> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  const args = [
    'aks',
    'namespace',
    'show',
    '--cluster-name',
    clusterName,
    '--resource-group',
    resourceGroup,
    '--name',
    namespaceName,
  ];

  // Add subscription if provided
  if (subscriptionId) {
    args.push('--subscription', subscriptionId);
  }

  args.push('--output', 'json');

  debugLog('Getting managed namespace details:', 'az', args.join(' '));

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    console.error('Failed to get managed namespace details:', stderr);
    throw new Error(`Failed to get managed namespace details: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout || '{}');

    // Return the full namespace object which typically includes:
    // - metadata: { name, labels, annotations, creationTimestamp, resourceVersion }
    // - spec: { ... }
    // - status: { ... }
    return result;
  } catch (error) {
    console.error('Failed to parse managed namespace details response:', error);
    throw new Error(`Failed to parse managed namespace details: ${error}`);
  }
}

// Note: Namespace labeling is now done using Headlamp K8s API in the component
// This avoids kubectl dependency and uses the proper Kubernetes client

// Update managed namespace configuration (network policies and compute quota)
export async function updateManagedNamespace(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  cpuRequest?: number; // millicores
  cpuLimit?: number; // millicores
  memoryRequest?: number; // MiB
  memoryLimit?: number; // MiB
  ingressPolicy?: 'AllowAll' | 'AllowSameNamespace' | 'DenyAll';
  egressPolicy?: 'AllowAll' | 'AllowSameNamespace' | 'DenyAll';
  subscriptionId?: string;
  noWait?: boolean;
}): Promise<any> {
  const {
    clusterName,
    resourceGroup,
    namespaceName,
    cpuRequest,
    cpuLimit,
    memoryRequest,
    memoryLimit,
    ingressPolicy,
    egressPolicy,
    subscriptionId,
    noWait,
  } = options;

  const args: string[] = [
    'aks',
    'namespace',
    'update',
    '--cluster-name',
    clusterName,
    '--resource-group',
    resourceGroup,
    '--name',
    namespaceName,
  ];

  const toMillicores = (v?: number) => (typeof v === 'number' ? `${v}m` : undefined);
  const toMiB = (v?: number) => (typeof v === 'number' ? `${v}Mi` : undefined);

  const maybePush = (flag: string, value?: string) => {
    if (value) {
      args.push(flag, value);
    }
  };

  maybePush('--cpu-request', toMillicores(cpuRequest));
  maybePush('--cpu-limit', toMillicores(cpuLimit));
  maybePush('--memory-request', toMiB(memoryRequest));
  maybePush('--memory-limit', toMiB(memoryLimit));
  maybePush('--ingress-policy', ingressPolicy as string | undefined);
  maybePush('--egress-policy', egressPolicy as string | undefined);

  if (subscriptionId) {
    args.push('--subscription', subscriptionId);
  }
  if (noWait) {
    args.push('--no-wait');
  }

  args.push('--output', 'json');

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }
  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    throw new Error(`Failed to update managed namespace: ${stderr}`);
  }

  try {
    return JSON.parse(stdout || '{}');
  } catch {
    // Some updates might not return a body; return empty object on success
    return {};
  }
}

// Fast way to look up resource group using Azure Resource Graph
export async function getClusterResourceGroupViaGraph(
  clusterName: string,
  subscription: string
): Promise<string | null> {
  try {
    if (!subscription || !isValidGuid(subscription)) {
      debugLog('Resource Graph: Missing or invalid subscription ID');
      return null;
    }

    // Sanitize clusterName: allow only alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
      debugLog('Resource Graph: Invalid cluster name format');
      return null;
    }

    const query = `
      Resources
      | where type == 'microsoft.containerservice/managedclusters'
      | where name == '${clusterName}'
      | project resourceGroup
      | limit 1
    `;

    const { stdout, stderr } = await runCommandAsync('az', [
      'graph',
      'query',
      '-q',
      query,
      '--output',
      'json',
      '--subscription',
      subscription,
    ]);

    if (stderr) {
      debugLog(stderr);
    }

    if (stderr && needsRelogin(stderr)) {
      debugLog('Resource Graph: Authentication required');
      return null;
    }

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      debugLog('Resource Graph query failed:', stderr);
      return null;
    }

    try {
      const result = JSON.parse(stdout);
      const resourceGroup = result.data?.[0]?.resourceGroup;

      if (resourceGroup) {
        debugLog('Resource Graph: Found resource group:', resourceGroup);
        return resourceGroup;
      }

      debugLog('Resource Graph: No results');
      return null;
    } catch (parseError) {
      debugLog('Resource Graph: Parse error:', parseError);
      return null;
    }
  } catch (error) {
    debugLog('Resource Graph error:', error);
    return null;
  }
}

/**
 * Fetches a single page of AKS clusters from Azure Resource Graph.
 *
 * The Resource Graph query returns at most 1000 results per call with --first 1000. (Maximum)
 * If more results exist, the raw response includes a `skip_token` cursor that can
 * be used to fetch the next page of results. This function returns both the clusters and
 * a `skipToken` (mapped from the raw `skip_token` field) when pagination is required to
 * fetch all clusters in larger subscriptions.
 *
 * @param query - Azure Resource Graph query to execute.
 * @param skipToken - Pagination token from a previous call to fetch the next page.
 * @returns The cluster records and an optional `skipToken` for the next page.
 */
async function fetchGraphPage(
  query: string,
  skipToken?: string
): Promise<{ clusters: any[]; skipToken?: string }> {
  const pageSize = '1000';
  const args = ['graph', 'query', '-q', query, '--first', pageSize, '--output', 'json'];
  // Append skip token for pagination if provided
  if (skipToken) {
    args.push('--skip-token', skipToken);
  }

  const { stdout, stderr } = await runCommandAsync('az', args);

  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && stderr.toLowerCase().includes('error')) {
    throw new Error(`Resource Graph query failed: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    const clusters = result.data || [];

    return { clusters, skipToken: result.skip_token };
  } catch (parseError: unknown) {
    const parseErrorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    const stdoutPreview = stdout.length > 500 ? stdout.slice(0, 500) + '…' : stdout;
    throw new Error(
      `Failed to parse Resource Graph query response: ${parseErrorMessage}. ` +
        `Stdout length=${stdout.length}, preview=${JSON.stringify(stdoutPreview)}`
    );
  }
}

// Get clusters using Azure Resource Graph
export async function getClustersViaGraph(
  subscriptionId: string,
  filterAad: boolean = false
): Promise<any[]> {
  if (!isValidGuid(subscriptionId)) {
    throw new Error('Invalid subscription ID format');
  }

  const aadFilter = filterAad ? '| where isnotnull(properties.aadProfile)' : '';

  const query = `
    Resources
    | where type =~ 'microsoft.containerservice/managedclusters'
    | where subscriptionId == '${subscriptionId}'
    ${aadFilter}
    | extend agentPools = properties.agentPoolProfiles
    | mv-expand agentPools
    | extend poolNodeCount = toint(agentPools['count'])
    | summarize
        nodeCount = sum(poolNodeCount)
      by
        name,
        resourceGroup,
        location,
        version = tostring(properties.kubernetesVersion),
        status = tostring(properties.provisioningState),
        powerState = tostring(properties.powerState.code)
    | order by name asc
  `;

  // Fetch first page
  let page = await fetchGraphPage(query);
  const allClusters = [...page.clusters];

  // Fetch remaining pages if the subscription has more clusters than one page holds.
  // The Resource Graph response includes a `skipToken` only when more pages exist;
  // on the final page it is null/absent, which will terminate the loop.
  const MAX_PAGES = 100; // 100,000 cluster limit.
  let pageCount = 1;
  while (page.skipToken && pageCount < MAX_PAGES) {
    page = await fetchGraphPage(query, page.skipToken);
    allClusters.push(...page.clusters);
    pageCount++;
  }

  if (page.skipToken && pageCount >= MAX_PAGES) {
    debugLog(
      `Resource Graph pagination hit MAX_PAGES limit (${MAX_PAGES}). Results may be truncated.`
    );
  }

  return allClusters.map((cluster: any) => ({
    name: cluster.name,
    subscription: subscriptionId,
    resourceGroup: cluster.resourceGroup,
    location: cluster.location,
    version: cluster.version,
    status: cluster.status,
    powerState: cluster.powerState || 'Unknown',
    nodeCount: cluster.nodeCount || 0,
  }));
}

// Get total cluster count for a subscription using Azure Resource Graph
export async function getClusterCount(subscriptionId: string): Promise<number> {
  try {
    // Validate subscriptionId is a GUID to prevent KQL injection
    if (!isValidGuid(subscriptionId)) {
      console.error('Invalid subscription ID format:', subscriptionId);
      return -1;
    }

    const query = `Resources | where type =~ 'microsoft.containerservice/managedclusters' | where subscriptionId == '${subscriptionId}' | count`;
    const { stdout, stderr } = await runCommandAsync('az', [
      'graph',
      'query',
      '-q',
      query,
      '--output',
      'json',
    ]);

    if (stderr && stderr.includes('ERROR:')) {
      console.error('getClusterCount: Azure CLI error:', stderr);
      return -1;
    }

    try {
      const result = JSON.parse(stdout);
      return result.data?.[0]?.Count ?? result.data?.[0]?.count_ ?? -1;
    } catch (parseError) {
      console.error('getClusterCount: Failed to parse response:', parseError);
      return -1;
    }
  } catch (error) {
    console.error('Failed to get cluster count:', error);
    return -1;
  }
}

// Get AKS cluster info based on cluster name using Azure CLI
export async function getClusterInfo(clusterName?: string): Promise<{
  clusterName?: string;
  resourceGroup?: string;
  subscriptionId?: string;
}> {
  const result: {
    clusterName?: string;
    resourceGroup?: string;
    subscriptionId?: string;
  } = {};

  try {
    // First get the current subscription
    const { stdout: accountStdout, stderr: accountStderr } = await runCommandAsync('az', [
      'account',
      'show',
      '--output',
      'json',
    ]);

    if (accountStderr && !accountStdout) {
      const isInteractionRequired =
        accountStderr.includes('InteractionRequired') ||
        accountStderr.includes('interaction_required') ||
        accountStderr.includes('multi-factor authentication') ||
        accountStderr.includes('AADSTS50076');
      if (isInteractionRequired) {
        throw new Error(
          'Your Azure session requires re-authentication. Please run "az login" to sign in again.'
        );
      }
      if (accountStderr.includes('No subscriptions found')) {
        throw new Error(
          'No Azure subscriptions found. Please run "az login" to sign in with an account that has active subscriptions.'
        );
      }
    }

    if (accountStdout) {
      try {
        const account = JSON.parse(accountStdout);
        result.subscriptionId = account.id;
      } catch (parseError) {
        console.warn('Could not parse Azure account info:', parseError);
      }
    }

    if (!result.subscriptionId) {
      console.warn('No subscription ID found, cannot query cluster info');
      return result;
    }

    // If cluster name is provided, find its resource group
    if (clusterName) {
      // Sanitize clusterName: allow only alphanumeric, hyphens, and underscores
      if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
        console.warn('getClusterInfo: Invalid cluster name format');
        return result;
      }

      // FAST PATH: Try Azure Resource Graph query first (2-3s vs 36s for az aks list)
      try {
        const resourceGroupFromGraph = await getClusterResourceGroupViaGraph(
          clusterName,
          result.subscriptionId
        );

        if (resourceGroupFromGraph) {
          result.clusterName = clusterName;
          result.resourceGroup = resourceGroupFromGraph;
          return result;
        }
      } catch (graphError) {
        debugLog('Resource Graph failed, falling back to az aks list:', graphError);
      }

      // FALLBACK: Use slower az aks list query if Resource Graph fails
      try {
        const { stdout: clusterStdout } = await runCommandAsync('az', [
          'aks',
          'list',
          '--subscription',
          result.subscriptionId,
          '--query',
          `[?name=='${clusterName}'].{name:name,resourceGroup:resourceGroup}`,
          '-o',
          'json',
        ]);

        if (clusterStdout) {
          const clusters = JSON.parse(clusterStdout);
          if (clusters.length > 0) {
            result.clusterName = clusters[0].name;
            result.resourceGroup = clusters[0].resourceGroup;
            debugLog(`Found cluster info for ${clusterName}:`, result);
          } else {
            console.warn(
              `Cluster ${clusterName} not found in subscription ${result.subscriptionId}`
            );
            result.clusterName = clusterName; // Still return the provided name
          }
        }
      } catch (azError) {
        console.warn(`Could not get cluster info for ${clusterName}:`, azError);
        result.clusterName = clusterName; // Still return the provided name
      }
    } else {
      // No cluster name provided, try to get from current kubectl context as fallback
      try {
        const { stdout: contextStdout } = await runCommandAsync('kubectl', [
          'config',
          'current-context',
        ]);
        if (contextStdout && contextStdout.trim()) {
          const contextName = contextStdout.trim();

          // Parse context name to extract cluster name
          if (contextName.includes('_')) {
            // Format: resourcegroup_clustername
            const parts = contextName.split('_');
            const potentialClusterName = parts[1] || parts[0];
            return getClusterInfo(potentialClusterName); // Recursive call with cluster name
          } else {
            // Try using the context name as cluster name
            return getClusterInfo(contextName);
          }
        }
      } catch (kubectlError) {
        console.warn('Could not get current context from kubectl:', kubectlError);
      }

      // If still no cluster name, get the first available cluster
      try {
        const { stdout: clustersStdout } = await runCommandAsync('az', [
          'aks',
          'list',
          '--subscription',
          result.subscriptionId,
          '--query',
          '[].{name:name,resourceGroup:resourceGroup}',
          '-o',
          'json',
        ]);

        if (clustersStdout) {
          const clusters = JSON.parse(clustersStdout);
          if (clusters.length > 0) {
            result.clusterName = clusters[0].name;
            result.resourceGroup = clusters[0].resourceGroup;
            debugLog('Using first available cluster:', result);
          }
        }
      } catch (azError) {
        console.warn('Could not list AKS clusters:', azError);
      }
    }

    debugLog('Cluster info resolved:', result);
    return result;
  } catch (error) {
    console.error('Failed to get cluster info:', error);
    if (
      error instanceof Error &&
      (error.message.includes('re-authentication') ||
        error.message.includes('No Azure subscriptions'))
    ) {
      throw error;
    }
    return result;
  }
}

// Backward compatibility - keep the old function name but make it call the new one
export async function getCurrentClusterInfo(): Promise<{
  clusterName?: string;
  resourceGroup?: string;
  subscriptionId?: string;
}> {
  return getClusterInfo();
}

// Get AKS cluster resource ID (and resource group parsed from it) from cluster name
export async function getClusterResourceIdAndGroup(
  clusterName: string,
  subscription: string
): Promise<{ resourceId: string; resourceGroup: string } | null> {
  if (!clusterName) return null;
  debugLog('cluster name:', clusterName, 'subscription:', subscription);
  const { stdout, stderr } = await runCommandAsync('az', [
    'aks',
    'list',
    '--query',
    `[?name=='${clusterName}']`,
    '-o',
    'json',
    '--subscription',
    subscription,
  ]);

  debugLog('stdout:', stdout);
  debugLog('stderr:', stderr);
  if (stderr && needsRelogin(stderr)) {
    throw new Error('Authentication required. Please log in to Azure CLI: az login');
  }

  if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
    throw new Error(`Failed to list AKS clusters: ${stderr}`);
  }

  try {
    const arr = JSON.parse(stdout || '[]');
    if (!Array.isArray(arr) || arr.length === 0) return null;

    const item = arr[0] || {};
    const resourceId: string = item.id || '';
    let resourceGroup: string = item.resourceGroup || '';

    if (!resourceGroup && resourceId) {
      const match = resourceId.match(/\/resourceGroups\/([^/]+)\//i);
      if (match && match[1]) resourceGroup = match[1];
    }

    if (!resourceId) return null;
    return { resourceId, resourceGroup };
  } catch (parseError) {
    debugLog('parseError:', parseError);
    throw new Error('Failed to parse AKS list response');
  }
}

// Create a managed namespace in an AKS cluster
// Check if a namespace already exists using list command (more reliable than show)
export async function checkNamespaceExists(
  clusterName: string,
  resourceGroup: string,
  namespaceName: string,
  subscriptionId?: string
): Promise<{ exists: boolean; stdout: string; stderr: string; error?: string }> {
  // Sanitize inputs to prevent JMESPath injection
  if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
    return { exists: false, stdout: '', stderr: '', error: 'Invalid cluster name format' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(namespaceName)) {
    return { exists: false, stdout: '', stderr: '', error: 'Invalid namespace name format' };
  }

  try {
    const args = [
      'aks',
      'namespace',
      'list',
      '--cluster-name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--query',
      `[?name=='${namespaceName}']`,
      '--output',
      'json',
    ];

    if (subscriptionId) {
      args.push('--subscription', subscriptionId);
    }

    debugLog('🔍 Checking if namespace exists via list command:');
    debugLog('   Command:', 'az', args.join(' '));
    debugLog('   Parameters:', { clusterName, resourceGroup, namespaceName, subscriptionId });

    const { stdout, stderr } = await runCommandAsync('az', args);

    debugLog('   📤 Command output:');
    debugLog('      stdout:', stdout);
    debugLog('      stderr:', stderr);

    if (stderr && needsRelogin(stderr)) {
      debugLog('   ❌ Authentication error detected');
      return {
        exists: false,
        stdout,
        stderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      debugLog('   ❌ Command error detected');
      return {
        exists: false,
        stdout,
        stderr,
        error: `Failed to check namespace existence: ${stderr}`,
      };
    }

    debugLog('   📋 Result analysis:');

    // Parse the JSON response
    try {
      const result = JSON.parse(stdout || '[]');
      const exists = Array.isArray(result) && result.length > 0;

      debugLog('      Expected namespace:', namespaceName);
      debugLog('      Found namespaces:', result.length);
      debugLog('      Namespace exists:', exists);

      if (exists && result[0]) {
        debugLog('      Namespace details:', {
          name: result[0].name,
          provisioningState: result[0].properties?.provisioningState,
        });
      }

      return {
        exists,
        stdout,
        stderr,
      };
    } catch (parseError) {
      debugLog('      ❌ Failed to parse JSON response');
      return {
        exists: false,
        stdout,
        stderr,
        error: `Failed to parse namespace existence response: ${parseError}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      exists: false,
      stdout: '',
      stderr: '',
      error: `Failed to check namespace existence: ${errorMessage}`,
    };
  }
}

// Helper function to check namespace status using list command (more reliable than show)
async function checkNamespaceStatus(
  clusterName: string,
  resourceGroup: string,
  namespaceName: string,
  subscriptionId?: string
): Promise<{ success: boolean; status?: string; stdout: string; stderr: string; error?: string }> {
  try {
    const args = [
      'aks',
      'namespace',
      'list',
      '--cluster-name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--query',
      `[?name=='${namespaceName}']`,
      '--output',
      'json',
    ];

    if (subscriptionId) {
      args.push('--subscription', subscriptionId);
    }

    debugLog('📊 Checking namespace status via list command:');
    debugLog('   Command:', 'az', args.join(' '));
    debugLog('   Parameters:', { clusterName, resourceGroup, namespaceName, subscriptionId });

    const { stdout, stderr } = await runCommandAsync('az', args);

    debugLog('   📤 Command output:');
    debugLog('      stdout:', stdout);
    debugLog('      stderr:', stderr);

    if (stderr && needsRelogin(stderr)) {
      debugLog('   ❌ Authentication error detected');
      return {
        success: false,
        stdout,
        stderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      debugLog('   ❌ Command error detected');
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to check namespace status: ${stderr}`,
      };
    }

    debugLog('   📋 Status analysis:');

    // Parse the JSON response
    try {
      const result = JSON.parse(stdout || '[]');

      if (!Array.isArray(result) || result.length === 0) {
        debugLog('      Status: notfound (namespace not found in list)');
        return {
          success: true,
          status: 'notfound',
          stdout,
          stderr,
        };
      }

      // Get the first matching namespace
      const namespace = result[0];
      const status = namespace?.properties?.provisioningState;

      if (!status) {
        debugLog('      Status: unknown (no provisioningState found)');
        return {
          success: true,
          status: 'unknown',
          stdout,
          stderr,
        };
      }

      debugLog('      Status:', status);
      debugLog('      Namespace details:', {
        name: namespace.name,
        provisioningState: status,
        createdAt: namespace.systemData?.createdAt,
      });

      return {
        success: true,
        status,
        stdout,
        stderr,
      };
    } catch (parseError) {
      debugLog('      ❌ Failed to parse JSON response');
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to parse namespace status response: ${parseError}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to check namespace status: ${errorMessage}`,
    };
  }
}

export async function deleteManagedNamespace(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId: string;
}): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  try {
    const result = await runCommandAsync('az', [
      'aks',
      'namespace',
      'delete',
      '--cluster-name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--name',
      namespaceName,
      '--subscription',
      subscriptionId,
      '--output',
      'json',
    ]);

    return {
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to delete managed namespace: ${errorMessage}`,
    };
  }
}

export async function createManagedNamespace(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId?: string;
  cpuRequest?: number;
  cpuLimit?: number;
  memoryRequest?: number;
  memoryLimit?: number;
  ingressPolicy?: string;
  egressPolicy?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const {
    clusterName,
    resourceGroup,
    namespaceName,
    subscriptionId,
    cpuRequest,
    cpuLimit,
    memoryRequest,
    memoryLimit,
    ingressPolicy,
    egressPolicy,
    labels = {},
  } = options;

  try {
    // Step 1: Fire the namespace creation command (don't wait for completion)
    const args = [
      'aks',
      'namespace',
      'add',
      '--cluster-name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--name',
      namespaceName,
    ];

    // Add subscription if provided
    if (subscriptionId) {
      args.push('--subscription', subscriptionId);
    }

    // Add resource quotas if specified (convert to proper format)
    if (cpuRequest !== undefined) {
      args.push('--cpu-request', `${cpuRequest}m`);
    }
    if (cpuLimit !== undefined) {
      args.push('--cpu-limit', `${cpuLimit}m`);
    }
    if (memoryRequest !== undefined) {
      args.push('--memory-request', `${memoryRequest}Mi`);
    }
    if (memoryLimit !== undefined) {
      args.push('--memory-limit', `${memoryLimit}Mi`);
    }

    // Add network policies if specified
    if (ingressPolicy) {
      args.push('--ingress-policy', ingressPolicy);
    }
    if (egressPolicy) {
      args.push('--egress-policy', egressPolicy);
    }

    // Add labels if specified
    if (labels && Object.keys(labels).length > 0) {
      const labelPairs = Object.entries(labels).map(([key, value]) => `${key}=${value}`);
      args.push('--labels', ...labelPairs);
    }

    // Add --no-wait flag to make the command non-blocking
    args.push('--no-wait');

    args.push('--output', 'json');

    debugLog('🚀 Initiating managed namespace creation (non-blocking):');
    debugLog('   Command:', 'az', args.join(' '));
    debugLog('   Parameters:', { clusterName, resourceGroup, namespaceName, subscriptionId });

    // Fire the command and don't wait for it to complete
    const { stdout: initStdout, stderr: initStderr } = await runCommandAsync('az', args);

    debugLog('   📤 Initial command output:');
    debugLog('      stdout:', initStdout);
    debugLog('      stderr:', initStderr);

    if (initStderr && needsRelogin(initStderr)) {
      return {
        success: false,
        stdout: initStdout,
        stderr: initStderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (initStderr && (initStderr.includes('ERROR') || initStderr.includes('error'))) {
      return {
        success: false,
        stdout: initStdout,
        stderr: initStderr,
        error: `Failed to initiate managed namespace creation: ${initStderr}`,
      };
    }

    debugLog('✅ Namespace creation initiated, starting status polling...');
    debugLog('   ⏳ Waiting 2 seconds for command to initialize...');

    // Give the command a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Poll for completion status
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    const pollInterval = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      debugLog(`🔄 Polling attempt ${attempt}/${maxAttempts} for namespace status...`);
      debugLog(`   Target namespace: ${namespaceName}`);
      debugLog(`   Cluster: ${clusterName} (RG: ${resourceGroup})`);

      const statusResult = await checkNamespaceStatus(
        clusterName,
        resourceGroup,
        namespaceName,
        subscriptionId
      );

      if (!statusResult.success) {
        return {
          success: false,
          stdout: initStdout,
          stderr: statusResult.stderr,
          error: statusResult.error || 'Failed to check namespace status',
        };
      }

      const status = statusResult.status?.toLowerCase();
      debugLog(`   📊 Namespace status: ${status}`);
      debugLog(`   📝 Status details:`, statusResult);

      if (status === 'succeeded') {
        debugLog('   ✅ Namespace created successfully!');
        return {
          success: true,
          stdout: initStdout,
          stderr: initStderr,
        };
      }

      if (status === 'failed' || status === 'error') {
        debugLog(`   ❌ Namespace creation failed with status: ${status}`);
        return {
          success: false,
          stdout: initStdout,
          stderr: initStderr,
          error: `Namespace creation failed with status: ${status}`,
        };
      }

      // If still in progress or not found yet, wait and try again
      if (
        status === 'creating' ||
        status === 'inprogress' ||
        status === 'updating' ||
        status === 'notfound'
      ) {
        if (attempt < maxAttempts) {
          debugLog(
            `   ⏳ Namespace still ${status}, waiting ${pollInterval}ms before next check...`
          );
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        } else {
          debugLog(
            `   ⏰ Namespace creation timed out after ${maxAttempts} attempts. Status: ${status}`
          );
          return {
            success: false,
            stdout: initStdout,
            stderr: initStderr,
            error: `Namespace creation timed out after ${maxAttempts} attempts. Status: ${status}`,
          };
        }
      }

      // If we get here, the status is unexpected
      debugLog(`   ⚠️  Unexpected namespace status: ${status}`);
      if (attempt < maxAttempts) {
        debugLog(`   ⏳ Waiting ${pollInterval}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      } else {
        debugLog(`   ⏰ Namespace creation timed out with unexpected status: ${status}`);
        return {
          success: false,
          stdout: initStdout,
          stderr: initStderr,
          error: `Namespace creation timed out with unexpected status: ${status}`,
        };
      }
    }

    // This should never be reached, but just in case
    return {
      success: false,
      stdout: initStdout,
      stderr: initStderr,
      error: 'Namespace creation polling completed without resolution',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to create managed namespace: ${errorMessage}`,
    };
  }
}

// Create a role assignment for a namespace
export async function createNamespaceRoleAssignment(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  assignee: string;
  role: string;
  subscriptionId?: string;
}): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const { clusterName, resourceGroup, namespaceName, assignee, role, subscriptionId } = options;

  // Strip quotes from role if present (they may have been added for Windows)
  // We'll handle platform-specific quoting below
  let cleanRole = role.trim();
  if (
    (cleanRole.startsWith('"') && cleanRole.endsWith('"')) ||
    (cleanRole.startsWith("'") && cleanRole.endsWith("'"))
  ) {
    cleanRole = cleanRole.slice(1, -1);
  }

  // Detect platform: On Windows, we need quotes for role names with spaces
  // Use navigator.platform as process.platform is not available in renderer
  const isWindows =
    (typeof navigator !== 'undefined' &&
      (navigator.platform.toLowerCase().includes('win') ||
        navigator.userAgent.toLowerCase().includes('windows'))) ||
    (typeof window !== 'undefined' && (window as any).process?.platform === 'win32') ||
    (typeof process !== 'undefined' && process.platform === 'win32');

  // On Windows, add quotes back for role names with spaces (required for shell execution)
  // On Mac/Linux, don't add quotes (they cause issues)
  const finalRole = isWindows && cleanRole.includes(' ') ? `"${cleanRole}"` : cleanRole;

  try {
    // First, get the resource ID of the managed namespace
    const namespaceArgs = [
      'aks',
      'namespace',
      'show',
      '--cluster-name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--name',
      namespaceName,
      '--query',
      'id',
      '--output',
      'tsv',
    ];

    if (subscriptionId) {
      namespaceArgs.push('--subscription', subscriptionId);
    }

    debugLog('Getting namespace resource ID:', 'az', namespaceArgs.join(' '));

    const { stdout: namespaceStdout, stderr: namespaceStderr } = await runCommandAsync(
      'az',
      namespaceArgs
    );

    if (namespaceStderr && needsRelogin(namespaceStderr)) {
      return {
        success: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (
      namespaceStderr &&
      (namespaceStderr.includes('ERROR') || namespaceStderr.includes('error'))
    ) {
      return {
        success: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: `Failed to get namespace resource ID: ${namespaceStderr}`,
      };
    }

    const namespaceResourceId = namespaceStdout.trim();
    if (!namespaceResourceId) {
      return {
        success: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Failed to get namespace resource ID',
      };
    }

    // Now create the role assignment
    const roleArgs = [
      'role',
      'assignment',
      'create',
      '--assignee',
      assignee,
      '--role',
      finalRole,
      '--scope',
      namespaceResourceId,
    ];

    if (subscriptionId) {
      roleArgs.push('--subscription', subscriptionId);
    }

    roleArgs.push('--output', 'json');

    debugLog('Creating role assignment:', 'az', roleArgs.join(' '));

    const { stdout: roleStdout, stderr: roleStderr } = await runCommandAsync('az', roleArgs);

    if (roleStderr && needsRelogin(roleStderr)) {
      return {
        success: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (roleStderr && (roleStderr.includes('ERROR') || roleStderr.includes('error'))) {
      return {
        success: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: `Failed to create role assignment: ${roleStderr}`,
      };
    }

    return {
      success: true,
      stdout: roleStdout,
      stderr: roleStderr,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to create role assignment: ${errorMessage}`,
    };
  }
}

// Verify if a user has access to a namespace
export async function verifyNamespaceAccess(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  assignee: string;
  subscriptionId?: string;
}): Promise<{
  success: boolean;
  hasAccess: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  const { clusterName, resourceGroup, namespaceName, assignee, subscriptionId } = options;

  try {
    // First, get the resource ID of the managed namespace
    const namespaceArgs = [
      'aks',
      'namespace',
      'show',
      '--cluster-name',
      clusterName,
      '--resource-group',
      resourceGroup,
      '--name',
      namespaceName,
      '--query',
      'id',
      '--output',
      'tsv',
    ];

    if (subscriptionId) {
      namespaceArgs.push('--subscription', subscriptionId);
    }

    debugLog(
      'Getting namespace resource ID for access verification:',
      'az',
      namespaceArgs.join(' ')
    );

    const { stdout: namespaceStdout, stderr: namespaceStderr } = await runCommandAsync(
      'az',
      namespaceArgs
    );

    if (namespaceStderr && needsRelogin(namespaceStderr)) {
      return {
        success: false,
        hasAccess: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (
      namespaceStderr &&
      (namespaceStderr.includes('ERROR') || namespaceStderr.includes('error'))
    ) {
      return {
        success: false,
        hasAccess: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: `Failed to get namespace resource ID: ${namespaceStderr}`,
      };
    }

    const namespaceResourceId = namespaceStdout.trim();
    if (!namespaceResourceId) {
      return {
        success: false,
        hasAccess: false,
        stdout: namespaceStdout,
        stderr: namespaceStderr,
        error: 'Failed to get namespace resource ID',
      };
    }

    // Now check for existing role assignments
    const roleArgs = [
      'role',
      'assignment',
      'list',
      '--assignee',
      assignee,
      '--scope',
      namespaceResourceId,
      '--query',
      '[].{roleDefinitionName:roleDefinitionName,scope:scope}',
      '--output',
      'json',
    ];

    if (subscriptionId) {
      roleArgs.push('--subscription', subscriptionId);
    }

    debugLog('Checking role assignments:', 'az', roleArgs.join(' '));

    const { stdout: roleStdout, stderr: roleStderr } = await runCommandAsync('az', roleArgs);

    if (roleStderr && needsRelogin(roleStderr)) {
      return {
        success: false,
        hasAccess: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (roleStderr && (roleStderr.includes('ERROR') || roleStderr.includes('error'))) {
      return {
        success: false,
        hasAccess: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: `Failed to check role assignments: ${roleStderr}`,
      };
    }

    try {
      const roleAssignments = JSON.parse(roleStdout || '[]');
      const hasAccess = roleAssignments.length > 0;

      return {
        success: true,
        hasAccess,
        stdout: roleStdout,
        stderr: roleStderr,
      };
    } catch (parseError) {
      return {
        success: false,
        hasAccess: false,
        stdout: roleStdout,
        stderr: roleStderr,
        error: 'Failed to parse role assignments response',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      hasAccess: false,
      stdout: '',
      stderr: '',
      error: `Failed to verify namespace access: ${errorMessage}`,
    };
  }
}

// Azure CLI prefixes fatal errors with "ERROR: " in stderr
function isAzError(stderr: string): boolean {
  return stderr.includes('ERROR: ');
}

// Validates Azure resource names: alphanumeric, hyphens, underscores (1-128 chars)
const AZ_RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
function isValidAzResourceName(value: string): boolean {
  return AZ_RESOURCE_NAME_PATTERN.test(value);
}

// Validates GitHub owner/repo/branch names (no path traversal or shell metacharacters)
const GITHUB_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;
function isValidGitHubName(value: string): boolean {
  return GITHUB_NAME_PATTERN.test(value);
}

export interface ManagedIdentityResult {
  success: boolean;
  notFound?: boolean;
  clientId?: string;
  principalId?: string;
  tenantId?: string;
  error?: string;
}

/**
 * Shared helper that runs an `az` CLI command and handles the common
 * error-handling pattern (relogin detection, az-error detection, JSON
 * parsing, and catch-block formatting).
 *
 * @param args          - CLI arguments passed to `az`.
 * @param debugLabel    - Label used in `debugLog` (e.g. "Creating managed identity:").
 * @param errorContext  - Human-readable phrase used in error messages
 *                        (e.g. "create managed identity").
 * @param parseOutput   - Optional function to extract a value from stdout.
 * @param checkStderr   - Optional callback invoked when stderr is non-empty,
 *                        *before* the standard relogin / isAzError checks.
 *                        Return a result object to short-circuit, or `null`
 *                        to fall through to the default checks.
 */
async function runAzCommand<T>(
  args: string[],
  debugLabel: string,
  errorContext: string,
  parseOutput?: (stdout: string) => T,
  checkStderr?: (stderr: string) => { success: boolean; [key: string]: unknown } | null
): Promise<{ success: boolean; data?: T; error?: string; [key: string]: unknown }> {
  try {
    debugLog(debugLabel, 'az', args.join(' '));
    const { stdout, stderr } = await runCommandAsync('az', args);

    if (stderr) {
      if (needsRelogin(stderr)) {
        return {
          success: false,
          error: 'Authentication required. Please log in to Azure CLI: az login',
        };
      }

      if (checkStderr) {
        const earlyReturn = checkStderr(stderr);
        if (earlyReturn) {
          return earlyReturn;
        }
      }

      if (isAzError(stderr)) {
        return { success: false, error: `Failed to ${errorContext}: ${stderr}` };
      }
    }

    const data = parseOutput ? parseOutput(stdout) : undefined;
    return { success: true, data };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to ${errorContext}: ${msg}` };
  }
}

function parseManagedIdentityOutput(stdout: string) {
  let identity;
  try {
    identity = JSON.parse(stdout);
  } catch {
    throw new Error('Unexpected output from az identity command');
  }
  return {
    clientId: identity.clientId as string,
    principalId: identity.principalId as string,
    tenantId: identity.tenantId as string,
  };
}

export async function getManagedIdentity(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<ManagedIdentityResult> {
  const { identityName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  const result = await runAzCommand(
    [
      'identity',
      'show',
      '--name',
      identityName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--output',
      'json',
    ],
    'Getting managed identity:',
    'get managed identity',
    parseManagedIdentityOutput,
    stderr => {
      if (stderr.includes('ResourceNotFound') || stderr.includes('was not found')) {
        return { success: false, notFound: true };
      }
      return null;
    }
  );

  if (!result.success) {
    return {
      success: false,
      notFound: result.notFound as boolean | undefined,
      error: result.error,
    };
  }
  return { success: true, ...result.data };
}

export async function createManagedIdentity(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<ManagedIdentityResult> {
  const { identityName, resourceGroup, subscriptionId } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }

  const result = await runAzCommand(
    [
      'identity',
      'create',
      '--name',
      identityName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--tags',
      'purpose=GitHub Actions OIDC',
      'createdBy=AKS Desktop',
      '--output',
      'json',
    ],
    'Creating managed identity:',
    'create managed identity',
    parseManagedIdentityOutput
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, ...result.data };
}

export async function assignRoleToIdentity(options: {
  principalId: string;
  subscriptionId: string;
  resourceGroup: string;
}): Promise<{ success: boolean; error?: string }> {
  const { principalId, subscriptionId, resourceGroup } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidGuid(principalId)) {
    return { success: false, error: 'Invalid principal ID format' };
  }
  if (!isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid resource group format' };
  }

  const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
  const result = await runAzCommand(
    [
      'role',
      'assignment',
      'create',
      '--assignee-object-id',
      principalId,
      '--assignee-principal-type',
      'ServicePrincipal',
      '--role',
      'Azure Kubernetes Service Cluster User Role',
      '--scope',
      scope,
      '--subscription',
      subscriptionId,
      '--output',
      'json',
    ],
    'Assigning AKS Cluster User Role:',
    'assign role',
    undefined,
    stderr => {
      // Role assignment already exists — treat as success
      if (stderr.includes('RoleAssignmentExists')) {
        debugLog('Role assignment already exists, continuing.');
        return { success: true };
      }
      return null;
    }
  );

  return { success: result.success, error: result.error };
}

export async function createFederatedCredential(options: {
  identityName: string;
  resourceGroup: string;
  subscriptionId: string;
  repoOwner: string;
  repoName: string;
  branch: string;
}): Promise<{ success: boolean; error?: string }> {
  const { identityName, resourceGroup, subscriptionId, repoOwner, repoName, branch } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!isValidAzResourceName(identityName) || !isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid identity name or resource group format' };
  }
  if (!isValidGitHubName(repoOwner) || !isValidGitHubName(repoName) || !isValidGitHubName(branch)) {
    return { success: false, error: 'Invalid GitHub owner, repo name, or branch format' };
  }

  const subject = `repo:${repoOwner}/${repoName}:ref:refs/heads/${branch}`;
  // Sanitize dots in repoName (invalid in Azure resource names) and validate
  const sanitizedRepoName = repoName.replace(/\./g, '-');
  const credentialName = `GitHubActions-${sanitizedRepoName}`;
  if (!isValidAzResourceName(credentialName)) {
    return { success: false, error: 'Invalid federated credential name format' };
  }
  const result = await runAzCommand(
    [
      'identity',
      'federated-credential',
      'create',
      '--identity-name',
      identityName,
      '--resource-group',
      resourceGroup,
      '--subscription',
      subscriptionId,
      '--name',
      credentialName,
      '--issuer',
      'https://token.actions.githubusercontent.com',
      '--subject',
      subject,
      '--audiences',
      'api://AzureADTokenExchange',
      '--output',
      'json',
    ],
    'Creating federated credential:',
    'create federated credential',
    undefined,
    stderr => {
      // Federated credential already exists — treat as success
      if (stderr.includes('FederatedIdentityCredentialAlreadyExists')) {
        debugLog('Federated credential already exists, continuing.');
        return { success: true };
      }
      return null;
    }
  );

  return { success: result.success, error: result.error };
}
