// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { azureCredential } from '../../azureAuth';

/**
 * Check if the ManagedNamespacePreview feature is registered for a subscription.
 */
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
    const { FeatureClient } = await import('@azure/arm-features');
    const client = new FeatureClient(azureCredential, subscription);

    const feature = await client.features.get(
      'Microsoft.ContainerService',
      'ManagedNamespacePreview'
    );

    const state = feature.properties?.state;

    return {
      registered: state === 'Registered',
      state,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { registered: false, error: errorMessage };
  }
}

/**
 * Register the ManagedNamespacePreview feature for a subscription.
 */
export async function registerManagedNamespacePreview({
  subscription,
}: {
  subscription: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { FeatureClient } = await import('@azure/arm-features');
    const client = new FeatureClient(azureCredential, subscription);

    await client.features.register('Microsoft.ContainerService', 'ManagedNamespacePreview');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Failed to register ManagedNamespacePreview feature: ${errorMessage}`,
    };
  }
}

/**
 * Register the Microsoft.ContainerService provider for a subscription.
 */
export async function registerContainerServiceProvider({
  subscription,
}: {
  subscription: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { ResourceManagementClient } = await import('@azure/arm-resources');
    const client = new ResourceManagementClient(azureCredential, subscription);

    await client.providers.register('Microsoft.ContainerService');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Failed to register Microsoft.ContainerService provider: ${errorMessage}`,
    };
  }
}
