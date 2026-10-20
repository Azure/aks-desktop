// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTHZ_MODEL_AZURE_RBAC,
  AUTHZ_MODEL_KUBERNETES_RBAC,
  AUTHZ_MODEL_LABEL,
  MANAGED_BY_ARM_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
} from '../constants/projectLabels';

const clusterRequestMock = vi.fn();

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ K8s: {} }));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  clusterRequest: (...args: unknown[]) => clusterRequestMock(...args),
}));

import { isAzureRbacProject } from './isAksProject';

const project = { namespaces: ['project-a'], clusters: ['cluster-a'] };

function respondWithLabels(labels: Record<string, string>) {
  clusterRequestMock.mockResolvedValue({ metadata: { labels } });
}

describe('isAzureRbacProject', () => {
  beforeEach(() => {
    clusterRequestMock.mockReset();
  });

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
