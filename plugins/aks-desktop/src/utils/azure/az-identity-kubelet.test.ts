// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunAzCommand = vi.fn();
vi.mock('./az-cli-core', () => ({
  runAzCommand: (...args: unknown[]) => mockRunAzCommand(...args),
  debugLog: vi.fn(),
  isValidGuid: (s: string) => /^[0-9a-f-]{36}$/.test(s),
}));

vi.mock('./az-validation', () => ({
  isValidAzResourceName: (s: string) => /^[a-zA-Z0-9-_]+$/.test(s),
  parseManagedIdentityOutput: vi.fn(),
}));

import { getKubeletIdentityObjectId } from './az-identity';

describe('getKubeletIdentityObjectId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the kubelet identity objectId from az aks show', async () => {
    mockRunAzCommand.mockResolvedValue({
      success: true,
      data: { objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', clientId: 'some-client' },
    });

    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'my-rg',
      clusterName: 'my-aks',
    });
    expect(result).toEqual({
      success: true,
      objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
  });

  it('should return error when identityProfile is missing (data is null)', async () => {
    mockRunAzCommand.mockResolvedValue({
      success: true,
      data: null,
    });

    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'my-rg',
      clusterName: 'my-aks',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('kubelet identity');
  });

  it('should return error when data is a non-object type (number)', async () => {
    mockRunAzCommand.mockResolvedValue({
      success: true,
      data: 12345,
    });

    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'my-rg',
      clusterName: 'my-aks',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('kubelet identity');
  });

  it('should return error when data is an object without objectId field', async () => {
    mockRunAzCommand.mockResolvedValue({
      success: true,
      data: { nested: 'value' },
    });

    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'my-rg',
      clusterName: 'my-aks',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('kubelet identity');
  });

  it('should return error when az command fails', async () => {
    mockRunAzCommand.mockResolvedValue({
      success: false,
      error: 'ResourceNotFound',
    });

    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'my-rg',
      clusterName: 'my-aks',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid subscription ID', async () => {
    const result = await getKubeletIdentityObjectId({
      subscriptionId: 'not-a-guid',
      resourceGroup: 'my-rg',
      clusterName: 'my-aks',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('subscription ID');
    expect(mockRunAzCommand).not.toHaveBeenCalled();
  });

  it('should reject invalid resource group name', async () => {
    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'bad group name!',
      clusterName: 'my-aks',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('resource group or cluster name');
    expect(mockRunAzCommand).not.toHaveBeenCalled();
  });

  it('should reject invalid cluster name', async () => {
    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'my-rg',
      clusterName: 'bad cluster!',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('resource group or cluster name');
    expect(mockRunAzCommand).not.toHaveBeenCalled();
  });

  it('should return error when objectId is not a valid GUID', async () => {
    mockRunAzCommand.mockResolvedValue({
      success: true,
      data: { objectId: 'not-a-guid-format' },
    });

    const result = await getKubeletIdentityObjectId({
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroup: 'my-rg',
      clusterName: 'my-aks',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('unexpected kubelet identity format');
  });
});
