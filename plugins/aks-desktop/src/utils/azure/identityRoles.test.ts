// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import type { IdentityRoleContext } from './identityRoles';
import { computeRequiredRoles } from './identityRoles';

const baseFields = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'my-rg',
  clusterName: 'my-cluster',
};

const baseContext: IdentityRoleContext = {
  ...baseFields,
  isManagedNamespace: false,
};

const clusterScope =
  '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/my-rg/providers/Microsoft.ContainerService/managedClusters/my-cluster';

const acrResourceId =
  '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/my-rg/providers/Microsoft.ContainerRegistry/registries/myacr';

const managedNamespaceResourceId =
  '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/my-rg/providers/Microsoft.ContainerService/managedClusters/my-cluster/managedNamespaces/my-ns';

describe('computeRequiredRoles', () => {
  describe('Normal Namespace', () => {
    it('assigns AKS Cluster User Role at cluster scope without ACR or RBAC', () => {
      const roles = computeRequiredRoles(baseContext);

      expect(roles).toEqual([
        { role: 'Azure Kubernetes Service Cluster User Role', scope: clusterScope },
      ]);
    });

    it('includes ACR roles when acrResourceId is provided', () => {
      const roles = computeRequiredRoles({ ...baseContext, acrResourceId });

      expect(roles).toEqual([
        { role: 'AcrPush', scope: acrResourceId },
        { role: 'Container Registry Tasks Contributor', scope: acrResourceId },
        { role: 'Azure Kubernetes Service Cluster User Role', scope: clusterScope },
      ]);
    });

    it('includes AKS RBAC Writer when azureRbacEnabled is true', () => {
      const roles = computeRequiredRoles({ ...baseContext, azureRbacEnabled: true });

      expect(roles).toEqual([
        { role: 'Azure Kubernetes Service Cluster User Role', scope: clusterScope },
        { role: 'Azure Kubernetes Service RBAC Writer', scope: clusterScope },
      ]);
    });

    it('includes all roles when ACR and Azure RBAC are both set', () => {
      const roles = computeRequiredRoles({
        ...baseContext,
        acrResourceId,
        azureRbacEnabled: true,
      });

      expect(roles).toHaveLength(4);
      expect(roles).toEqual([
        { role: 'AcrPush', scope: acrResourceId },
        { role: 'Container Registry Tasks Contributor', scope: acrResourceId },
        { role: 'Azure Kubernetes Service Cluster User Role', scope: clusterScope },
        { role: 'Azure Kubernetes Service RBAC Writer', scope: clusterScope },
      ]);
    });

    it('does not include AKS RBAC Writer when azureRbacEnabled is false', () => {
      const roles = computeRequiredRoles({ ...baseContext, azureRbacEnabled: false });
      const roleNames = roles.map(r => r.role);
      expect(roleNames).not.toContain('Azure Kubernetes Service RBAC Writer');
    });

    it('isPipeline flag does NOT affect Azure role assignment (K8s RoleBinding handles non-Azure-RBAC case)', () => {
      // isPipeline is only used downstream in identityWithRoles.ts to gate kubelet AcrPull.
      // computeRequiredRoles ignores it — Azure RBAC Writer is gated solely by azureRbacEnabled.
      const withPipeline = computeRequiredRoles({
        ...baseContext,
        isManagedNamespace: false,
        isPipeline: true,
      });
      const withoutPipeline = computeRequiredRoles({
        ...baseContext,
        isManagedNamespace: false,
      });
      expect(withPipeline).toEqual(withoutPipeline);
      const roleNames = withPipeline.map(r => r.role);
      expect(roleNames).not.toContain('Azure Kubernetes Service RBAC Writer');
      expect(roleNames).toContain('Azure Kubernetes Service Cluster User Role');
    });

    it('includes AKS RBAC Writer for pipeline identity when azureRbacEnabled is true (same as non-pipeline)', () => {
      const roles = computeRequiredRoles({
        ...baseContext,
        isManagedNamespace: false,
        isPipeline: true,
        azureRbacEnabled: true,
        acrResourceId,
      });
      expect(roles).toHaveLength(4); // AcrPush + AcrTasksContributor + ClusterUser + RBACWriter
      // Verify isPipeline alone doesn't change the count vs non-pipeline with same azureRbacEnabled
      const rolesWithoutPipeline = computeRequiredRoles({
        ...baseContext,
        isManagedNamespace: false,
        azureRbacEnabled: true,
        acrResourceId,
      });
      expect(roles).toEqual(rolesWithoutPipeline);
    });
  });

  describe('Managed Namespace', () => {
    const managedCtx: IdentityRoleContext = {
      ...baseFields,
      isManagedNamespace: true,
      managedNamespaceResourceId,
    };

    it('should not accept isPipeline (type-enforced on NormalNamespaceRoleContext only)', () => {
      // isPipeline is defined on NormalNamespaceRoleContext, not ManagedNamespaceRoleContext.
      // This is enforced at compile time — this test just verifies the runtime roles are stable.
      const roles = computeRequiredRoles(managedCtx);
      expect(roles).toHaveLength(2);
    });

    it('assigns AKS RBAC Writer and Namespace User at MNS scope', () => {
      const roles = computeRequiredRoles(managedCtx);

      expect(roles).toEqual([
        { role: 'Azure Kubernetes Service RBAC Writer', scope: managedNamespaceResourceId },
        { role: 'Azure Kubernetes Service Namespace User', scope: managedNamespaceResourceId },
      ]);
    });

    it('includes ACR roles when acrResourceId is provided', () => {
      const roles = computeRequiredRoles({ ...managedCtx, acrResourceId });

      expect(roles).toEqual([
        { role: 'AcrPush', scope: acrResourceId },
        { role: 'Container Registry Tasks Contributor', scope: acrResourceId },
        { role: 'Azure Kubernetes Service RBAC Writer', scope: managedNamespaceResourceId },
        { role: 'Azure Kubernetes Service Namespace User', scope: managedNamespaceResourceId },
      ]);
    });

    it('does not include AKS Cluster User Role for managed namespaces', () => {
      const roles = computeRequiredRoles(managedCtx);
      const roleNames = roles.map(r => r.role);
      expect(roleNames).not.toContain('Azure Kubernetes Service Cluster User Role');
    });

    // Note: "isManagedNamespace: true without managedNamespaceResourceId" is now a compile-time
    // error thanks to the discriminated union type — no runtime test needed.
  });
});
