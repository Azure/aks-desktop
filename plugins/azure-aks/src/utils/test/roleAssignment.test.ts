// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock az-cli functions
const mockCreateNamespaceRoleAssignment = vi.fn();
const mockVerifyNamespaceAccess = vi.fn();

vi.mock('../azure/az-namespace-access', () => ({
  createNamespaceRoleAssignment: (...args: any[]) => mockCreateNamespaceRoleAssignment(...args),
  verifyNamespaceAccess: (...args: any[]) => mockVerifyNamespaceAccess(...args),
}));

// Mock types
vi.mock('../../components/CreateAKSProject/types', () => ({
  mapUIRoleToAzureRole: (role: string) => {
    const map: Record<string, string> = {
      Admin: 'Azure Kubernetes Service RBAC Admin',
      Writer: 'Azure Kubernetes Service RBAC Writer',
      Reader: 'Azure Kubernetes Service RBAC Reader',
    };
    return map[role] || role;
  },
}));

import { assignRolesToNamespace } from '../azure/roleAssignment';

/** Simple interpolation that mimics i18next `t()` for test assertions. */
const mockT = (key: string, opts?: Record<string, any>) => {
  if (!opts) return key;
  return Object.entries(opts).reduce(
    (str, [k, v]) => str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
    key
  );
};

const baseOptions = {
  clusterName: 'test-cluster',
  resourceGroup: 'test-rg',
  namespaceName: 'test-ns',
  subscriptionId: 'test-sub-id',
  t: mockT,
};

const testObjectId1 = '00000000-1111-2222-3333-444444444444';
const testObjectId2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('assignRolesToNamespace', () => {
  beforeEach(() => {
    mockCreateNamespaceRoleAssignment.mockReset();
    mockVerifyNamespaceAccess.mockReset();
  });

  test('returns success with empty results when no valid assignments', async () => {
    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [{ objectId: '', role: 'Writer' }],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(mockCreateNamespaceRoleAssignment).not.toHaveBeenCalled();
  });

  test('assigns 3 roles per user and verifies access', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({ success: true });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: true });

    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [{ objectId: testObjectId1, role: 'Writer' }],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.errors).toHaveLength(0);

    // 3 roles: mapped Writer role + Namespace User + Namespace Contributor
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledTimes(3);
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeObjectId: testObjectId1,
        role: 'Azure Kubernetes Service RBAC Writer',
      })
    );
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeObjectId: testObjectId1,
        role: 'Azure Kubernetes Service Namespace User',
      })
    );
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeObjectId: testObjectId1,
        role: 'Azure Kubernetes Service Namespace Contributor',
      })
    );

    expect(mockVerifyNamespaceAccess).toHaveBeenCalledTimes(1);
    expect(mockVerifyNamespaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeObjectId: testObjectId1 })
    );
  });

  test('handles multiple users', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({ success: true });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: true });

    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [
        { objectId: testObjectId1, role: 'Admin' },
        { objectId: testObjectId2, role: 'Reader' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    // 3 roles per user = 6 total
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledTimes(6);
    expect(mockVerifyNamespaceAccess).toHaveBeenCalledTimes(2);
  });

  test('reports error when role assignment fails', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({
      success: false,
      stderr: 'Permission denied',
    });

    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [{ objectId: testObjectId1, role: 'Writer' }],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain(testObjectId1);
    expect(result.errors[0]).toContain('Permission denied');
    // Should not attempt verification when role assignment fails
    expect(mockVerifyNamespaceAccess).not.toHaveBeenCalled();
  });

  test('reports error when access verification fails', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({ success: true });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: false });

    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [{ objectId: testObjectId1, role: 'Writer' }],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does not have the expected access');
  });

  test('handles partial failure across multiple users', async () => {
    let callCount = 0;
    mockCreateNamespaceRoleAssignment.mockImplementation(() => {
      callCount++;
      // Fail the 4th call (first role of second user)
      if (callCount > 3) {
        return Promise.resolve({ success: false, stderr: 'Conflict' });
      }
      return Promise.resolve({ success: true });
    });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: true });

    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [
        { objectId: testObjectId1, role: 'Writer' },
        { objectId: testObjectId2, role: 'Reader' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(1); // user1 succeeded
    expect(result.errors).toHaveLength(1); // user2 failed
    expect(result.errors[0]).toContain(testObjectId2);
  });

  test('calls onProgress callback', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({ success: true });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: true });
    const onProgress = vi.fn();

    await assignRolesToNamespace({
      ...baseOptions,
      assignments: [{ objectId: testObjectId1, role: 'Writer' }],
      onProgress,
    });

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining(testObjectId1));
  });

  test('handles thrown exceptions from role assignment', async () => {
    mockCreateNamespaceRoleAssignment.mockRejectedValue(new Error('Network error'));

    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [{ objectId: testObjectId1, role: 'Writer' }],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Network error');
  });

  test('filters out empty objectId assignments', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({ success: true });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: true });

    const result = await assignRolesToNamespace({
      ...baseOptions,
      assignments: [
        { objectId: '', role: 'Writer' },
        { objectId: '  ', role: 'Reader' },
        { objectId: testObjectId1, role: 'Admin' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    // Only 3 calls for the one valid user
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledTimes(3);
  });

  test('uses fallback interpolation when t is not provided', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({ success: true });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: true });
    const onProgress = vi.fn();

    await assignRolesToNamespace({
      clusterName: 'test-cluster',
      resourceGroup: 'test-rg',
      namespaceName: 'test-ns',
      subscriptionId: 'test-sub-id',
      // Note: no `t` provided — uses fallback
      assignments: [{ objectId: testObjectId1, role: 'Writer' }],
      onProgress,
    });

    // Verify that interpolation placeholders were resolved, not left as raw {{...}}
    const progressMessages = onProgress.mock.calls.map(c => c[0]);
    const hasRawPlaceholder = progressMessages.some(msg => /\{\{/.test(msg));
    expect(hasRawPlaceholder).toBe(false);
    expect(progressMessages.some(msg => msg.includes(testObjectId1))).toBe(true);
  });

  test('passes objectId directly to role assignment', async () => {
    mockCreateNamespaceRoleAssignment.mockResolvedValue({ success: true });
    mockVerifyNamespaceAccess.mockResolvedValue({ success: true, hasAccess: true });

    await assignRolesToNamespace({
      ...baseOptions,
      assignments: [{ objectId: testObjectId1, role: 'Admin' }],
    });

    // Role assignment should be called 3 times with the object ID directly
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledTimes(3);
    expect(mockCreateNamespaceRoleAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeObjectId: testObjectId1 })
    );
  });
});
