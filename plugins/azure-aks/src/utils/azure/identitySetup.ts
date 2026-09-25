// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { createManagedIdentity, getManagedIdentity } from './az-identity';
import {
  createResourceGroup,
  getResourceGroupLocation,
  resourceGroupExists,
} from './az-subscriptions';

export type IdentitySetupStatus = 'creating-rg' | 'checking' | 'creating-identity';

export interface IdentitySetupConfig {
  subscriptionId: string;
  /** Resource group where the cluster lives (used to derive location). */
  resourceGroup: string;
  /** Resource group where the identity will be created. */
  identityResourceGroup: string;
  identityName: string;
  /** Purpose label for the resource group tags (e.g. 'GitHub Actions Identity', 'Workload Identity'). */
  purpose?: string;
  onStatusChange: (status: IdentitySetupStatus) => void;
}

export interface IdentitySetupResult {
  clientId: string;
  principalId: string;
  tenantId: string;
  isExisting: boolean;
}

/**
 * Ensures a managed identity exists, creating the resource group and identity if needed.
 * Does NOT handle role assignment or federated credentials — those differ per flow.
 */
export async function ensureIdentityAndResourceGroup(
  config: IdentitySetupConfig
): Promise<IdentitySetupResult> {
  const {
    subscriptionId,
    resourceGroup,
    identityResourceGroup,
    identityName,
    purpose,
    onStatusChange,
  } = config;

  // Step 1: Ensure identity resource group exists
  onStatusChange('creating-rg');
  const rgCheck = await resourceGroupExists({
    resourceGroupName: identityResourceGroup,
    subscriptionId,
  });

  if (rgCheck.error) {
    throw new Error(rgCheck.error);
  }

  const location = await getResourceGroupLocation({
    resourceGroupName: resourceGroup,
    subscriptionId,
  });
  if (!location) {
    throw new Error(`Could not determine location from resource group '${resourceGroup}'`);
  }

  if (!rgCheck.exists) {
    const tags = [`purpose=${purpose ?? 'Managed Identity'}`, 'createdBy=AKS Desktop'];
    const rgResult = await createResourceGroup({
      resourceGroupName: identityResourceGroup,
      location,
      subscriptionId,
      tags,
    });
    if (!rgResult.success) {
      throw new Error(rgResult.error ?? 'Failed to create identity resource group');
    }
  }

  // Step 2: Check if identity already exists
  onStatusChange('checking');
  const existing = await getManagedIdentity({
    identityName,
    resourceGroup: identityResourceGroup,
    subscriptionId,
  });

  if (existing.success && existing.clientId && existing.principalId && existing.tenantId) {
    return {
      clientId: existing.clientId,
      principalId: existing.principalId,
      tenantId: existing.tenantId,
      isExisting: true,
    };
  }

  if (!existing.success && !existing.notFound) {
    throw new Error(existing.error ?? 'Failed to check for existing managed identity');
  }

  // Step 3: Create the identity
  onStatusChange('creating-identity');
  const created = await createManagedIdentity({
    identityName,
    resourceGroup: identityResourceGroup,
    location,
    subscriptionId,
  });
  if (!created.success || !created.clientId || !created.principalId || !created.tenantId) {
    throw new Error(created.error ?? 'Failed to create managed identity');
  }

  return {
    clientId: created.clientId,
    principalId: created.principalId,
    tenantId: created.tenantId,
    isExisting: false,
  };
}
