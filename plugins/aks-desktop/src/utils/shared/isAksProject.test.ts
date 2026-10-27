// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTHZ_MODEL_AZURE_RBAC,
  AUTHZ_MODEL_KUBERNETES_RBAC,
  AUTHZ_MODEL_LABEL,
  MANAGED_BY_ARM_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../constants/projectLabels';

const clusterRequestMock = vi.fn();

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ K8s: {} }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  clusterRequest: (...args: unknown[]) => clusterRequestMock(...args),
}));

import {
  isAksProjectWithResourceGroup,
  isAzureRbacProject,
  supportsManagedNamespaceSettings,
} from './isAksProject';

const project = { namespaces: ['project-a'], clusters: ['cluster-a'] };
const managedNamespaceLabels: Record<string, string> = {
  [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
  [RESOURCE_GROUP_LABEL]: 'project-rg',
  [SUBSCRIPTION_LABEL]: 'project-subscription',
};

function respondWithLabels(labels: Record<string, string>) {
  clusterRequestMock.mockResolvedValue({ metadata: { labels } });
}

beforeEach(() => {
  clusterRequestMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('supportsManagedNamespaceSettings', () => {
  it('accepts an ARM-managed AKS namespace', () => {
    expect(
      supportsManagedNamespaceSettings(
        { ...managedNamespaceLabels, [MANAGED_BY_ARM_LABEL]: 'true' },
        'cluster-a'
      )
    ).toBe(true);
  });

  it('preserves legacy AKS eligibility without an ARM marker or cluster settings', () => {
    expect(supportsManagedNamespaceSettings(managedNamespaceLabels, 'cluster-a')).toBe(true);
  });

  it.each([PROJECT_MANAGED_BY_LABEL, RESOURCE_GROUP_LABEL, SUBSCRIPTION_LABEL])(
    'rejects a missing or empty %s label',
    label => {
      const incompleteLabels = { ...managedNamespaceLabels };
      delete incompleteLabels[label];
      expect(supportsManagedNamespaceSettings(incompleteLabels, 'cluster-a')).toBe(false);
      expect(
        supportsManagedNamespaceSettings({ ...managedNamespaceLabels, [label]: '' }, 'cluster-a')
      ).toBe(false);
    }
  );

  it('rejects a project owned by another tool', () => {
    expect(
      supportsManagedNamespaceSettings(
        { ...managedNamespaceLabels, [PROJECT_MANAGED_BY_LABEL]: 'headlamp' },
        'cluster-a'
      )
    ).toBe(false);
  });

  it.each([AUTHZ_MODEL_AZURE_RBAC, AUTHZ_MODEL_KUBERNETES_RBAC])(
    'rejects a fully Azure-labelled Arc namespace using %s without local settings',
    authModel => {
      expect(
        supportsManagedNamespaceSettings(
          { ...managedNamespaceLabels, [AUTHZ_MODEL_LABEL]: authModel },
          'cluster-a'
        )
      ).toBe(false);
    }
  );

  it('rejects legacy Arc namespaces identified by registered cluster settings', () => {
    localStorage.setItem('cluster_settings.cluster-a', JSON.stringify({ clusterType: 'aksarc' }));

    expect(supportsManagedNamespaceSettings(managedNamespaceLabels, 'cluster-a')).toBe(false);
    expect(
      supportsManagedNamespaceSettings(
        { ...managedNamespaceLabels, [MANAGED_BY_ARM_LABEL]: 'false' },
        'cluster-a'
      )
    ).toBe(false);
    expect(supportsManagedNamespaceSettings(managedNamespaceLabels, 'cluster-b')).toBe(true);
  });

  it('gives the ARM marker precedence over stale Arc labels and local settings', () => {
    localStorage.setItem('cluster_settings.cluster-a', JSON.stringify({ clusterType: 'aksarc' }));

    expect(
      supportsManagedNamespaceSettings(
        {
          ...managedNamespaceLabels,
          [MANAGED_BY_ARM_LABEL]: 'true',
          [AUTHZ_MODEL_LABEL]: AUTHZ_MODEL_KUBERNETES_RBAC,
        },
        'cluster-a'
      )
    ).toBe(true);
  });

  it('rejects an empty cluster name', () => {
    expect(supportsManagedNamespaceSettings(managedNamespaceLabels, '')).toBe(false);
  });

  it('does not make network requests', () => {
    supportsManagedNamespaceSettings(managedNamespaceLabels, 'cluster-a');

    expect(clusterRequestMock).not.toHaveBeenCalled();
  });
});

describe('isAksProjectWithResourceGroup', () => {
  it.each([undefined, 'true'])(
    'accepts eligible AKS with ARM marker %s using one direct namespace request',
    async armMarker => {
      const labels = { ...managedNamespaceLabels };
      if (armMarker) labels[MANAGED_BY_ARM_LABEL] = armMarker;
      respondWithLabels(labels);

      await expect(isAksProjectWithResourceGroup({ project })).resolves.toBe(true);
      expect(clusterRequestMock).toHaveBeenCalledExactlyOnceWith('/api/v1/namespaces/project-a', {
        cluster: 'cluster-a',
        method: 'GET',
      });
    }
  );

  it.each([AUTHZ_MODEL_AZURE_RBAC, AUTHZ_MODEL_KUBERNETES_RBAC])(
    'rejects realistic Arc namespaces with subscription, resource group and %s',
    async authModel => {
      respondWithLabels({ ...managedNamespaceLabels, [AUTHZ_MODEL_LABEL]: authModel });

      await expect(isAksProjectWithResourceGroup({ project })).resolves.toBe(false);
      expect(clusterRequestMock).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects legacy Arc namespaces from registered cluster settings', async () => {
    localStorage.setItem('cluster_settings.cluster-a', JSON.stringify({ clusterType: 'aksarc' }));
    respondWithLabels(managedNamespaceLabels);

    await expect(isAksProjectWithResourceGroup({ project })).resolves.toBe(false);
  });

  it.each([PROJECT_MANAGED_BY_LABEL, RESOURCE_GROUP_LABEL, SUBSCRIPTION_LABEL])(
    'rejects incomplete namespace labels missing %s',
    async label => {
      const incompleteLabels = { ...managedNamespaceLabels };
      delete incompleteLabels[label];
      respondWithLabels(incompleteLabels);

      await expect(isAksProjectWithResourceGroup({ project })).resolves.toBe(false);
    }
  );

  it.each([
    { namespaces: [], clusters: ['cluster-a'] },
    { namespaces: ['project-a'], clusters: [] },
    { namespaces: [''], clusters: ['cluster-a'] },
    { namespaces: ['project-a'], clusters: [''] },
    { namespaces: ['project-a', 'project-b'], clusters: ['cluster-a'] },
    { namespaces: ['project-a'], clusters: ['cluster-a', 'cluster-b'] },
  ])('rejects invalid target coordinates %j without a request', async invalidProject => {
    await expect(isAksProjectWithResourceGroup({ project: invalidProject })).resolves.toBe(false);
    expect(clusterRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a namespace without metadata or labels', async () => {
    clusterRequestMock.mockResolvedValue({});

    await expect(isAksProjectWithResourceGroup({ project })).resolves.toBe(false);
  });

  it('returns false when namespace labels cannot be loaded', async () => {
    clusterRequestMock.mockRejectedValue(new Error('request failed'));

    await expect(isAksProjectWithResourceGroup({ project })).resolves.toBe(false);
  });
});

describe('isAzureRbacProject', () => {
  it('recognizes an ARM-managed AKS namespace', async () => {
    respondWithLabels({
      [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
      [MANAGED_BY_ARM_LABEL]: 'true',
    });

    await expect(isAzureRbacProject({ project })).resolves.toBe(true);
  });

  it('recognizes an Arc project configured for Azure RBAC', async () => {
    respondWithLabels({
      [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
      [AUTHZ_MODEL_LABEL]: AUTHZ_MODEL_AZURE_RBAC,
    });

    await expect(isAzureRbacProject({ project })).resolves.toBe(true);
  });

  it('rejects an Arc project configured for native Kubernetes RBAC', async () => {
    respondWithLabels({
      [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
      [AUTHZ_MODEL_LABEL]: AUTHZ_MODEL_KUBERNETES_RBAC,
    });

    await expect(isAzureRbacProject({ project })).resolves.toBe(false);
  });

  it('rejects a namespace not owned by AKS Desktop', async () => {
    respondWithLabels({ [AUTHZ_MODEL_LABEL]: AUTHZ_MODEL_AZURE_RBAC });

    await expect(isAzureRbacProject({ project })).resolves.toBe(false);
  });

  it('rejects multi-cluster or multi-namespace project references without a request', async () => {
    await expect(
      isAzureRbacProject({
        project: { namespaces: ['project-a', 'project-b'], clusters: ['cluster-a'] },
      })
    ).resolves.toBe(false);
    await expect(
      isAzureRbacProject({
        project: { namespaces: ['project-a'], clusters: ['cluster-a', 'cluster-b'] },
      })
    ).resolves.toBe(false);
    expect(clusterRequestMock).not.toHaveBeenCalled();
  });

  it('returns false when namespace labels cannot be loaded', async () => {
    clusterRequestMock.mockRejectedValue(new Error('request failed'));

    await expect(isAzureRbacProject({ project })).resolves.toBe(false);
  });
});
