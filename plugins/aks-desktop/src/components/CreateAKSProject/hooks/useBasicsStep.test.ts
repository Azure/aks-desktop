// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be hoisted before any imports that pull in the real modules)
// ---------------------------------------------------------------------------

const mockUseClustersConf = vi.hoisted(() => vi.fn());
const mockUseAzureAuth = vi.hoisted(() => vi.fn());
const mockGetClusterSettings = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useClustersConf: mockUseClustersConf,
  },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../hooks/useAzureAuth', () => ({
  useAzureAuth: mockUseAzureAuth,
}));

vi.mock('../../../utils/shared/clusterSettings', () => ({
  getClusterSettings: mockGetClusterSettings,
}));

// Import after mocks are in place
import type { BasicsStepProps } from '../types';
import {
  getClusterHelperText,
  getClusterOptionValue,
  getClusterStateMessage,
  isClusterNonReady,
  useBasicsStep,
} from './useBasicsStep';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBSCRIPTION = {
  id: 'sub-123',
  name: 'Production',
  tenant: 'tenant-abc',
  tenantName: 'Contoso',
  status: 'Enabled',
};

const CLUSTER_RUNNING = {
  name: 'aks-prod',
  location: 'eastus',
  version: '1.28.5',
  nodeCount: 3,
  status: 'Succeeded',
  resourceGroup: 'rg-prod',
  powerState: 'Running',
};

const CLUSTER_UPDATING = {
  ...CLUSTER_RUNNING,
  status: 'Updating',
};

const ARC_ONLINE = {
  ...CLUSTER_RUNNING,
  name: 'arc-online',
  nodeCount: 0,
  clusterType: 'aksarc' as const,
  connectivityStatus: 'Connected',
};

const ARC_OFFLINE = {
  ...ARC_ONLINE,
  name: 'arc-offline',
  connectivityStatus: 'Offline',
};

function makeProps(overrides: Partial<BasicsStepProps> = {}): BasicsStepProps {
  return {
    formData: {
      projectName: 'my-project',
      description: '',
      subscription: '',
      cluster: '',
      resourceGroup: '',
      ingress: 'AllowSameNamespace',
      egress: 'AllowAll',
      cpuRequest: 2000,
      memoryRequest: 4096,
      cpuLimit: 2000,
      memoryLimit: 4096,
      userAssignments: [],
    },
    onFormDataChange: vi.fn(),
    validation: { isValid: true, errors: [], warnings: [] },
    loading: false,
    error: null,
    subscriptions: [SUBSCRIPTION],
    clusters: [CLUSTER_RUNNING],
    loadingClusters: false,
    clusterError: null,
    totalClusterCount: null,
    extensionStatus: { installed: true, installing: false, error: null, showSuccess: false },
    namespaceStatus: { exists: null, checking: false, error: null },
    clusterAccessStatus: { checking: false, accessible: null },
    clusterCapabilities: null,
    capabilitiesLoading: false,
    onInstallExtension: vi.fn(),
    onRetrySubscriptions: vi.fn(),
    onRetryClusters: vi.fn(),
    onRefreshCapabilities: vi.fn(),
    ...overrides,
  };
}

const t = (key: string) => key;

// ---------------------------------------------------------------------------
// Helper function tests (pure, no hooks)
// ---------------------------------------------------------------------------

describe('getClusterHelperText', () => {
  test('returns Entra ID note while loading', () => {
    const result = getClusterHelperText(t, true, 0, null);
    expect(result).toBe('Only clusters with Azure Entra ID authentication are shown.');
  });

  test('reports zero clusters found when list is empty and nothing hidden', () => {
    const result = getClusterHelperText(t, false, 0, 0);
    expect(result).toContain('No eligible clusters found');
    expect(result).not.toContain('hidden');
  });

  test('appends hidden count suffix when totalClusterCount > clusterCount', () => {
    const result = getClusterHelperText(t, false, 2, 5);
    // The stub t() does not interpolate — assert on the key text and the suffix
    expect(result).toContain('eligible cluster(s) found');
    expect(result).toContain('hidden');
  });

  test('reports eligible count when clusters are found', () => {
    const result = getClusterHelperText(t, false, 3, 3);
    expect(result).toContain('eligible cluster(s) found');
    expect(result).not.toContain('hidden');
  });

  test('does not append hidden suffix when totalClusterCount is null', () => {
    const result = getClusterHelperText(t, false, 2, null);
    expect(result).not.toContain('hidden');
  });
});

