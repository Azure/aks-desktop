// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Azure Container Registry CLI functions.

import { isValidAzResourceName, isValidGuid, runAzCommand } from './az-cli';

/** Azure Container Registry name: 5-50 lowercase alphanumeric characters. */
export const ACR_NAME_PATTERN = /^[a-z0-9]{5,50}$/;

/** Shared validation error for invalid ACR names. */
export const ACR_NAME_ERROR = 'Registry name must be 5-50 lowercase alphanumeric characters.';

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

  const result = await runAzCommand(
    [
      'acr',
      'create',
      '--name',
      registryName,
      '--resource-group',
      resourceGroup,
      '--sku',
      sku,
      '--location',
      location,
      '--subscription',
      subscriptionId,
      '--output',
      'json',
    ],
    'Creating container registry:',
    'create container registry',
    (stdout: string) => {
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {
        throw new Error(
          `Unexpected output from ACR create command: ${e instanceof Error ? e.message : e}`
        );
      }
      return {
        id: parsed.id as string,
        loginServer: parsed.loginServer as string,
      };
    }
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    id: result.data?.id,
    loginServer: result.data?.loginServer,
  };
}
