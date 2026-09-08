// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { azureCredential } from '../../azureAuth';
import { debugLog, getErrorMessage } from './az-helpers';

export async function getManagedNamespaces(options: {
  clusterName: string;
  resourceGroup: string;
  subscriptionId: string;
}): Promise<string[]> {
  const { clusterName, resourceGroup, subscriptionId } = options;

  debugLog('Getting managed namespaces:', { clusterName, resourceGroup, subscriptionId });

  const client = new ContainerServiceClient(azureCredential, subscriptionId);

  const names: string[] = [];
  for await (const ns of client.managedNamespaces.listByManagedCluster(
    resourceGroup,
    clusterName
  )) {
    if (ns.name) {
      names.push(ns.name);
    }
  }

  return names;
}

export async function getManagedNamespaceDetails(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId?: string;
}): Promise<any> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  debugLog('Getting managed namespace details:', {
    clusterName,
    resourceGroup,
    namespaceName,
    subscriptionId,
  });

  try {
    const client = new ContainerServiceClient(azureCredential, subscriptionId!);
    return await client.managedNamespaces.get(resourceGroup, clusterName, namespaceName);
  } catch (error) {
    console.error('Failed to get managed namespace details:', error);
    throw new Error(`Failed to get managed namespace details: ${getErrorMessage(error)}`);
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
  } = options;

  const client = new ContainerServiceClient(azureCredential, subscriptionId!);

  // Read the existing namespace first so the ARM PUT does not wipe labels or
  // other properties we are not explicitly changing.
  const existing = await client.managedNamespaces.get(resourceGroup, clusterName, namespaceName);

  return await client.managedNamespaces.beginCreateOrUpdateAndWait(
    resourceGroup,
    clusterName,
    namespaceName,
    {
      ...existing,
      properties: {
        ...existing.properties,
        defaultResourceQuota: {
          ...existing.properties?.defaultResourceQuota,
          cpuRequest:
            cpuRequest !== undefined
              ? `${cpuRequest}m`
              : existing.properties?.defaultResourceQuota?.cpuRequest,
          cpuLimit:
            cpuLimit !== undefined
              ? `${cpuLimit}m`
              : existing.properties?.defaultResourceQuota?.cpuLimit,
          memoryRequest:
            memoryRequest !== undefined
              ? `${memoryRequest}Mi`
              : existing.properties?.defaultResourceQuota?.memoryRequest,
          memoryLimit:
            memoryLimit !== undefined
              ? `${memoryLimit}Mi`
              : existing.properties?.defaultResourceQuota?.memoryLimit,
        },
        defaultNetworkPolicy: {
          ...existing.properties?.defaultNetworkPolicy,
          ingress: ingressPolicy ?? existing.properties?.defaultNetworkPolicy?.ingress,
          egress: egressPolicy ?? existing.properties?.defaultNetworkPolicy?.egress,
        },
      },
    }
  );
}

export async function checkNamespaceStatus(
  clusterName: string,
  resourceGroup: string,
  namespaceName: string,
  subscriptionId?: string
): Promise<{ success: boolean; status?: string; stdout: string; stderr: string; error?: string }> {
  // Sanitize inputs to keep parity with prior validation.
  if (!/^[a-zA-Z0-9_-]+$/.test(clusterName)) {
    return { success: false, stdout: '', stderr: '', error: 'Invalid cluster name format' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(namespaceName)) {
    return { success: false, stdout: '', stderr: '', error: 'Invalid namespace name format' };
  }

  try {
    const client = new ContainerServiceClient(azureCredential, subscriptionId!);

    debugLog('[AZ] Checking namespace status:', {
      clusterName,
      resourceGroup,
      namespaceName,
      subscriptionId,
    });

    const namespace = await client.managedNamespaces.get(resourceGroup, clusterName, namespaceName);

    const status = namespace?.properties?.provisioningState;

    if (!status) {
      debugLog('[AZ] Status: unknown (no provisioningState found)');
      return { success: true, status: 'unknown', stdout: '', stderr: '' };
    }

    debugLog('[AZ] Status:', status);
    return { success: true, status, stdout: '', stderr: '' };
  } catch (error) {
    // A 404 means the namespace does not exist yet (e.g. mid-creation).
    if ((error as any)?.statusCode === 404) {
      debugLog('[AZ] Status: notfound');
      return { success: true, status: 'notfound', stdout: '', stderr: '' };
    }

    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to check namespace status: ${getErrorMessage(error)}`,
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
    const client = new ContainerServiceClient(azureCredential, subscriptionId);
    await client.managedNamespaces.beginDeleteAndWait(resourceGroup, clusterName, namespaceName);

    return { success: true, stdout: '', stderr: '' };
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to delete managed namespace: ${getErrorMessage(error)}`,
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
    const client = new ContainerServiceClient(azureCredential, subscriptionId!);

    // The managed namespace inherits its location from the parent cluster.
    const cluster = await client.managedClusters.get(resourceGroup, clusterName);
    const location = cluster.location;

    debugLog('[AZ] Creating managed namespace:', {
      clusterName,
      resourceGroup,
      namespaceName,
      subscriptionId,
    });

    await client.managedNamespaces.beginCreateOrUpdateAndWait(
      resourceGroup,
      clusterName,
      namespaceName,
      {
        location,
        properties: {
          labels,
          defaultResourceQuota: {
            cpuRequest: cpuRequest !== undefined ? `${cpuRequest}m` : undefined,
            cpuLimit: cpuLimit !== undefined ? `${cpuLimit}m` : undefined,
            memoryRequest: memoryRequest !== undefined ? `${memoryRequest}Mi` : undefined,
            memoryLimit: memoryLimit !== undefined ? `${memoryLimit}Mi` : undefined,
          },
          defaultNetworkPolicy: {
            ingress: ingressPolicy as any,
            egress: egressPolicy as any,
          },
        },
      }
    );

    return { success: true, stdout: '', stderr: '' };
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to create managed namespace: ${getErrorMessage(error)}`,
    };
  }
}
