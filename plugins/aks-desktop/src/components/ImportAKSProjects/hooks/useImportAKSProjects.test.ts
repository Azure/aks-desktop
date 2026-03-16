// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks (vi.hoisted ensures variables are available when vi.mock is hoisted) ---

const mockRegisterAKSCluster = vi.hoisted(() => vi.fn());
const mockApplyProjectLabels = vi.hoisted(() => vi.fn());
const mockHistoryReplace = vi.hoisted(() => vi.fn());
const mockDiscover = vi.hoisted(() => vi.fn());
const mockGetClusterSettings = vi.hoisted(() => vi.fn());
const mockSetClusterSettings = vi.hoisted(() => vi.fn());

let mockNamespaces: any[] = [];
let mockRegisteredClusters: Set<string> = new Set();

vi.mock('../../../utils/azure/aks', () => ({
  registerAKSCluster: mockRegisterAKSCluster,
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

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ replace: mockHistoryReplace }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    await act(async () => result.current.handleConversionConfirm());

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

    await act(async () => result.current.handleImportClick([makeSelection(ns)]));

    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
    expect(result.current.importResults![0].success).toBe(true);
  });

  test('calls registerAKSCluster once per unregistered cluster', async () => {
    const { result } = renderHook(() => useImportAKSProjects());

    await act(async () =>
      result.current.handleImportClick([
        makeSelection(makeNamespace('ns-1', 'cl', 'rg', 'sub')),
        makeSelection(makeNamespace('ns-2', 'cl', 'rg', 'sub')),
      ])
    );

    expect(mockRegisterAKSCluster).toHaveBeenCalledTimes(1);
    expect(mockRegisterAKSCluster).toHaveBeenCalledWith('sub', 'rg', 'cl');
  });

  test('marks cluster namespaces failed when registerAKSCluster returns failure', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'auth error' });
    const { result } = renderHook(() => useImportAKSProjects());

    await act(async () =>
      result.current.handleImportClick([
        makeSelection(makeNamespace('ns-1', 'cl')),
        makeSelection(makeNamespace('ns-2', 'cl')),
      ])
    );

    expect(result.current.importResults).toHaveLength(2);
    expect(result.current.importResults!.every(r => !r.success)).toBe(true);
    expect(result.current.error).toBe('Failed to import any projects.');
  });

  test('marks namespaces failed and skips registration for unregistered namespace without Azure metadata', async () => {
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', '', '', true, false); // no resourceGroup/subscriptionId

    await act(async () => result.current.handleImportClick([makeSelection(ns)]));

    expect(result.current.importResults![0].success).toBe(false);
    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
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
    await act(async () => result.current.handleConversionConfirm());

    expect(mockApplyProjectLabels).toHaveBeenCalledTimes(1);
    expect(mockApplyProjectLabels).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: 'ns-1', clusterName: 'cl' })
    );
  });

  test('skips applyProjectLabels for already-project namespaces', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', true);

    await act(async () => result.current.handleImportClick([makeSelection(ns)]));

    expect(mockApplyProjectLabels).not.toHaveBeenCalled();
  });

  test('marks namespace failed and continues when applyProjectLabels throws', async () => {
    mockRegisteredClusters = new Set(['cl']);
    mockApplyProjectLabels.mockRejectedValue(new Error('label error'));
    const { result } = renderHook(() => useImportAKSProjects());
    const ns = makeNamespace('ns-1', 'cl', 'rg', 'sub', false);

    // non-project namespace triggers ConversionDialog first; confirm to run processImport
    act(() => result.current.handleImportClick([makeSelection(ns)]));
    await act(async () => result.current.handleConversionConfirm());

    expect(result.current.importResults![0].success).toBe(false);
    expect(result.current.importResults![0].message).toContain('Failed to convert namespace');
  });

  // -------------------------------------------------------------------------
  // handleImportClick — localStorage
  // -------------------------------------------------------------------------

  test('calls setClusterSettings with imported namespace names', async () => {
    mockRegisteredClusters = new Set(['cl']);
    mockGetClusterSettings.mockReturnValue({ allowedNamespaces: [] });
    const { result } = renderHook(() => useImportAKSProjects());

    await act(async () =>
      result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))])
    );

    expect(mockSetClusterSettings).toHaveBeenCalledWith(
      'cl',
      expect.objectContaining({ allowedNamespaces: expect.arrayContaining(['ns-1']) })
    );
  });

  test('deduplicates allowedNamespaces when merging with existing settings', async () => {
    mockRegisteredClusters = new Set(['cl']);
    mockGetClusterSettings.mockReturnValue({ allowedNamespaces: ['ns-1'] });
    const { result } = renderHook(() => useImportAKSProjects());

    await act(async () =>
      result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))])
    );

    const [, settings] = mockSetClusterSettings.mock.calls[0];
    expect(settings.allowedNamespaces.filter((n: string) => n === 'ns-1')).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // handleImportClick — success / failure outcomes
  // -------------------------------------------------------------------------

  test('sets success message when all namespaces import successfully', async () => {
    mockRegisteredClusters = new Set(['cl']);
    const { result } = renderHook(() => useImportAKSProjects());

    await act(async () =>
      result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))])
    );

    expect(result.current.success).not.toBe('');
    expect(result.current.error).toBe('');
    expect(result.current.importResults![0].success).toBe(true);
  });

  test('sets error message when all imports fail', async () => {
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'denied' });
    const { result } = renderHook(() => useImportAKSProjects());

    await act(async () =>
      result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))])
    );

    expect(result.current.error).toBe('Failed to import any projects.');
    expect(result.current.success).toBe('');
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

    await act(async () =>
      result.current.handleImportClick([makeSelection(makeNamespace('ns-1', 'cl'))])
    );
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
});
