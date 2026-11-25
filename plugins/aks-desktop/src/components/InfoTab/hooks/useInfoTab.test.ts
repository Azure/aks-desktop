// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks (vi.hoisted ensures variables are available when vi.mock is hoisted) ---

const mockUseGet = vi.hoisted(() => vi.fn());
const mockGetManagedNamespaces = vi.hoisted(() => vi.fn());
const mockGetManagedNamespaceDetails = vi.hoisted(() => vi.fn());
const mockUpdateManagedNamespace = vi.hoisted(() => vi.fn());
const mockT = vi.hoisted(() => (key: string) => key);
const mockClusterAction = vi.hoisted(() =>
  vi.fn(async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {}
  })
);

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        useGet: mockUseGet,
      },
    },
  },
  useTranslation: () => ({ t: mockT }),
  clusterAction: mockClusterAction,
}));

vi.mock('../../../utils/azure/az-namespaces', () => ({
  getManagedNamespaces: mockGetManagedNamespaces,
  getManagedNamespaceDetails: mockGetManagedNamespaceDetails,
  updateManagedNamespace: mockUpdateManagedNamespace,
}));

import { useInfoTab } from './useInfoTab';

/** A minimal project fixture used across tests. */
const defaultProject = {
  clusters: ['my-cluster'],
  namespaces: ['my-namespace'],
  id: 'my-project',
};

/** A namespace instance returned by Headlamp with subscription and resource group labels. */
function createNamespaceInstance(subscription = 'sub-123', resourceGroup = 'rg-prod') {
  return {
    jsonData: {
      metadata: {
        labels: {
          'aks-desktop/project-subscription': subscription,
          'aks-desktop/project-resource-group': resourceGroup,
        },
      },
    },
  };
}

/** A namespace details object returned by the Azure CLI. */
function createNamespaceDetails(
  overrides: Partial<{
    ingress: string;
    egress: string;
    cpuRequest: string;
    cpuLimit: string;
    memoryRequest: string;
    memoryLimit: string;
  }> = {}
) {
  const {
    ingress = 'AllowSameNamespace',
    egress = 'AllowAll',
    cpuRequest = '500m',
    cpuLimit = '1000m',
    memoryRequest = '256Mi',
    memoryLimit = '512Mi',
  } = overrides;

  return {
    properties: {
      defaultNetworkPolicy: { ingress, egress },
      defaultResourceQuota: { cpuRequest, cpuLimit, memoryRequest, memoryLimit },
    },
  };
}

