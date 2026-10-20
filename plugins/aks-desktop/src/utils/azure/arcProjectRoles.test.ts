// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, test } from 'vitest';
import { computeArcProjectRoles, mapUIRoleToArcRole } from './identityRoles';

const BASE = {
  subscriptionId: 'e049fcf1-c84b-4de4-ba9a-a168a4cbab7a',
  resourceGroup: 'rg-bm',
  clusterName: 'bm-cluster',
  namespaceName: 'my-project',
  uiRole: 'Writer',
};

const CLUSTER_SCOPE =
  '/subscriptions/e049fcf1-c84b-4de4-ba9a-a168a4cbab7a/resourceGroups/rg-bm' +
  '/providers/Microsoft.Kubernetes/connectedClusters/bm-cluster';

describe('mapUIRoleToArcRole', () => {
  test('maps wizard roles to the Arc built-ins', () => {
    expect(mapUIRoleToArcRole('Reader')).toBe('Azure Arc Kubernetes Viewer');
    expect(mapUIRoleToArcRole('Writer')).toBe('Azure Arc Kubernetes Writer');
    expect(mapUIRoleToArcRole('Admin')).toBe('Azure Arc Kubernetes Admin');
  });

  test('falls back to Viewer for unknown roles (least privilege)', () => {
    expect(mapUIRoleToArcRole('Overlord')).toBe('Azure Arc Kubernetes Viewer');
  });

  test('never returns an AKS role — those are inert on connectedClusters', () => {
    for (const role of ['Reader', 'Writer', 'Admin', 'Unknown']) {
      expect(mapUIRoleToArcRole(role)).not.toMatch(/Azure Kubernetes Service/);
    }
  });
});

describe('computeArcProjectRoles', () => {
  test('always grants the connectivity role at cluster scope', () => {
    // Authorization does not grant reachability: without this the proxy will not
    // open, so the user never reaches their view/edit grant.
    for (const azureRbacEnabled of [false, true]) {
      const roles = computeArcProjectRoles({ ...BASE, azureRbacEnabled });
      expect(roles).toContainEqual({
        role: 'Azure Arc Enabled Kubernetes Cluster User Role',
        scope: CLUSTER_SCOPE,
      });
    }
  });

  test('native Kubernetes RBAC needs only connectivity — the grant is a RoleBinding', () => {
    const roles = computeArcProjectRoles({ ...BASE, azureRbacEnabled: false });
    expect(roles).toHaveLength(1);
  });

  test('Azure RBAC adds the namespace-scoped role', () => {
    const roles = computeArcProjectRoles({ ...BASE, azureRbacEnabled: true });
    expect(roles).toHaveLength(2);
    expect(roles[1]).toEqual({
      role: 'Azure Arc Kubernetes Writer',
      scope: `${CLUSTER_SCOPE}/namespaces/my-project`,
    });
  });

  test('scopes to connectedClusters, never managedClusters', () => {
    const roles = computeArcProjectRoles({ ...BASE, azureRbacEnabled: true });
    for (const { scope } of roles) {
      expect(scope).toContain('Microsoft.Kubernetes/connectedClusters');
      expect(scope).not.toContain('Microsoft.ContainerService');
    }
  });
});
