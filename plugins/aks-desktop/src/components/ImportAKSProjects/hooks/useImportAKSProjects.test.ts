// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks (vi.hoisted ensures variables are available when vi.mock is hoisted) ---

const mockRegisterAKSCluster = vi.hoisted(() => vi.fn());
const mockGetSubscriptions = vi.hoisted(() => vi.fn());
const mockApplyProjectLabels = vi.hoisted(() => vi.fn());
const mockHistoryPush = vi.hoisted(() => vi.fn());
const mockHistoryReplace = vi.hoisted(() => vi.fn());
const mockDiscover = vi.hoisted(() => vi.fn());
const mockGetClusterSettings = vi.hoisted(() => vi.fn());
const mockSetClusterSettings = vi.hoisted(() => vi.fn());
const mockTrackFeature = vi.hoisted(() => vi.fn());
const mockTrackError = vi.hoisted(() => vi.fn());

let mockNamespaces: any[] = [];
let mockRegisteredClusters: Set<string> = new Set();

vi.mock('../../../utils/azure/aks', () => ({
  registerAKSCluster: mockRegisterAKSCluster,
  getSubscriptions: mockGetSubscriptions,
}));

vi.mock('../../../utils/kubernetes/namespaceUtils', () => ({
  applyProjectLabels: mockApplyProjectLabels,
}));

vi.mock('../../../utils/shared/clusterSettings', () => ({
  getClusterSettings: mockGetClusterSettings,
  setClusterSettings: mockSetClusterSettings,
}));

vi.mock('../../../hooks/useNamespaceDiscovery', () => ({
  useNamespaceDiscovery: () => ({
    namespaces: mockNamespaces,
    loading: false,
    error: null,
    refresh: mockDiscover,
  }),
}));

vi.mock('../../../hooks/useRegisteredClusters', () => ({
  useRegisteredClusters: () => mockRegisteredClusters,
}));

vi.mock('../../../telemetry', () => ({
  trackFeature: mockTrackFeature,
  trackError: mockTrackError,
}));

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockHistoryPush, replace: mockHistoryReplace }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'Successfully merged {{count}} cluster(s)':
          'Successfully imported from {{count}} cluster(s)',
        'Failed to import any projects. See details below.': 'Failed to import any projects.',
      }[key] ?? key),
  }),
}));

import type { DiscoveredNamespace } from '../../../hooks/useNamespaceDiscovery';
import type { ImportSelection } from './useImportAKSProjects';
import { useImportAKSProjects } from './useImportAKSProjects';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNamespace(
  name: string,
  clusterName: string,
  resourceGroup = 'rg',
  subscriptionId = 'sub',
  isAksProject = true,
  isManagedNamespace = true
): DiscoveredNamespace {
  return {
    name,
    clusterName,
    resourceGroup,
    subscriptionId,
    labels: {},
    provisioningState: 'Succeeded',
    isAksProject,
    isManagedNamespace,
    category: isAksProject ? 'needs-import' : 'needs-conversion',
  };
}

function makeSelection(ns: DiscoveredNamespace): ImportSelection {
  return { namespace: ns };
}