describe('useInfoTab', () => {
  beforeEach(() => {
    // Default: namespace labels present
    mockUseGet.mockReturnValue([createNamespaceInstance()]);
    // Default: managed namespaces available with details
    mockGetManagedNamespaces.mockResolvedValue(['my-project']);
    mockGetManagedNamespaceDetails.mockResolvedValue(createNamespaceDetails());
    // Re-apply clusterAction implementation (vi.resetAllMocks clears it)
    mockClusterAction.mockImplementation(async (action: () => Promise<void>) => {
      try {
        await action();
      } catch {}
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // --- Initial loading state ---

  test('starts in loading state and resolves after fetch completes', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.namespaceDetails).not.toBeNull();
  });

  // --- Missing cluster or resource group ---

  test('sets namespaceDetails to null and skips fetch when cluster is missing', async () => {
    const project = { ...defaultProject, clusters: [] };

    const { result } = renderHook(() => useInfoTab(project));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetManagedNamespaces).not.toHaveBeenCalled();
    expect(result.current.namespaceDetails).toBeNull();
  });

  test('sets namespaceDetails to null and skips fetch when resourceGroup label is absent', async () => {
    mockUseGet.mockReturnValue([{ jsonData: { metadata: { labels: {} } } }]);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetManagedNamespaces).not.toHaveBeenCalled();
    expect(result.current.namespaceDetails).toBeNull();
  });

  // --- Managed namespace list empty ---

  test('sets namespaceDetails to null when no managed namespaces exist for the cluster', async () => {
    mockGetManagedNamespaces.mockResolvedValue([]);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetManagedNamespaceDetails).not.toHaveBeenCalled();
    expect(result.current.namespaceDetails).toBeNull();
  });

  // --- Error handling ---

  test('sets error and clears namespaceDetails when getManagedNamespaces throws', async () => {
    mockGetManagedNamespaces.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch managed namespaces');
    expect(result.current.namespaceDetails).toBeNull();
  });

  test('sets error and clears namespaceDetails when getManagedNamespaceDetails throws', async () => {
    mockGetManagedNamespaceDetails.mockRejectedValue(new Error('details error'));

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch managed namespace details');
    expect(result.current.namespaceDetails).toBeNull();
  });

  // --- Form population from namespace details ---

  test('pre-populates formData from fetched namespace details', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({
        ingress: 'AllowAll',
        egress: 'DenyAll',
        cpuRequest: '250m',
        cpuLimit: '500m',
        memoryRequest: '128Mi',
        memoryLimit: '256Mi',
      })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.formData.ingress).toBe('AllowAll');
    expect(result.current.formData.egress).toBe('DenyAll');
    expect(result.current.formData.cpuRequest).toBe(250);
    expect(result.current.formData.cpuLimit).toBe(500);
    expect(result.current.formData.memoryRequest).toBe(128);
    expect(result.current.formData.memoryLimit).toBe(256);
  });

  test('pre-populates standard ARM CPU and memory quantity units', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({
        cpuRequest: '2',
        cpuLimit: '2500m',
        memoryRequest: '2Gi',
        memoryLimit: '4Gi',
      })
    );
    const { result } = renderHook(() => useInfoTab(defaultProject));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.formData).toMatchObject({
      cpuRequest: 2000,
      cpuLimit: 2500,
      memoryRequest: 2048,
      memoryLimit: 4096,
    });
  });

  test('preserves fractional CPU quantities from decimal SI units', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({
        cpuRequest: '250u',
        cpuLimit: '1k',
      })
    );
    const { result } = renderHook(() => useInfoTab(defaultProject));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.formData).toMatchObject({
      cpuRequest: 0.25,
      cpuLimit: 1_000_000,
    });
  });

  test('preserves fractional MiB ARM quantities', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({
        memoryRequest: '262656Ki',
        memoryLimit: '256.5Mi',
      })
    );
    const { result } = renderHook(() => useInfoTab(defaultProject));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.formData).toMatchObject({
      memoryRequest: 256.5,
      memoryLimit: 256.5,
    });
  });

  test('falls back to AllowSameNamespace for unrecognised ingress policy value', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({ ingress: 'InvalidPolicy' })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.formData.ingress).toBe('AllowSameNamespace');
  });

  test('parses resource values without units as zero', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({
        cpuRequest: 'invalid',
        memoryRequest: 'bad',
      })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.formData.cpuRequest).toBe(0);
    expect(result.current.formData.memoryRequest).toBe(0);
  });

  // --- hasChanges ---

  test('hasChanges is false initially after fetch', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasChanges).toBe(false);
  });

  test('hasChanges becomes true after a form field is changed', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    expect(result.current.hasChanges).toBe(true);
  });

  test('hasChanges returns to false after reverting a change back to the baseline', async () => {
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({ ingress: 'AllowSameNamespace' })
    );

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });
    expect(result.current.hasChanges).toBe(true);

    act(() => {
      result.current.handleFormDataChange({ ingress: 'AllowSameNamespace' });
    });
    expect(result.current.hasChanges).toBe(false);
  });

  // --- Validation ---

  test('validation is valid on initial form population', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.validation.isValid).toBe(true);
  });

  test('validation becomes invalid when cpuRequest exceeds cpuLimit', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ cpuRequest: 2000, cpuLimit: 500 });
    });

    expect(result.current.validation.isValid).toBe(false);
    expect(result.current.validation.errors).toContain(
      'CPU requests cannot be greater than CPU limits'
    );
  });

  test('validation becomes invalid when memoryRequest exceeds memoryLimit', async () => {
    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ memoryRequest: 1024, memoryLimit: 256 });
    });

    expect(result.current.validation.isValid).toBe(false);
  });

  // --- handleSave ---

  test('handleSave calls updateManagedNamespace with correct arguments and advances baseline', async () => {
    mockUpdateManagedNamespace.mockResolvedValue(undefined);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    expect(result.current.hasChanges).toBe(true);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateManagedNamespace).toHaveBeenCalledTimes(1);
    expect(mockUpdateManagedNamespace).toHaveBeenCalledWith({
      clusterName: 'my-cluster',
      resourceGroup: 'rg-prod',
      namespaceName: 'my-project',
      ingressPolicy: 'DenyAll',
      subscriptionId: 'sub-123',
    });
    // Baseline advances so hasChanges resets
    expect(result.current.hasChanges).toBe(false);
  });

  test('handleSave reconciles untouched fields with the returned resource', async () => {
    mockUpdateManagedNamespace.mockResolvedValue(
      createNamespaceDetails({
        ingress: 'DenyAll',
        cpuRequest: '700m',
      })
    );
    const { result } = renderHook(() => useInfoTab(defaultProject));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));

    await act(async () => {
      await result.current.handleSave();
      await waitFor(() => expect(result.current.updating).toBe(false));
    });

    expect(result.current.formData).toMatchObject({
      ingress: 'DenyAll',
      cpuRequest: 700,
    });
    expect(result.current.hasChanges).toBe(false);
  });

  test('handleSave preserves edits made while the update is in flight', async () => {
    let finish!: (value: unknown) => void;
    mockUpdateManagedNamespace.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const { result } = renderHook(() => useInfoTab(defaultProject));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => result.current.handleSave());
    act(() => result.current.handleFormDataChange({ cpuRequest: 600 }));

    act(() => {
      finish(
        createNamespaceDetails({
          ingress: 'DenyAll',
          cpuRequest: '700m',
          memoryLimit: '768Mi',
        })
      );
    });

    await waitFor(() => expect(result.current.updating).toBe(false));

    expect(result.current.formData).toMatchObject({
      ingress: 'DenyAll',
      cpuRequest: 600,
      memoryLimit: 768,
    });
    expect(result.current.hasChanges).toBe(true);
  });

  test('handleSave revalidates reconciled fields from the final resource', async () => {
    mockUpdateManagedNamespace.mockResolvedValue(
      createNamespaceDetails({
        ingress: 'DenyAll',
        cpuRequest: '800m',
        cpuLimit: '700m',
      })
    );
    const { result } = renderHook(() => useInfoTab(defaultProject));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    await act(async () => {
      await result.current.handleSave();
      await waitFor(() => expect(result.current.updating).toBe(false));
    });

    expect(result.current.formData).toMatchObject({
      ingress: 'DenyAll',
      cpuRequest: 800,
      cpuLimit: 700,
    });
    expect(result.current.validation.isValid).toBe(false);
    expect(result.current.validation.errors).toContain(
      'CPU requests cannot be greater than CPU limits'
    );
  });

  test('handleSave ignores a late save response after the namespace scope changes', async () => {
    let finish!: (value: unknown) => void;
    mockUpdateManagedNamespace.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const { result, rerender } = renderHook(({ project }) => useInfoTab(project), {
      initialProps: { project: defaultProject },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => result.current.handleSave());
    mockGetManagedNamespaceDetails.mockResolvedValue(
      createNamespaceDetails({ cpuRequest: '1500m' })
    );
    rerender({
      project: { ...defaultProject, id: 'other-project', namespaces: ['other-namespace'] },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => finish(createNamespaceDetails({ ingress: 'DenyAll', cpuRequest: '700m' })));
    await waitFor(() => expect(result.current.formData.cpuRequest).toBe(1500));
    expect(result.current.formData.ingress).toBe('AllowSameNamespace');
    expect(result.current.updating).toBe(false);
  });

  test('handleSave ignores a late save error after the namespace scope changes', async () => {
    let fail!: (error: Error) => void;
    mockUpdateManagedNamespace.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      })
    );
    const { result, rerender } = renderHook(({ project }) => useInfoTab(project), {
      initialProps: { project: defaultProject },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => result.current.handleSave());
    rerender({
      project: { ...defaultProject, id: 'other-project', namespaces: ['other-namespace'] },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => fail(new Error('old save failed')));
    await waitFor(() => expect(result.current.error).toBeNull());
  });
  test('handleSave leaves updating as false when updateManagedNamespace throws', async () => {
    mockUpdateManagedNamespace.mockRejectedValue(new Error('update failed'));

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
    });

    await act(async () => {
      await result.current.handleSave();
    });

    await waitFor(() => expect(result.current.updating).toBe(false));
    expect(result.current.error).toBe('update failed');
  });

  test('handleSave is a no-op when resourceGroup label is absent', async () => {
    mockUseGet.mockReturnValue([{ jsonData: { metadata: { labels: {} } } }]);

    const { result } = renderHook(() => useInfoTab(defaultProject));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSave();
    });

    expect(mockUpdateManagedNamespace).not.toHaveBeenCalled();
  });
});
