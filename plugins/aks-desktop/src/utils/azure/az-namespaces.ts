// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { debugLog, getErrorMessage, isAzError, needsRelogin, runCommandAsync } from './az-cli-core';
import {
  deleteManagedNamespaceViaRest,
  type ManagedNamespaceDeleteOptions,
} from './az-managed-namespace-delete';

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

  if (stderr && isAzError(stderr)) {
    throw new Error(`Failed to get managed namespaces: ${stderr}`);
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
    throw new Error(`Failed to parse managed namespaces response: ${error}`);
  }
}

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

  if (stderr && isAzError(stderr)) {
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

  // Re-pass existing labels to pass into az namespace update command
  // so the ARM PUT doesn't wipe them.
  try {
    const current = await getManagedNamespaceDetails({
      clusterName,
      resourceGroup,
      namespaceName,
      subscriptionId,
    });
    const labels = current?.properties?.labels ?? current?.labels;
    const entries = labels && typeof labels === 'object' ? Object.entries(labels) : [];
    if (entries.length > 0) {
      args.push('--labels', ...entries.map(([k, v]) => `${k}=${v}`));
    }
  } catch (error) {
    throw new Error(
      `Failed to read existing namespace labels before update; aborting to avoid wiping labels: ${getErrorMessage(
        error
      )}`
    );
  }

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
  if (stderr && isAzError(stderr)) {
    throw new Error(`Failed to update managed namespace: ${stderr}`);
  }

  try {
    return JSON.parse(stdout || '{}');
  } catch {
    // Some updates might not return a body; return empty object on success
    return {};
  }
}

export async function checkNamespaceStatus(
  clusterName: string,
  resourceGroup: string,
  namespaceName: string,
  subscriptionId?: string
): Promise<{ success: boolean; status?: string; stdout: string; stderr: string; error?: string }> {
  // Sanitize inputs to prevent JMESPath injection
  if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
    return { success: false, stdout: '', stderr: '', error: 'Invalid cluster name format' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(namespaceName)) {
    return { success: false, stdout: '', stderr: '', error: 'Invalid namespace name format' };
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

    debugLog('[AZ-CLI] Checking namespace status via list command:');
    debugLog('   Command:', 'az', args.join(' '));
    debugLog('   Parameters:', { clusterName, resourceGroup, namespaceName, subscriptionId });

    const { stdout, stderr } = await runCommandAsync('az', args);

    debugLog('[AZ-CLI] Command output:');
    debugLog('      stdout:', stdout);
    debugLog('      stderr:', stderr);

    if (stderr && needsRelogin(stderr)) {
      debugLog('[AZ-CLI] Authentication error detected');
      return {
        success: false,
        stdout,
        stderr,
        error: 'Authentication required. Please log in to Azure CLI: az login',
      };
    }

    if (stderr && isAzError(stderr)) {
      debugLog('[AZ-CLI] Command error detected');
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to check namespace status: ${stderr}`,
      };
    }

    debugLog('[AZ-CLI] Status analysis:');

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
      debugLog('[AZ-CLI] Failed to parse JSON response');
      return {
        success: false,
        stdout,
        stderr,
        error: `Failed to parse namespace status response: ${parseError}`,
      };
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to check namespace status: ${errorMessage}`,
    };
  }
}

/**
 * @param options - Managed namespace coordinates and optional shared deadline/auth overrides.
 * @returns The REST deletion result after observed completion/absence, preserving
 * Keep/Delete policy. Expected failures resolve with success=false and error;
 * stdout/stderr remain empty for compatibility with existing callers.
 */
export async function deleteManagedNamespace(
  options: ManagedNamespaceDeleteOptions
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  return deleteManagedNamespaceViaRest(options);
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

    debugLog('[AZ-CLI] Initiating managed namespace creation (non-blocking):');
    debugLog('   Command:', 'az', args.join(' '));
    debugLog('   Parameters:', { clusterName, resourceGroup, namespaceName, subscriptionId });

    // Fire the command and don't wait for it to complete
    const { stdout: initStdout, stderr: initStderr } = await runCommandAsync('az', args);

    debugLog('[AZ-CLI] Initial command output:');
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

    if (initStderr && isAzError(initStderr)) {
      return {
        success: false,
        stdout: initStdout,
        stderr: initStderr,
        error: `Failed to initiate managed namespace creation: ${initStderr}`,
      };
    }

    debugLog('[AZ-CLI] Namespace creation initiated, starting status polling...');
    debugLog('[AZ-CLI] Waiting 2 seconds for command to initialize...');

    // Give the command a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Poll for completion status
    const maxAttempts = 60; // 5 minutes with 5-second intervals
    const pollInterval = 5000; // 5 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      debugLog(`[AZ-CLI] Polling attempt ${attempt}/${maxAttempts} for namespace status...`);
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
      debugLog(`[AZ-CLI] Namespace status: ${status}`);
      debugLog(`[AZ-CLI] Status details:`, statusResult);

      if (status === 'succeeded') {
        debugLog('[AZ-CLI] Namespace created successfully!');
        return {
          success: true,
          stdout: initStdout,
          stderr: initStderr,
        };
      }

      if (status === 'failed' || status === 'error') {
        debugLog(`[AZ-CLI] Namespace creation failed with status: ${status}`);
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
            `[AZ-CLI] Namespace still ${status}, waiting ${pollInterval}ms before next check...`
          );
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        } else {
          debugLog(
            `[AZ-CLI] Namespace creation timed out after ${maxAttempts} attempts. Status: ${status}`
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
      debugLog(`[AZ-CLI] Unexpected namespace status: ${status}`);
      if (attempt < maxAttempts) {
        debugLog(`[AZ-CLI] Waiting ${pollInterval}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      } else {
        debugLog(`[AZ-CLI] Namespace creation timed out with unexpected status: ${status}`);
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
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to create managed namespace: ${errorMessage}`,
    };
  }
}
