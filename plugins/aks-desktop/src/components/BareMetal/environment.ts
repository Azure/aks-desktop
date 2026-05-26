// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * BareMetal test environment setup and teardown utilities.
 *
 * Wraps the aksArc jumpstart scripts to provision and destroy
 * Azure VM-based AKS BareMetal environments for development and testing.
 *
 * @see https://github.com/Azure/aksArc/tree/main/aksarc_jumpstart
 */

import {
  debugLog,
  getErrorMessage,
  isAzError,
  runCommandAsync,
} from '../../utils/azure/az-cli-core';

/** Parameters for provisioning a BareMetal test environment. */
export interface BareMetalEnvironmentConfig {
  /** Azure subscription GUID. */
  subscription: string;
  /** Resource group name (default: `'jumpstart-rg'`). */
  groupName?: string;
  /** Azure region (e.g. `'eastus'`). */
  location: string;
  /** VM admin username. */
  username: string;
  /** VM admin password. */
  password: string;
  /** Virtual network name (default: `'jumpstartVNet'`). */
  vnetName?: string;
  /** Virtual machine name (default: `'jumpstartVM'`). */
  vmName?: string;
  /** Subnet name (default: `'jumpstartSubnet'`). */
  subnetName?: string;
  /** VM size (SKU) (default: `'Standard_E16s_v5'`). */
  vmSize?: string;
}

/** Default values for optional BareMetal environment parameters. */
export const BAREMETAL_ENV_DEFAULTS = {
  groupName: 'jumpstart-rg',
  vnetName: 'jumpstartVNet',
  vmName: 'jumpstartVM',
  subnetName: 'jumpstartSubnet',
  vmSize: 'Standard_E16s_v5',
} as const;

/** Result from a BareMetal environment setup or teardown operation. */
export interface BareMetalEnvironmentResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** Human-readable status or error message. */
  message: string;
}

/**
 * Required Azure resource providers for AKS BareMetal environments.
 * These must be registered before setup.
 */
const REQUIRED_PROVIDERS = [
  'Microsoft.Kubernetes',
  'Microsoft.KubernetesConfiguration',
  'Microsoft.ExtendedLocation',
  'Microsoft.ResourceConnector',
  'Microsoft.AzureStackHCI',
  'Microsoft.HybridConnectivity',
  'Microsoft.HybridContainerService',
] as const;

/**
 * Registers the Azure resource providers required for AKS BareMetal.
 *
 * @param subscription - Azure subscription GUID to register providers in.
 * @returns A result indicating success or the first registration failure.
 */
export async function registerBareMetalProviders(
  subscription: string
): Promise<BareMetalEnvironmentResult> {
  for (const provider of REQUIRED_PROVIDERS) {
    debugLog(`[BAREMETAL-ENV] Registering provider: ${provider}`);
    const { stderr } = await runCommandAsync('az', [
      'provider',
      'register',
      '--namespace',
      provider,
      '--subscription',
      subscription,
      '--wait',
    ]);

    if (stderr && isAzError(stderr)) {
      return {
        success: false,
        message: `Failed to register provider ${provider}: ${stderr}`,
      };
    }
  }

  return { success: true, message: 'All required providers registered successfully.' };
}

/**
 * Creates the Azure resource group for the BareMetal test environment.
 *
 * @param config - Environment configuration.
 * @returns A result indicating success or failure.
 */
export async function createResourceGroup(
  config: BareMetalEnvironmentConfig
): Promise<BareMetalEnvironmentResult> {
  const groupName = config.groupName || BAREMETAL_ENV_DEFAULTS.groupName;

  debugLog(`[BAREMETAL-ENV] Creating resource group: ${groupName} in ${config.location}`);
  const { stderr } = await runCommandAsync('az', [
    'group',
    'create',
    '--name',
    groupName,
    '--location',
    config.location,
    '--subscription',
    config.subscription,
  ]);

  if (stderr && isAzError(stderr)) {
    return {
      success: false,
      message: `Failed to create resource group: ${stderr}`,
    };
  }

  return { success: true, message: `Resource group '${groupName}' created.` };
}

/**
 * Sets up an AKS BareMetal test environment.
 *
 * This is a high-level orchestration function that:
 * 1. Registers required Azure resource providers.
 * 2. Creates the resource group.
 * 3. Provisions the VM with nested virtualisation.
 * 4. Assigns a managed identity with Contributor role to the VM.
 * 5. Installs Hyper-V on the VM via `az vm run-command invoke`.
 *
 * The VM uses a Standard_E16s_v5 SKU (16 vCPUs, 128 GiB) by default, with
 * nested Hyper-V support and a 1024 GiB Premium SSD data disk (required by
 * the upstream `initializedisk.ps1` to set the working directory).
 *
 * Note: this function only provisions the VM infrastructure. The full aksArc
 * jumpstart init scripts (disk init, Hyper-V config, MOC install, etc.) are
 * run separately by the `deployAksArc` command.
 *
 * @param config - Environment configuration.
 * @returns A result with success/failure and a status message.
 */
