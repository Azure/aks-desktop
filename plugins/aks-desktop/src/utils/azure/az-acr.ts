// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Azure Container Registry functions.

import {
  debugLog,
  getErrorMessage,
  isValidGuid,
  needsRelogin,
  runCommandAsync,
} from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import {
  azListAll,
  azRequestRaw,
  type AzResponse,
  AzureRequestError,
  waitForAzureRetry,
} from './az-http';
import { registerContainerRegistryProvider } from './az-resource-providers';
import { getSubscriptionCredential } from './az-token';
import { isValidAzResourceName } from './az-validation';

const ACR_API_VERSION = '2023-07-01';
const CREATE_TIMEOUT_MS = 10 * 60 * 1000;

/** Azure Container Registry name: 5-50 lowercase alphanumeric characters. */
export const ACR_NAME_PATTERN = /^[a-z0-9]{5,50}$/;

/** Shared validation error for invalid ACR names. */
export const ACR_NAME_ERROR = 'Registry name must be 5-50 lowercase alphanumeric characters.';

interface RegistryResource {
  id: string;
  name: string;
  location: string;
  sku?: { name?: AcrSku } | AcrSku;
  properties?: {
    loginServer?: string;
    provisioningState?: string;
  };
}

interface RegistryOperation {
  status?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

function registryResourceGroup(id: string): string {
  const segments = id.split('/');
  const index = segments.findIndex(segment => segment.toLowerCase() === 'resourcegroups');
  return index >= 0 && segments[index + 1] ? decodeURIComponent(segments[index + 1]) : '';
}

/**
 * Creates an Azure Container Registry.
 */
export async function createContainerRegistry(options: {
  registryName: string;
  resourceGroup: string;
  subscriptionId: string;
  location: string;
  sku?: 'Basic' | 'Standard' | 'Premium';
}): Promise<{ success: boolean; id?: string; loginServer?: string; error?: string }> {
  const { registryName, resourceGroup, subscriptionId, location, sku = 'Basic' } = options;

  if (!isValidGuid(subscriptionId)) {
    return { success: false, error: 'Invalid subscription ID format' };
  }
  if (!ACR_NAME_PATTERN.test(registryName)) {
    return {
      success: false,
      error: `Invalid registry name: ${ACR_NAME_ERROR}`,
    };
  }
  if (!isValidAzResourceName(resourceGroup)) {
    return { success: false, error: 'Invalid resource group name format' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new AzureRequestError('Registry creation timed out')),
    CREATE_TIMEOUT_MS
  );
  try {
    const cloud = await getAzureCloudEndpoints(undefined, controller.signal);
    const request = {
      endpoint: cloud.endpoint,
      scope: cloud.scope,
      credential: getSubscriptionCredential(subscriptionId),
      apiVersion: ACR_API_VERSION,
      signal: controller.signal,
    };
    const url =
      `/subscriptions/${encodeURIComponent(subscriptionId)}` +
      `/resourceGroups/${encodeURIComponent(resourceGroup)}` +
      `/providers/Microsoft.ContainerRegistry/registries/${encodeURIComponent(registryName)}`;
    const createRequest = {
      ...request,
      url,
      method: 'PUT' as const,
      body: { location, sku: { name: sku } },
      timeoutMs: CREATE_TIMEOUT_MS,
    };
    let response: AzResponse<RegistryResource>;
    let registrationRequested = false;
    let registrationRetryAttempt = 0;
    for (;;) {
      try {
        response = await azRequestRaw<RegistryResource>(createRequest);
        break;
      } catch (error) {
        if (
          !(error instanceof AzureRequestError) ||
          error.code !== 'MissingSubscriptionRegistration'
        ) {
          throw error;
        }
        if (registrationRequested) {
          await waitForAzureRetry(undefined, controller.signal, registrationRetryAttempt++);
        } else {
          const registration = await registerContainerRegistryProvider(subscriptionId, {
            endpoint: cloud.endpoint,
            scope: cloud.scope,
            credential: request.credential,
            signal: controller.signal,
            timeoutMs: CREATE_TIMEOUT_MS,
            waitUntilRegistered: false,
          });
          if (!registration.success) throw new Error(registration.error);
          registrationRequested = true;
        }
      }
    }

    const operationHeader = response.headers.get('azure-asyncoperation');
    if (operationHeader) {
      const resourceUrl = new URL(url, cloud.endpoint);
      const operationUrl = new URL(operationHeader, resourceUrl);
      if (operationUrl.origin !== resourceUrl.origin) {
        throw new AzureRequestError('Refusing to poll registry creation on an untrusted host');
      }

      let headers = response.headers;
      for (;;) {
        await waitForAzureRetry(headers, controller.signal);
        const operation = await azRequestRaw<RegistryOperation>({
          ...request,
          url: operationUrl.href,
          timeoutMs: CREATE_TIMEOUT_MS,
        });
        headers = operation.headers;
        const status = operation.data?.status;
        if (typeof status !== 'string' || !status.trim()) {
          throw new AzureRequestError('Registry creation operation response is missing its status');
        }
        const normalizedStatus = status.toLowerCase();
        if (normalizedStatus === 'succeeded') break;
        if (['failed', 'canceled', 'cancelled'].includes(normalizedStatus)) {
          const detail = operation.data?.error;
          throw new AzureRequestError(
            [detail?.code, detail?.message ?? 'Registry creation failed']
              .filter(Boolean)
              .join(': '),
            { code: detail?.code }
          );
        }
      }
      response = await azRequestRaw<RegistryResource>({
        ...request,
        url,
        timeoutMs: CREATE_TIMEOUT_MS,
      });
    }

    let registry = response.data;
    let state = registry?.properties?.provisioningState;
    if (state !== undefined && (typeof state !== 'string' || !state.trim())) {
      throw new AzureRequestError('Registry creation response is missing its provisioning state');
    }
    if (typeof state === 'string') {
      let headers = response.headers;
      for (;;) {
        const normalizedState = state.toLowerCase();
        if (normalizedState === 'succeeded') break;
        if (['failed', 'canceled', 'cancelled'].includes(normalizedState)) {
          throw new AzureRequestError(`Registry provisioning failed: ${state}`);
        }
        await waitForAzureRetry(headers, controller.signal);
        const progress = await azRequestRaw<RegistryResource>({
          ...request,
          url,
          timeoutMs: CREATE_TIMEOUT_MS,
        });
        headers = progress.headers;
        registry = progress.data;
        state = registry?.properties?.provisioningState;
        if (typeof state !== 'string' || !state.trim()) {
          throw new AzureRequestError(
            'Registry provisioning response is missing its provisioning state'
          );
        }
      }
    }

    if (
      typeof registry?.id !== 'string' ||
      !registry.id.trim() ||
      typeof registry.properties?.loginServer !== 'string' ||
      !registry.properties.loginServer.trim()
    ) {
      throw new AzureRequestError('Registry creation returned an incomplete registry');
    }
    return {
      success: true,
      id: registry.id,
      loginServer: registry.properties.loginServer,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create container registry: ${getErrorMessage(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type AcrSku = 'Basic' | 'Standard' | 'Premium';

export interface AcrInfo {
  id: string;
  name: string;
  resourceGroup: string;
  loginServer: string;
  location: string;
  sku: AcrSku;
}

export async function getContainerRegistries(subscriptionId: string): Promise<AcrInfo[]> {
  if (!isValidGuid(subscriptionId)) {
    throw new Error('Invalid subscription ID format');
  }

  try {
    const cloud = await getAzureCloudEndpoints();
    const registries = await azListAll<RegistryResource>({
      url:
        `/subscriptions/${encodeURIComponent(subscriptionId)}` +
        '/providers/Microsoft.ContainerRegistry/registries',
      apiVersion: ACR_API_VERSION,
      endpoint: cloud.endpoint,
      scope: cloud.scope,
      credential: getSubscriptionCredential(subscriptionId),
    });
    return registries.map(registry => ({
      id: registry.id,
      name: registry.name,
      resourceGroup: registryResourceGroup(registry.id),
      loginServer: registry.properties?.loginServer ?? '',
      location: registry.location,
      sku: (typeof registry.sku === 'string' ? registry.sku : registry.sku?.name) ?? 'Basic',
    }));
  } catch (error) {
    throw new Error(`Failed to get container registries: ${getErrorMessage(error)}`);
  }
}

export async function getContainerImages(
  subscriptionId: string,
  registryName?: string
): Promise<any[]> {
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