describe('useImportAKSProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNamespaces = [];
    mockRegisteredClusters = new Set();
    mockRegisterAKSCluster.mockResolvedValue({ success: true, message: '' });
    mockGetSubscriptions.mockResolvedValue({ success: true, message: '', subscriptions: [] });
    mockApplyProjectLabels.mockResolvedValue(undefined);
    mockGetClusterSettings.mockReturnValue({});
    mockSetClusterSettings.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  test('starts with correct initial state', () => {
    const { result } = renderHook(() => useImportAKSProjects());

    expect(result.current.error).toBe('');
    expect(result.current.success).toBe('');
    expect(result.current.importing).toBe(false);
    expect(result.current.importResults).toBeUndefined();
    expect(result.current.showConversionDialog).toBe(false);
  });

  // -------------------------------------------------------------------------
  // handleImportClick — guard
  // -------------------------------------------------------------------------

  test('handleImportClick sets error when nothing selected', () => {
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([]));

    expect(result.current.error).toBe('Please select at least one namespace to import');
    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // ConversionDialog flow
  // -------------------------------------------------------------------------

  test('handleImportClick opens ConversionDialog when non-project namespaces selected', () => {
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    act(() => result.current.handleImportClick([makeSelection(ns)]));

    expect(result.current.showConversionDialog).toBe(true);
    expect(result.current.namespacesToConvert).toHaveLength(1);
    expect(result.current.namespacesToConvert[0].name).toBe('ns-1');
  });

  test('handleImportClick skips ConversionDialog when all namespaces are already projects', () => {
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl');

    act(() => result.current.handleImportClick([makeSelection(ns)]));

    expect(result.current.showConversionDialog).toBe(false);
  });

  test('handleConversionClose resets dialog and pending selection', () => {
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    act(() => result.current.handleImportClick([makeSelection(ns)]));
    expect(result.current.showConversionDialog).toBe(true);

    act(() => result.current.handleConversionClose());
    expect(result.current.showConversionDialog).toBe(false);
    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
  });

  test('handleConversionConfirm closes dialog and starts import', async () => {
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    act(() => result.current.handleImportClick([makeSelection(ns)]));
    act(() => result.current.handleConversionConfirm());
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(result.current.showConversionDialog).toBe(false);
    expect(result.current.importResults).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // handleImportClick — cluster registration
  // -------------------------------------------------------------------------

  test('skips registerAKSCluster for already-registered clusters', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl');

    act(() => result.current.handleImportClick([makeSelection(ns)]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
    expect(result.current.importResults![0].success).toBe(true);
  });

  test('calls registerAKSCluster once per unregistered cluster', async () => {
    const { result } = renderHook(() => useImportAKSProjects());

    act(() =>
      result.current.handleImportClick([
        makeSelection(makeNamespace('ns-1', 'cl', 'rg', 'sub')),
        makeSelection(makeNamespace('ns-2', 'cl', 'rg', 'sub')),
      ])
    );
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(mockRegisterAKSCluster).toHaveBeenCalledTimes(1);
    expect(mockRegisterAKSCluster).toHaveBeenCalledWith('sub', 'rg', 'cl', undefined, undefined);
  });

  test('marks cluster namespaces failed when registerAKSCluster returns failure', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'auth error' });
    const { result } = renderHook(() => useImportAKSProjects());

    act(() =>
      result.current.handleImportClick([
        makeSelection(makeNamespace('ns-1', 'cl')),
        makeSelection(makeNamespace('ns-2', 'cl')),
      ])
    );
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(result.current.importResults).toHaveLength(2);
    expect(result.current.importResults!.every(r => !r.success)).toBe(true);
    expect(result.current.error).toBe('Failed to import any projects.');
  });

  test('marks namespaces failed and skips registration for unregistered namespace without Azure metadata', async () => {
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', '', '', true, false); // no resourceGroup/subscriptionId

    act(() => result.current.handleImportClick([makeSelection(ns)]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(result.current.importResults![0].success).toBe(false);
    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
  });

  test('does not re-register a cluster on retry after registering it earlier in the session', async () => {
    // Registration succeeds, but label conversion fails so every namespace fails and the
    // user is able to retry the import in-place.
    mockApplyProjectLabels.mockRejectedValue(new Error('label error'));
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    // First attempt: registers the cluster, then conversion fails for all namespaces.
    act(() => result.current.handleImportClick([makeSelection(ns)]));
    act(() => result.current.handleConversionConfirm());
    await waitFor(() => expect(result.current.importing).toBe(false));
    expect(mockRegisterAKSCluster).toHaveBeenCalledTimes(1);
    expect(result.current.importResults!.every(r => !r.success)).toBe(true);

    // Retry the same selection: the cluster is already registered this session, so
    // registerAKSCluster must not be called again (avoids overwriting kubeconfig creds).
    act(() => result.current.handleImportClick([makeSelection(ns)]));
    act(() => result.current.handleConversionConfirm());
    await waitFor(() => expect(result.current.importing).toBe(false));
    expect(mockRegisterAKSCluster).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // handleImportClick — label conversion
  // -------------------------------------------------------------------------

  test('calls applyProjectLabels for non-project namespaces', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    // non-project namespace triggers ConversionDialog first; confirm to run processImport
    act(() => result.current.handleImportClick([makeSelection(ns)]));
    act(() => result.current.handleConversionConfirm());
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(mockApplyProjectLabels).toHaveBeenCalledTimes(1);
    expect(mockApplyProjectLabels).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: 'ns-1', clusterName: 'cl' })
    );
  });

  test('skips applyProjectLabels for already-project namespaces', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', true);

    act(() => result.current.handleImportClick([makeSelection(ns)]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(mockApplyProjectLabels).not.toHaveBeenCalled();
  });

  test('marks namespace failed and continues when applyProjectLabels throws', async () => {
    mockRegisteredClusters = new Set(['cl']);
    mockApplyProjectLabels.mockRejectedValue(new Error('label error'));
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    // non-project namespace triggers ConversionDialog first; confirm to run processImport
    act(() => result.current.handleImportClick([makeSelection(ns)]));
    act(() => result.current.handleConversionConfirm());
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(result.current.importResults![0].success).toBe(false);
    expect(result.current.importResults![0].message).toContain('Failed to convert namespace');
  });

  // -------------------------------------------------------------------------
  // handleImportClick — localStorage
  // -------------------------------------------------------------------------

  test('does not create an allowedNamespaces restriction when none existed (#489)', async () => {
    mockRegisteredClusters = new Set(['cl']);
    mockGetClusterSettings.mockReturnValue({ allowedNamespaces: [] });
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    // Empty/absent allowedNamespaces must not be turned into a restriction (see #489).
    expect(mockSetClusterSettings).not.toHaveBeenCalled();
  });

  test('deduplicates allowedNamespaces when merging with existing settings', async () => {
    mockRegisteredClusters = new Set(['cl']);
    mockGetClusterSettings.mockReturnValue({ allowedNamespaces: ['ns-1'] });
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    const [, settings] = mockSetClusterSettings.mock.calls[0];
    expect(settings.allowedNamespaces.filter((n: string) => n === 'ns-1')).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // handleImportClick — success / failure outcomes
  // -------------------------------------------------------------------------

  test('sets success message when all namespaces import successfully', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(result.current.success).not.toBe('');
    expect(result.current.error).toBe('');
    expect(result.current.importResults![0].success).toBe(true);
  });

  test('sets error message when all imports fail', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'denied' });
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(result.current.error).toBe('Failed to import any projects.');
    expect(result.current.success).toBe('');
  });

  test('handles unexpected orchestration errors without leaving the import pending', async () => {
    const namespaceWithBrokenClusterName = makeNamespace('ns-1', 'cl');
    Object.defineProperty(namespaceWithBrokenClusterName, 'clusterName', {
      get: () => {
        throw new Error('unexpected');
      },
    });
    mockNamespaces = [namespaceWithBrokenClusterName];
    const selectedNamespace = makeNamespace('ns-1', 'cl');
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(selectedNamespace)]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(result.current.error).toBe('Failed to import any projects.');
    expect(result.current.importResults).toEqual([
      {
        namespace: 'ns-1 (cl)',
        clusterName: 'cl',
        success: false,
        message: 'unexpected',
      },
    ]);
    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.project-import',
      status: 'failed',
    });
    expect(mockTrackError).toHaveBeenCalledWith({
      area: 'project-import',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
  });

  // -------------------------------------------------------------------------
  // clearError, clearSuccess
  // -------------------------------------------------------------------------

  test('clearError clears the error message', () => {
    const { result } = renderHook(() => useImportAKSProjects());
    act(() => result.current.handleImportClick([]));
    expect(result.current.error).not.toBe('');

    act(() => result.current.clearError());
    expect(result.current.error).toBe('');
  });

  test('clearSuccess clears the success message', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))]));
    await waitFor(() => expect(result.current.importing).toBe(false));
    expect(result.current.success).not.toBe('');

    act(() => result.current.clearSuccess());
    expect(result.current.success).toBe('');
  });

  // -------------------------------------------------------------------------
  // handleGoToProjects
  // -------------------------------------------------------------------------

  test('handleGoToProjects replaces history and reloads', () => {
    const originalLocation = window.location;
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    const reloadMock = vi.fn();
    // Strip accessor fields (get/set) — can't mix with value descriptor
    const { configurable, enumerable } = originalDescriptor ?? {};
    Object.defineProperty(window, 'location', {
      configurable,
      enumerable,
      value: { reload: reloadMock },
      writable: true,
    });
    try {
      const { result } = renderHook(() => useImportAKSProjects());
      act(() => result.current.handleGoToProjects());
      expect(mockHistoryReplace).toHaveBeenCalledWith('/');
      expect(reloadMock).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, 'location', originalDescriptor);
      } else {
        (window as any).location = originalLocation;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Telemetry
  // -------------------------------------------------------------------------

  const FEATURE = 'aksd.project-import';

  test('reports "opened" when the hook mounts', () => {
    renderHook(() => useImportAKSProjects());

    expect(mockTrackFeature).toHaveBeenCalledWith({ feature: FEATURE, status: 'opened' });
  });

  test('reports "started" then "succeeded" for a fully successful import', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(mockTrackFeature).toHaveBeenCalledWith({ feature: FEATURE, status: 'started' });
    expect(mockTrackFeature).toHaveBeenCalledWith({ feature: FEATURE, status: 'succeeded' });
    expect(mockTrackError).not.toHaveBeenCalled();
  });

  test('reports "completed" and an error for a partial import', async () => {
    // cl-ok is already registered (import succeeds); cl-bad is unregistered without
    // Azure metadata (import fails) — yielding one success and one failure.
    mockRegisteredClusters = new Set(['cl-ok']);
    const { result } = renderHook(() => useImportAKSProjects());

    act(() =>
      result.current.handleImportClick([
        makeSelection(makeNamespace('ns-ok', 'cl-ok')),
        makeSelection(makeNamespace('ns-bad', 'cl-bad', '', '', true, false)),
      ])
    );
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(mockTrackFeature).toHaveBeenCalledWith({ feature: FEATURE, status: 'completed' });
    expect(mockTrackError).toHaveBeenCalledWith({
      area: 'project-import',
      errorClass: 'UnknownError',
      phase: 'completed',
    });
  });

  test('reports "failed" and an error when all imports fail', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'denied' });
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))]));
    await waitFor(() => expect(result.current.importing).toBe(false));

    expect(mockTrackFeature).toHaveBeenCalledWith({ feature: FEATURE, status: 'failed' });
    expect(mockTrackError).toHaveBeenCalledWith({
      area: 'project-import',
      errorClass: 'UnknownError',
      phase: 'failed',
    });
  });

  test('reports "cancelled" when the conversion dialog is closed', () => {
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    act(() => result.current.handleImportClick([makeSelection(ns)]));
    act(() => result.current.handleConversionClose());

    expect(mockTrackFeature).toHaveBeenCalledWith({ feature: FEATURE, status: 'cancelled' });
  });

  test('handleCancel reports "cancelled" and navigates home', () => {
    const { result } = renderHook(() => useImportAKSProjects());

    act(() => result.current.handleCancel());

    expect(mockTrackFeature).toHaveBeenCalledWith({ feature: FEATURE, status: 'cancelled' });
    expect(mockHistoryPush).toHaveBeenCalledWith('/');
  });

  test('telemetry failures do not interrupt cancellation', () => {
    mockTrackFeature.mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });
    const { result } = renderHook(() => useImportAKSProjects());

    expect(() => act(() => result.current.handleCancel())).not.toThrow();
    expect(mockHistoryPush).toHaveBeenCalledWith('/');
  });
});