describe('isClusterNonReady', () => {
  test.each([
    ['Updating', 'Running'],
    ['Upgrading', 'Running'],
    ['Deleting', 'Running'],
    ['Creating', 'Running'],
    ['Failed', 'Running'],
  ])('returns true for provisioning state "%s"', (status, powerState) => {
    expect(isClusterNonReady({ ...CLUSTER_RUNNING, status, powerState })).toBe(true);
  });

  test.each([
    ['Succeeded', 'Stopping'],
    ['Succeeded', 'Stopped'],
    ['Succeeded', 'Deallocating'],
    ['Succeeded', 'Deallocated'],
  ])('returns true for power state "%s"', (status, powerState) => {
    expect(isClusterNonReady({ ...CLUSTER_RUNNING, status, powerState })).toBe(true);
  });

  test('returns false for a healthy running cluster', () => {
    expect(isClusterNonReady(CLUSTER_RUNNING)).toBe(false);
  });

  test('is case-insensitive for provisioning state', () => {
    expect(isClusterNonReady({ ...CLUSTER_RUNNING, status: 'FAILED' })).toBe(true);
  });

  test('is case-insensitive for power state', () => {
    expect(isClusterNonReady({ ...CLUSTER_RUNNING, powerState: 'STOPPED' })).toBe(true);
  });
});

describe('getClusterStateMessage', () => {
  test('returns updating message for Updating provisioning state', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, status: 'Updating' }, t);
    expect(msg).toBe('Cluster is currently updating. Deployment may fail.');
  });

  test('returns same updating message for Upgrading state', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, status: 'Upgrading' }, t);
    expect(msg).toBe('Cluster is currently updating. Deployment may fail.');
  });

  test('returns deleting message', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, status: 'Deleting' }, t);
    expect(msg).toBe('Cluster is being deleted. Cannot deploy to this cluster.');
  });

  test('returns creating message', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, status: 'Creating' }, t);
    expect(msg).toBe('Cluster is still being created. Please wait until creation completes.');
  });

  test('returns failed message', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, status: 'Failed' }, t);
    expect(msg).toBe('Cluster is in a failed state. Please check Azure portal.');
  });

  test('returns stopped message for Stopped power state', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, powerState: 'Stopped' }, t);
    expect(msg).toBe('Cluster is stopped. Please start the cluster before deploying.');
  });

  test('returns stopped message for Stopping power state', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, powerState: 'Stopping' }, t);
    expect(msg).toBe('Cluster is stopped. Please start the cluster before deploying.');
  });

  test('returns deallocated message', () => {
    const msg = getClusterStateMessage({ ...CLUSTER_RUNNING, powerState: 'Deallocated' }, t);
    expect(msg).toBe('Cluster is deallocated. Please start the cluster before deploying.');
  });

  test('returns empty string for a healthy cluster', () => {
    const msg = getClusterStateMessage(CLUSTER_RUNNING, t);
    expect(msg).toBe('');
  });
});

// ---------------------------------------------------------------------------
// useBasicsStep hook tests
// ---------------------------------------------------------------------------

