// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockExecCommand = vi.hoisted(() => vi.fn());

vi.mock('../shared/runCommandAsync', () => ({
  runCommandAsync: mockExecCommand,
}));

vi.mock('../azure/az-cli-path', () => ({
  getAzCommand: () => 'az',
  getInstallationInstructions: () => 'Install Azure CLI',
}));

import {
  createResourceGroup,
  getResourceGroupLocation,
  resourceGroupExists,
} from '../azure/az-cli';

const VALID_SUB_ID = '12345678-1234-1234-1234-123456789abc';
const VALID_RG_NAME = 'my-resource-group';

describe('getResourceGroupLocation', () => {
  beforeEach(() => {
    mockExecCommand.mockReset();
  });

  test('returns location on success', async () => {
    mockExecCommand.mockResolvedValue({ stdout: 'eastus\n', stderr: '' });

    const location = await getResourceGroupLocation({
      resourceGroupName: VALID_RG_NAME,
      subscriptionId: VALID_SUB_ID,
    });

    expect(location).toBe('eastus');
    expect(mockExecCommand).toHaveBeenCalledWith('az', [
      'group',
      'show',
      '--name',
      VALID_RG_NAME,
      '--subscription',
      VALID_SUB_ID,
      '--query',
      'location',
      '-o',
      'tsv',
    ]);
  });

  test('throws on invalid subscription ID', async () => {
    await expect(
      getResourceGroupLocation({
        resourceGroupName: VALID_RG_NAME,
        subscriptionId: 'not-a-guid',
      })
    ).rejects.toThrow('Invalid subscription ID format');
  });

  test('throws on invalid resource group name', async () => {
    await expect(
      getResourceGroupLocation({
        resourceGroupName: '!!!invalid!!!',
        subscriptionId: VALID_SUB_ID,
      })
    ).rejects.toThrow('Invalid resource group name');
  });

  test('throws when command returns empty location', async () => {
    mockExecCommand.mockResolvedValue({ stdout: '', stderr: '' });

    await expect(
      getResourceGroupLocation({
        resourceGroupName: VALID_RG_NAME,
        subscriptionId: VALID_SUB_ID,
      })
    ).rejects.toThrow('returned no location');
  });

  test('throws when relogin is needed', async () => {
    mockExecCommand.mockResolvedValue({
      stdout: '',
      stderr: 'Interactive authentication is needed',
    });

    await expect(
      getResourceGroupLocation({
        resourceGroupName: VALID_RG_NAME,
        subscriptionId: VALID_SUB_ID,
      })
    ).rejects.toThrow();
  });
});

describe('resourceGroupExists', () => {
  beforeEach(() => {
    mockExecCommand.mockReset();
  });

  test('returns exists true when RG exists', async () => {
    mockExecCommand.mockResolvedValue({ stdout: 'true\n', stderr: '' });

    const result = await resourceGroupExists({
      resourceGroupName: VALID_RG_NAME,
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.exists).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('returns exists false when RG does not exist', async () => {
    mockExecCommand.mockResolvedValue({ stdout: 'false\n', stderr: '' });

    const result = await resourceGroupExists({
      resourceGroupName: VALID_RG_NAME,
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.exists).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test('returns error for invalid subscription ID', async () => {
    const result = await resourceGroupExists({
      resourceGroupName: VALID_RG_NAME,
      subscriptionId: 'bad-id',
    });

    expect(result.exists).toBe(false);
    expect(result.error).toContain('Invalid subscription ID');
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns error for invalid resource group name', async () => {
    const result = await resourceGroupExists({
      resourceGroupName: '!!!invalid',
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.exists).toBe(false);
    expect(result.error).toContain('Invalid resource group name');
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns error when command fails', async () => {
    mockExecCommand.mockRejectedValue(new Error('Network error'));

    const result = await resourceGroupExists({
      resourceGroupName: VALID_RG_NAME,
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.exists).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

describe('createResourceGroup', () => {
  beforeEach(() => {
    mockExecCommand.mockReset();
  });

  test('returns success when RG is created', async () => {
    mockExecCommand.mockResolvedValue({ stdout: '{}', stderr: '' });

    const result = await createResourceGroup({
      resourceGroupName: VALID_RG_NAME,
      location: 'eastus',
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockExecCommand).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['group', 'create', '--name', VALID_RG_NAME, '--location', 'eastus'])
    );
  });

  test('returns error for invalid subscription ID', async () => {
    const result = await createResourceGroup({
      resourceGroupName: VALID_RG_NAME,
      location: 'eastus',
      subscriptionId: 'bad-id',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid subscription ID');
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns error for invalid resource group name', async () => {
    const result = await createResourceGroup({
      resourceGroupName: '!!!invalid',
      location: 'eastus',
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid resource group name');
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  test('returns error when command fails', async () => {
    mockExecCommand.mockRejectedValue(new Error('Permission denied'));

    const result = await createResourceGroup({
      resourceGroupName: VALID_RG_NAME,
      location: 'eastus',
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  test('returns error on az ERROR in stderr', async () => {
    mockExecCommand.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: The subscription is not registered',
    });

    const result = await createResourceGroup({
      resourceGroupName: VALID_RG_NAME,
      location: 'eastus',
      subscriptionId: VALID_SUB_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
