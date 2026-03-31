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

vi.mock('../shared/quoteForPlatform', () => ({
  quoteForPlatform: (value: string) => value,
}));

import { listNamespaceRoleAssignments } from '../azure/az-namespace-access';

const defaultOptions = {
  clusterName: 'test-cluster',
  resourceGroup: 'test-rg',
  namespaceName: 'test-namespace',
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
};

describe('listNamespaceRoleAssignments', () => {
  beforeEach(() => {
    mockExecCommand.mockReset();
  });

  test('returns parsed role assignments on success', async () => {
    const assignments = [
      {
        principalName: 'alice@example.com',
        principalType: 'User',
        roleDefinitionName: 'Azure Kubernetes Service RBAC Writer',
        scope:
          '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster/providers/Microsoft.KubernetesConfiguration/namespaces/test-namespace',
      },
    ];

    mockExecCommand
      .mockResolvedValueOnce({
        stdout:
          '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster/providers/Microsoft.KubernetesConfiguration/namespaces/test-namespace\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(assignments),
        stderr: '',
      });

    const result = await listNamespaceRoleAssignments(defaultOptions);

    // Checking that the ARM ID lookup was first called, followed by role assignment query
    expect(result).toEqual({ success: true, assignments });
    expect(mockExecCommand).toHaveBeenNthCalledWith(1, 'az', [
      'aks',
      'namespace',
      'show',
      '--cluster-name',
      'test-cluster',
      '--resource-group',
      'test-rg',
      '--name',
      'test-namespace',
      '--query',
      'id',
      '--output',
      'tsv',
      '--subscription',
      '12345678-1234-1234-1234-123456789abc',
    ]);
    expect(mockExecCommand).toHaveBeenNthCalledWith(2, 'az', [
      'role',
      'assignment',
      'list',
      '--scope',
      '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster/providers/Microsoft.KubernetesConfiguration/namespaces/test-namespace',
      '--query',
      '[].{principalName:principalName,principalType:principalType,roleDefinitionName:roleDefinitionName,scope:scope}',
      '--output',
      'json',
      '--subscription',
      '12345678-1234-1234-1234-123456789abc',
    ]);
  });

  test('returns error when namespace lookup requires a relogin', async () => {
    mockExecCommand.mockResolvedValueOnce({
      stdout: '',
      stderr: 'Interactive authentication is needed. Please run: az login',
    });

    const result = await listNamespaceRoleAssignments(defaultOptions);

    expect(result.success).toBe(false);
    expect(result.assignments).toEqual([]);
    expect(result.error).toContain('Azure login required');
    expect(mockExecCommand).toHaveBeenCalledTimes(1);
  });

  test('returns error when role assignment list command writes error to stderr', async () => {
    mockExecCommand
      .mockResolvedValueOnce({
        stdout:
          '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster/providers/Microsoft.KubernetesConfiguration/namespaces/test-namespace\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'ERROR: role assignment list failed',
      });

    const result = await listNamespaceRoleAssignments(defaultOptions);

    expect(result.success).toBe(false);
    expect(result.assignments).toEqual([]);
    expect(result.error).toContain('Failed to load role assignments');
  });

  test('returns error when role assignment response is invalid JSON', async () => {
    mockExecCommand
      .mockResolvedValueOnce({
        stdout:
          '/subscriptions/test-sub/resourceGroups/test-rg/providers/Microsoft.ContainerService/managedClusters/test-cluster/providers/Microsoft.KubernetesConfiguration/namespaces/test-namespace\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'not valid json',
        stderr: '',
      });

    const result = await listNamespaceRoleAssignments(defaultOptions);

    expect(result.success).toBe(false);
    expect(result.assignments).toEqual([]);
    expect(result.error).toContain('Failed to load role assignments');
  });
});