describe('useBasicsStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no clusters in headlamp kubeconfig
    mockUseClustersConf.mockReturnValue({});
    mockGetClusterSettings.mockReturnValue({
      azureRegistration: { subscriptionId: 'sub-123', resourceGroup: 'rg-prod' },
    });
    // Default: not logged in, no subscriptionId
    mockUseAzureAuth.mockReturnValue({ isLoggedIn: false, isChecking: false });
  });

  test('maps subscriptions to SearchableSelectOption format', () => {
    const { result } = renderHook(() => useBasicsStep(makeProps()));
    expect(result.current.subscriptionOptions).toHaveLength(1);
    expect(result.current.subscriptionOptions[0]).toMatchObject({
      value: 'sub-123',
      label: 'Production',
    });
    expect(result.current.subscriptionOptions[0].subtitle).toContain('Contoso');
    expect(result.current.subscriptionOptions[0].subtitle).toContain('Enabled');
  });

  test('maps clusters to SearchableSelectOption format', () => {
    const { result } = renderHook(() => useBasicsStep(makeProps()));
    expect(result.current.clusterOptions).toHaveLength(1);
    expect(result.current.clusterOptions[0]).toMatchObject({
      value: getClusterOptionValue(CLUSTER_RUNNING),
      label: 'aks-prod',
    });
    expect(result.current.clusterOptions[0].subtitle).toContain('eastus');
    expect(result.current.clusterOptions[0].subtitle).toContain('1.28.5');
    expect(result.current.clusterOptions[0].subtitle).toContain('nodes');
    // A Succeeded cluster is selectable.
    expect(result.current.clusterOptions[0].disabled).toBe(false);
  });

  test('disables cluster options in a Failed provisioning state', () => {
    const props = makeProps({
      clusters: [CLUSTER_RUNNING, { ...CLUSTER_RUNNING, name: 'aks-broken', status: 'Failed' }],
    });
    const { result } = renderHook(() => useBasicsStep(props));
    const options = result.current.clusterOptions;
    expect(options.find(o => o.label === 'aks-prod')?.disabled).toBe(false);
    expect(options.find(o => o.label === 'aks-broken')?.disabled).toBe(true);
  });

  test('disables an offline Arc cluster and shows Offline, not its stale Succeeded state', () => {
    // An Arc cluster's `status` (provisioningState) stays Succeeded once created,
    // however sick the cluster gets, so the heartbeat is the only signal here.
    const props = makeProps({ clusters: [ARC_ONLINE, ARC_OFFLINE] });
    const { result } = renderHook(() => useBasicsStep(props));
    const online = result.current.clusterOptions.find(o => o.label === 'arc-online');
    const offline = result.current.clusterOptions.find(o => o.label === 'arc-offline');

    expect(online?.disabled).toBe(false);
    expect(online?.subtitle).toContain('Succeeded');
    expect(online?.chips?.map(c => c.label)).toEqual(['AKS Hybrid & Edge']);

    expect(offline?.disabled).toBe(true);
    expect(offline?.subtitle).toContain('Offline');
    expect(offline?.subtitle).not.toContain('Succeeded');
    expect(offline?.chips?.map(c => c.label)).toEqual(['AKS Hybrid & Edge', 'Offline']);
  });

  test('an offline Arc cluster that also failed provisioning reads Failed', () => {
    const props = makeProps({
      clusters: [{ ...ARC_OFFLINE, name: 'arc-broken', status: 'Failed' }],
    });
    const { result } = renderHook(() => useBasicsStep(props));
    const option = result.current.clusterOptions[0];
    expect(option.disabled).toBe(true);
    expect(option.subtitle).toContain('Failed');
  });

  test('managed clusters carry no heartbeat and are never marked offline', () => {
    const { result } = renderHook(() => useBasicsStep(makeProps()));
    expect(result.current.clusterOptions[0].disabled).toBe(false);
    expect(result.current.clusterOptions[0].chips).toEqual([]);
  });

  test('selectedSubscription is undefined when no subscription is selected', () => {
    const { result } = renderHook(() => useBasicsStep(makeProps()));
    expect(result.current.selectedSubscription).toBeUndefined();
  });

  test('selectedSubscription returns the matching subscription object', () => {
    const props = makeProps({
      formData: { ...makeProps().formData, subscription: 'sub-123' },
    });
    const { result } = renderHook(() => useBasicsStep(props));
    expect(result.current.selectedSubscription).toEqual(SUBSCRIPTION);
  });

  test('selectedCluster, isClusterMissing, and nonReadyCluster are all falsy when no cluster is selected', () => {
    const { result } = renderHook(() => useBasicsStep(makeProps()));
    expect(result.current.selectedCluster).toBeUndefined();
    expect(result.current.isClusterMissing).toBe(false);
    expect(result.current.nonReadyCluster).toBeNull();
  });

  test('selectedCluster returns the matching cluster object', () => {
    const props = makeProps({
      formData: {
        projectName: 'my-project',
        description: '',
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
        ingress: 'AllowSameNamespace',
        egress: 'AllowAll',
        cpuRequest: 2000,
        memoryRequest: 4096,
        cpuLimit: 2000,
        memoryLimit: 4096,
        userAssignments: [],
      },
    });
    const { result } = renderHook(() => useBasicsStep(props));
    expect(result.current.selectedCluster).toEqual(CLUSTER_RUNNING);
    expect(result.current.selectedClusterValue).toBe(getClusterOptionValue(CLUSTER_RUNNING));
  });

  test('selects and validates same-name clusters by resource group', () => {
    mockUseClustersConf.mockReturnValue({ 'ctx-1': { name: 'aks-prod' } });
    const otherScopeCluster = {
      ...CLUSTER_RUNNING,
      location: 'westus',
      resourceGroup: 'rg-other',
    };
    const onFormDataChange = vi.fn();
    const props = makeProps({
      clusters: [CLUSTER_RUNNING, otherScopeCluster],
      onFormDataChange,
      formData: {
        ...makeProps().formData,
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-other',
      },
    });

    const { result } = renderHook(() => useBasicsStep(props));

    expect(new Set(result.current.clusterOptions.map(option => option.value)).size).toBe(2);
    expect(result.current.clusterOptions.map(option => option.subtitle)).toEqual([
      expect.stringContaining('rg-prod'),
      expect.stringContaining('rg-other'),
    ]);
    expect(result.current.selectedCluster).toEqual(otherScopeCluster);
    expect(result.current.selectedClusterValue).toBe(getClusterOptionValue(otherScopeCluster));
    expect(result.current.clusterScopeConflict).toBe(true);

    act(() => result.current.handleClusterChange(getClusterOptionValue(CLUSTER_RUNNING)));
    expect(onFormDataChange).toHaveBeenCalledWith({
      cluster: 'aks-prod',
      resourceGroup: 'rg-prod',
    });
  });

  test('isClusterMissing is true when cluster is selected but absent from headlamp', () => {
    mockUseClustersConf.mockReturnValue({});
    const props = makeProps({
      formData: {
        projectName: 'my-project',
        description: '',
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
        ingress: 'AllowSameNamespace',
        egress: 'AllowAll',
        cpuRequest: 2000,
        memoryRequest: 4096,
        cpuLimit: 2000,
        memoryLimit: 4096,
        userAssignments: [],
      },
    });
    const { result } = renderHook(() => useBasicsStep(props));
    expect(result.current.isClusterMissing).toBe(true);
  });

  test('isClusterMissing is false when the cluster is present in headlamp', () => {
    mockUseClustersConf.mockReturnValue({ 'ctx-1': { name: 'aks-prod' } });
    const props = makeProps({
      formData: {
        projectName: 'my-project',
        description: '',
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
        ingress: 'AllowSameNamespace',
        egress: 'AllowAll',
        cpuRequest: 2000,
        memoryRequest: 4096,
        cpuLimit: 2000,
        memoryLimit: 4096,
        userAssignments: [],
      },
    });
    const { result } = renderHook(() => useBasicsStep(props));
    expect(result.current.isClusterMissing).toBe(false);
  });

  test('validates an active cluster with different name casing', () => {
    mockUseClustersConf.mockReturnValue({ 'ctx-1': { name: 'AKS-PROD' } });
    const props = makeProps({
      formData: {
        ...makeProps().formData,
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
      },
    });

    const { result } = renderHook(() => useBasicsStep(props));

    expect(result.current.isClusterMissing).toBe(false);
    expect(result.current.clusterScopeConflict).toBe(false);
  });

  test('isClusterMissing is true when a same-name active cluster has another Azure scope', () => {
    mockUseClustersConf.mockReturnValue({ 'ctx-1': { name: 'aks-prod' } });
    mockGetClusterSettings.mockReturnValue({
      azureRegistration: { subscriptionId: 'other-sub', resourceGroup: 'other-rg' },
    });
    const props = makeProps({
      formData: {
        ...makeProps().formData,
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
      },
    });

    const { result } = renderHook(() => useBasicsStep(props));

    expect(result.current.isClusterMissing).toBe(true);
    expect(result.current.clusterScopeConflict).toBe(true);
  });

  test('isClusterMissing is true when a same-name active cluster has unknown Azure scope', () => {
    mockUseClustersConf.mockReturnValue({ 'ctx-1': { name: 'aks-prod' } });
    mockGetClusterSettings.mockReturnValue({});
    const props = makeProps({
      formData: {
        ...makeProps().formData,
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
      },
    });

    const { result } = renderHook(() => useBasicsStep(props));

    expect(result.current.isClusterMissing).toBe(true);
    expect(result.current.clusterScopeConflict).toBe(true);
  });

  test('nonReadyCluster is null for a healthy running cluster', () => {
    const props = makeProps({
      formData: {
        projectName: 'my-project',
        description: '',
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
        ingress: 'AllowSameNamespace',
        egress: 'AllowAll',
        cpuRequest: 2000,
        memoryRequest: 4096,
        cpuLimit: 2000,
        memoryLimit: 4096,
        userAssignments: [],
      },
    });
    const { result } = renderHook(() => useBasicsStep(props));
    expect(result.current.nonReadyCluster).toBeNull();
  });

  test('nonReadyCluster is populated for an updating cluster', () => {
    const props = makeProps({
      clusters: [CLUSTER_UPDATING],
      formData: {
        projectName: 'my-project',
        description: '',
        subscription: 'sub-123',
        cluster: 'aks-prod',
        resourceGroup: 'rg-prod',
        ingress: 'AllowSameNamespace',
        egress: 'AllowAll',
        cpuRequest: 2000,
        memoryRequest: 4096,
        cpuLimit: 2000,
        memoryLimit: 4096,
        userAssignments: [],
      },
    });
    const { result } = renderHook(() => useBasicsStep(props));
    expect(result.current.nonReadyCluster).not.toBeNull();
    expect(result.current.nonReadyCluster?.cluster).toEqual(CLUSTER_UPDATING);
    expect(result.current.nonReadyCluster?.message).toBe(
      'Cluster is currently updating. Deployment may fail.'
    );
  });

  test('handleInputChange calls onFormDataChange with the correct field patch', () => {
    const onFormDataChange = vi.fn();
    const { result } = renderHook(() => useBasicsStep(makeProps({ onFormDataChange })));
    act(() => result.current.handleInputChange('projectName', 'new-name'));
    expect(onFormDataChange).toHaveBeenCalledWith({ projectName: 'new-name' });
  });

  test('handleClusterChange updates both cluster and resourceGroup', () => {
    const onFormDataChange = vi.fn();
    const { result } = renderHook(() => useBasicsStep(makeProps({ onFormDataChange })));
    act(() => result.current.handleClusterChange(getClusterOptionValue(CLUSTER_RUNNING)));
    expect(onFormDataChange).toHaveBeenCalledWith({
      cluster: 'aks-prod',
      resourceGroup: 'rg-prod',
    });
  });

  test('handleClusterChange does nothing when the cluster name is not in the list', () => {
    const onFormDataChange = vi.fn();
    const { result } = renderHook(() => useBasicsStep(makeProps({ onFormDataChange })));
    act(() => result.current.handleClusterChange('nonexistent-cluster'));
    expect(onFormDataChange).not.toHaveBeenCalled();
  });

  test('handleClusterChange resets cluster and resourceGroup when called with empty string', () => {
    const onFormDataChange = vi.fn();
    const { result } = renderHook(() => useBasicsStep(makeProps({ onFormDataChange })));
    act(() => result.current.handleClusterChange(''));
    expect(onFormDataChange).toHaveBeenCalledWith({ cluster: '', resourceGroup: '' });
  });

  test('auto-selects default subscription when authStatus matches and none is selected', async () => {
    mockUseAzureAuth.mockReturnValue({
      isLoggedIn: true,
      isChecking: false,
      subscriptionId: 'sub-123',
    });
    const onFormDataChange = vi.fn();
    renderHook(() => useBasicsStep(makeProps({ onFormDataChange })));
    await waitFor(() => {
      expect(onFormDataChange).toHaveBeenCalledWith({ subscription: 'sub-123' });
    });
  });

  test('does not auto-select subscription when one is already chosen', async () => {
    mockUseAzureAuth.mockReturnValue({
      isLoggedIn: true,
      isChecking: false,
      subscriptionId: 'sub-123',
    });
    const onFormDataChange = vi.fn();
    renderHook(() =>
      useBasicsStep(
        makeProps({
          onFormDataChange,
          formData: {
            projectName: 'my-project',
            description: '',
            subscription: 'sub-123',
            cluster: '',
            resourceGroup: '',
            ingress: 'AllowSameNamespace',
            egress: 'AllowAll',
            cpuRequest: 2000,
            memoryRequest: 4096,
            cpuLimit: 2000,
            memoryLimit: 4096,
            userAssignments: [],
          },
        })
      )
    );
    // Allow any pending effects to flush before asserting the negative
    await waitFor(() => {
      expect(onFormDataChange).not.toHaveBeenCalled();
    });
  });

  test('does not auto-select when authStatus subscriptionId is not in the list', async () => {
    mockUseAzureAuth.mockReturnValue({
      isLoggedIn: true,
      isChecking: false,
      subscriptionId: 'sub-999',
    });
    const onFormDataChange = vi.fn();
    renderHook(() => useBasicsStep(makeProps({ onFormDataChange })));
    // Allow any pending effects to flush before asserting the negative
    await waitFor(() => {
      expect(onFormDataChange).not.toHaveBeenCalled();
    });
  });
});
