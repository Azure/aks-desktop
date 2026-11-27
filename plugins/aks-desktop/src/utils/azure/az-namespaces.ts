// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
import { K8S_DNS_LABEL_PATTERN } from '../kubernetes/k8sNames';
import type { NamespaceTrafficPolicy } from '../kubernetes/namespaceManifest';
import {
  debugLog,
  getErrorMessage,
  isAzError,
  isValidGuid,
  needsRelogin,
  runCommandAsync,
} from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import {
  type AzRequestOptions,
  azRequestRaw,
  AzureRequestError,
  createAzureRequestSignal,
  waitForAzureRetry,
} from './az-http';
import { type AksClusterReadOptions, getManagedClusterDetails } from './az-managed-clusters';
import {
  deleteManagedNamespaceViaRest,
  type ManagedNamespaceDeleteOptions,
} from './az-managed-namespace-delete';
import { getSubscriptionCredential } from './az-token';

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

/** Deletes the ARM resource without changing its Keep or Delete policy. */
export async function deleteManagedNamespace(
  options: ManagedNamespaceDeleteOptions
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  return deleteManagedNamespaceViaRest(options);
}

type NamespaceOptions = AksClusterReadOptions & { namespaceName: string; cloudName?: string };
type NamespaceResource = { properties?: { provisioningState?: string } };

/** Builds the namespace URL and selects the credential for the ARM request. */
async function namespaceRequest(options: NamespaceOptions) {
  const { subscriptionId, resourceGroup, clusterName, namespaceName } = options;
  if (!isValidGuid(subscriptionId)) {
    throw new Error('The subscription ID must be a GUID.');
  }
  for (const [field, value] of Object.entries({ resourceGroup, clusterName })) {
    if (!value?.trim() || ['.', '..'].includes(value) || /[/\\]/.test(value)) {
      throw new Error(
        `Invalid ${field}: expected a nonempty name without slashes, other than "." or "..".`
      );
    }
  }
  if (!K8S_DNS_LABEL_PATTERN.test(namespaceName)) {
    throw new Error('The namespace name must be a Kubernetes DNS label.');
  }
  const cloud =
    !options.credential && (!options.endpoint || !options.scope)
      ? await getAzureCloudEndpoints(options.cloudName, options.signal)
      : undefined;
  return {
    ...options,
    endpoint: options.endpoint ?? cloud?.endpoint,
    scope: options.scope ?? cloud?.scope,
    credential: options.credential ?? getSubscriptionCredential(subscriptionId),
    url: `/subscriptions/${subscriptionId}/resourceGroups/${encodeURIComponent(
      resourceGroup
    )}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(
      clusterName
    )}/managedNamespaces/${encodeURIComponent(namespaceName)}`,
    apiVersion: '2026-01-01',
  };
}

/** Returns undefined if Azure cannot find the namespace. Other errors are thrown. */
async function readNamespace(request: AzRequestOptions) {
  try {
    const response = await azRequestRaw<NamespaceResource>(request);
    if (!response.data?.properties) throw new Error('Missing managed namespace properties');
    return response;
  } catch (error) {
    if (
      error instanceof AzureRequestError &&
      error.status === 404 &&
      ['NotFound', 'ResourceNotFound', 'NamespaceNotFound'].includes(error.code ?? '')
    ) {
      return undefined;
    }
    throw error;
  }
}

/** Returns 'unknown' if the namespace has no provisioning state, or 'notfound' if it does not exist. */
export async function checkNamespaceStatus(options: NamespaceOptions) {
  const linked = createAzureRequestSignal(options.signal, options.timeoutMs);
  try {
    const request = await namespaceRequest({ ...options, signal: linked.signal });
    const resource = await readNamespace(request);
    return resource ? resource.data?.properties?.provisioningState ?? 'unknown' : 'notfound';
  } finally {
    linked.dispose();
  }
}

/** Sends one create request and waits for Azure to finish creating the namespace. */
export async function createManagedNamespace(
  options: NamespaceOptions & {
    cpuRequest: number;
    cpuLimit: number;
    memoryRequest: number;
    memoryLimit: number;
    ingressPolicy?: NamespaceTrafficPolicy;
    egressPolicy?: NamespaceTrafficPolicy;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  }
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const linked = createAzureRequestSignal(options.signal, options.timeoutMs ?? 5 * 60_000);
  try {
    const { cpuRequest, cpuLimit, memoryRequest, memoryLimit } = options;
    if (
      ![cpuRequest, cpuLimit, memoryRequest, memoryLimit].every(n => Number.isFinite(n) && n >= 0)
    ) {
      throw new Error('CPU and memory requests and limits are required');
    }
    const request = await namespaceRequest({ ...options, signal: linked.signal });
    const { location } = await getManagedClusterDetails(request);
    if (!location?.trim()) throw new Error('Missing managed AKS cluster location');
    const created = await azRequestRaw<NamespaceResource>({
      ...request,
      method: 'PUT',
      body: {
        location,
        properties: {
          adoptionPolicy: 'Never',
          deletePolicy: 'Keep',
          labels: options.labels ?? {},
          annotations: options.annotations ?? {},
          defaultResourceQuota: {
            cpuRequest: `${cpuRequest}m`,
            cpuLimit: `${cpuLimit}m`,
            memoryRequest: `${memoryRequest}Mi`,
            memoryLimit: `${memoryLimit}Mi`,
          },
          defaultNetworkPolicy: {
            ingress: options.ingressPolicy ?? 'AllowSameNamespace',
            egress: options.egressPolicy ?? 'AllowAll',
          },
        },
      },
    });
    let response: typeof created | undefined = created;
    for (;;) {
      const state = response?.data?.properties?.provisioningState?.toLowerCase();
      if (state === 'succeeded') return { success: true, stdout: '', stderr: '' };
      if (state && ['failed', 'error', 'canceled', 'cancelled'].includes(state)) {
        throw new Error(`Namespace provisioning ${state}`);
      }
      await waitForAzureRetry(response?.headers, linked.signal);
      response = await readNamespace(request);
    }
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to create managed namespace: ${getErrorMessage(error)}`,
    };
  } finally {
    linked.dispose();
  }
}
