// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it, vi } from 'vitest';

const mockRunAzCommand = vi.fn();
vi.mock('./az-cli-core', () => ({
  runAzCommand: (...args: unknown[]) => mockRunAzCommand(...args),
  debugLog: vi.fn(),
  isValidGuid: (s: string) => /^[0-9a-f-]{36}$/.test(s),
}));

import { getKubeletIdentityObjectId } from './az-identity';

describe('getKubeletIdentityObjectId', () => {
  it('should return the kubelet identity objectId from az aks show', async () => {
    mockRunAzCommand.mockResolvedValue({
      success: true,
      data: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
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

  it('should return error when identityProfile is missing', async () => {
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
});