export async function setupBareMetalEnvironment(
  config: BareMetalEnvironmentConfig
): Promise<BareMetalEnvironmentResult> {
  const groupName = config.groupName || BAREMETAL_ENV_DEFAULTS.groupName;
  const vmName = config.vmName || BAREMETAL_ENV_DEFAULTS.vmName;
  const vnetName = config.vnetName || BAREMETAL_ENV_DEFAULTS.vnetName;
  const subnetName = config.subnetName || BAREMETAL_ENV_DEFAULTS.subnetName;
  const vmSize = config.vmSize || BAREMETAL_ENV_DEFAULTS.vmSize;

  try {
    // Step 1: Register providers
    debugLog('[BAREMETAL-ENV] Step 1/5: Registering resource providers...');
    const providerResult = await registerBareMetalProviders(config.subscription);
    if (!providerResult.success) {
      return providerResult;
    }

    // Step 2: Create resource group
    debugLog('[BAREMETAL-ENV] Step 2/5: Creating resource group...');
    const rgResult = await createResourceGroup(config);
    if (!rgResult.success) {
      return rgResult;
    }

    // Step 3: Create VM
    debugLog('[BAREMETAL-ENV] Step 3/5: Creating VM...');
    const vmCreateArgs = [
      'vm',
      'create',
      '--resource-group',
      groupName,
      '--name',
      vmName,
      '--image',
      'MicrosoftWindowsServer:WindowsServer:2022-datacenter-azure-edition:latest',
      '--size',
      vmSize,
      '--admin-username',
      config.username,
      '--admin-password',
      config.password,
      '--vnet-name',
      vnetName,
      '--subnet',
      subnetName,
      '--public-ip-sku',
      'Standard',
      // The upstream initializedisk.ps1 script requires a raw data disk to
      // initialise. Without it $env:WorkingDir is never set and deployappliance
      // fails with "The given path's format is not supported".
      '--data-disk-sizes-gb',
      '1024',
      '--storage-sku',
      '0=Premium_LRS',
      '--subscription',
      config.subscription,
      '--output',
      'json',
    ];
    const redactedVmCreateArgs = vmCreateArgs.map((arg, index) =>
      index > 0 && vmCreateArgs[index - 1] === '--admin-password' ? '***' : arg
    );
    const vmResult = await runCommandAsync('az', vmCreateArgs, {
      redactedArgs: redactedVmCreateArgs,
    });

    if (vmResult.stderr && isAzError(vmResult.stderr)) {
      return {
        success: false,
        message: `Failed to create VM: ${vmResult.stderr}`,
      };
    }

    debugLog('[BAREMETAL-ENV] VM created:', vmResult.stdout);

    // Step 4: Assign managed identity + Contributor role
    debugLog('[BAREMETAL-ENV] Step 4/5: Assigning managed identity...');
    const identityResult = await runCommandAsync('az', [
      'vm',
      'identity',
      'assign',
      '--resource-group',
      groupName,
      '--name',
      vmName,
      '--subscription',
      config.subscription,
    ]);

    if (identityResult.stderr && isAzError(identityResult.stderr)) {
      return {
        success: false,
        message: `Failed to assign managed identity: ${identityResult.stderr}`,
      };
    }

    // Get the principal ID and assign Contributor role
    const showResult = await runCommandAsync('az', [
      'vm',
      'show',
      '--resource-group',
      groupName,
      '--name',
      vmName,
      '--query',
      'identity.principalId',
      '-o',
      'tsv',
      '--subscription',
      config.subscription,
    ]);

    const principalId = showResult.stdout.trim();
    if (principalId) {
      await runCommandAsync('az', [
        'role',
        'assignment',
        'create',
        '--assignee',
        principalId,
        '--role',
        'Contributor',
        '--scope',
        `/subscriptions/${config.subscription}`,
      ]);
    }

    // Step 5: Run initialisation via VM run-command (no RDP required)
    debugLog('[BAREMETAL-ENV] Step 5/5: Running initialisation scripts on VM...');
    const initResult = await runCommandAsync('az', [
      'vm',
      'run-command',
      'invoke',
      '--resource-group',
      groupName,
      '--name',
      vmName,
      '--command-id',
      'RunPowerShellScript',
      '--scripts',
      'Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart',
      '--subscription',
      config.subscription,
    ]);

    if (initResult.stderr && isAzError(initResult.stderr)) {
      debugLog('[BAREMETAL-ENV] Hyper-V install warning (may require restart):', initResult.stderr);
    }

    return {
      success: true,
      message:
        `BareMetal test environment created successfully.\n` +
        `Resource group: ${groupName}\n` +
        `VM: ${vmName}\n\n` +
        `The VM has been provisioned with a managed identity and Contributor role.\n` +
        `Hyper-V installation has been initiated (VM will restart).\n\n` +
        `Next steps:\n` +
        `1. RDP into the VM and wait for Server Manager to appear, then disconnect.\n` +
        `2. Run deployAksArc to execute the full aksArc jumpstart init sequence.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Setup failed: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * Tears down an AKS BareMetal test environment by deleting the resource group
 * and all resources within it.
 *
 * @param subscription - Azure subscription GUID.
 * @param groupName - Resource group to delete (default: `'jumpstart-rg'`).
 * @returns A result with success/failure and a status message.
 */
export async function teardownBareMetalEnvironment(
  subscription: string,
  groupName: string = BAREMETAL_ENV_DEFAULTS.groupName
): Promise<BareMetalEnvironmentResult> {
  try {
    debugLog(`[BAREMETAL-ENV] Tearing down resource group: ${groupName}`);
    const { stderr } = await runCommandAsync('az', [
      'group',
      'delete',
      '--name',
      groupName,
      '--subscription',
      subscription,
      '--yes',
      '--no-wait',
    ]);

    if (stderr && isAzError(stderr)) {
      return {
        success: false,
        message: `Failed to delete resource group: ${stderr}`,
      };
    }

    return {
      success: true,
      message:
        `Resource group '${groupName}' deletion initiated. ` +
        `This may take several minutes to complete.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Teardown failed: ${getErrorMessage(error)}`,
    };
  }
}
