// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Mocks (must be defined before imports that use them) ---
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const t = (key: string, params?: Record<string, any>) => {
    if (!params) return key;
    let result = key;
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
    return result;
  };
  return {
    useTranslation: () => ({ t }),
  };
});

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  PageGrid: ({ children }: any) => <div data-testid="page-grid">{children}</div>,
  SectionBox: ({ children, title }: any) => (
    <div data-testid="section-box" data-title={title}>
      {children}
    </div>
  ),
  Table: ({ data, columns, loading }: any) => (
    <table data-testid="namespace-table" data-loading={loading}>
      <thead>
        <tr>
          {columns.map((c: any, i: number) => (
            <th key={i}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((item: any, i: number) => (
          <tr key={i} data-testid={`row-${item.namespace.name}`}>
            {columns.map((col: any, j: number) => (
              <td key={j}>
                {col.Cell ? col.Cell({ row: { original: item } }) : String(col.accessorFn(item))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const mockUseNamespaceDiscovery = vi.fn();
vi.mock('../../hooks/useNamespaceDiscovery', () => ({
  useNamespaceDiscovery: () => mockUseNamespaceDiscovery(),
}));

const mockUseRegisteredClusters = vi.fn();
vi.mock('../../hooks/useRegisteredClusters', () => ({
  useRegisteredClusters: () => mockUseRegisteredClusters(),
}));

const mockRegisterAKSCluster = vi.fn();
const mockGetSubscriptions = vi
  .fn()
  .mockResolvedValue({ success: true, message: '', subscriptions: [] });
vi.mock('../../utils/azure/aks', () => ({
  registerAKSCluster: (...args: any[]) => mockRegisterAKSCluster(...args),
  getSubscriptions: (...args: any[]) => mockGetSubscriptions(...args),
}));

const mockApplyProjectLabels = vi.fn();
vi.mock('../../utils/kubernetes/namespaceUtils', () => ({
  applyProjectLabels: (...args: any[]) => mockApplyProjectLabels(...args),
}));

const mockSetClusterSettings = vi.fn();
vi.mock('../../utils/shared/clusterSettings', () => ({
  getClusterSettings: () => ({ allowedNamespaces: [] }),
  setClusterSettings: (...args: any[]) => mockSetClusterSettings(...args),
}));

vi.mock('../AzureAuth/AzureAuthGuard', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../AzureCliWarning', () => ({
  default: () => null,
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: any) => <span data-testid={`icon-${icon}`} />,
}));

// Import after mocks
import ImportAKSProjects from './ImportAKSProjects';

function makeDiscoveredNamespace(overrides: Partial<any> = {}) {
  return {
    name: 'test-ns',
    clusterName: 'test-cluster',
    resourceGroup: 'test-rg',
    subscriptionId: 'test-sub',
    labels: null,
    provisioningState: 'Succeeded',
    isAksProject: false,
    isManagedNamespace: true,
    category: 'needs-conversion' as const,
    ...overrides,
  };
}

function defaultDiscoveryReturn(namespaces: any[] = []) {
  return {
    namespaces,
    needsConversion: namespaces.filter((ns: any) => ns.category === 'needs-conversion'),
    needsImport: namespaces.filter((ns: any) => ns.category === 'needs-import'),
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
}

describe('ImportAKSProjects', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockRegisterAKSCluster.mockReset();
    mockGetSubscriptions
      .mockReset()
      .mockResolvedValue({ success: true, message: '', subscriptions: [] });
    mockApplyProjectLabels.mockReset();
    mockSetClusterSettings.mockReset();
    mockUseRegisteredClusters.mockReturnValue(new Set());
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([]));
  });

  afterEach(() => {
    cleanup();
  });

  test('renders namespace table with discovered namespaces', () => {
    const ns1 = makeDiscoveredNamespace({
      name: 'ns1',
      category: 'needs-conversion',
      isAksProject: false,
    });
    const ns2 = makeDiscoveredNamespace({
      name: 'ns2',
      category: 'needs-import',
      isAksProject: true,
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns1, ns2]));

    render(<ImportAKSProjects />);

    expect(screen.getByTestId('row-ns1')).toBeInTheDocument();
    expect(screen.getByTestId('row-ns2')).toBeInTheDocument();
  });

  test('shows loading state while discovering', () => {
    mockUseNamespaceDiscovery.mockReturnValue({
      ...defaultDiscoveryReturn([]),
      loading: true,
    });

    render(<ImportAKSProjects />);

    const table = screen.getByTestId('namespace-table');
    expect(table).toHaveAttribute('data-loading', 'true');
  });

  test('disables import button when no namespace is selected', () => {
    const ns = makeDiscoveredNamespace({ name: 'ns1' });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));

    render(<ImportAKSProjects />);

    // The Import Selected button should be disabled when nothing is selected
    const importButton = screen.getByText('Import Selected Projects').closest('button');
    expect(importButton).toBeDisabled();

    // Select the namespace, then the button should be enabled
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    expect(importButton).not.toBeDisabled();
  });

  test('shows conversion dialog when selected namespaces need conversion', () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      isAksProject: false,
      category: 'needs-conversion',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));

    render(<ImportAKSProjects />);

    // Select the namespace by clicking its checkbox
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected
    fireEvent.click(screen.getByText('Import Selected Projects'));

    // Conversion dialog should appear
    expect(screen.getByText('Convert Namespaces to AKS Projects')).toBeInTheDocument();
  });

  test('skips conversion dialog when all selected are already projects', async () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      isAksProject: true,
      category: 'needs-import',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockRegisterAKSCluster.mockResolvedValue({ success: true });

    render(<ImportAKSProjects />);

    // Select the namespace
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected
    fireEvent.click(screen.getByText('Import Selected Projects'));

    // Conversion dialog should NOT appear
    expect(screen.queryByText('Convert Namespaces to AKS Projects')).not.toBeInTheDocument();

    // Wait for success results to appear
    await waitFor(() => {
      expect(screen.getByText(/successfully imported/)).toBeInTheDocument();
    });
  });

  test('calls applyProjectLabels for namespaces needing conversion', async () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      clusterName: 'cluster-a',
      resourceGroup: 'rg-a',
      subscriptionId: 'sub-a',
      isAksProject: false,
      category: 'needs-conversion',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockApplyProjectLabels.mockResolvedValue(undefined);
    mockRegisterAKSCluster.mockResolvedValue({ success: true });

    render(<ImportAKSProjects />);

    // Select the namespace
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected -- opens the conversion dialog
    fireEvent.click(screen.getByText('Import Selected Projects'));

    // Click Confirm & Import in the dialog
    fireEvent.click(screen.getByText('Confirm & Import'));

    await waitFor(() => {
      expect(mockApplyProjectLabels).toHaveBeenCalledWith({
        namespaceName: 'ns1',
        clusterName: 'cluster-a',
        subscriptionId: 'sub-a',
        resourceGroup: 'rg-a',
      });
    });
  });

  test('handles permission error during label application', async () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      isAksProject: false,
      category: 'needs-conversion',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockRegisterAKSCluster.mockResolvedValue({ success: true });
    mockApplyProjectLabels.mockRejectedValue(new Error('Forbidden'));

    render(<ImportAKSProjects />);

    // Select the namespace
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected -- opens the conversion dialog
    fireEvent.click(screen.getByText('Import Selected Projects'));

    // Click Confirm & Import in the dialog
    fireEvent.click(screen.getByText('Confirm & Import'));

    await waitFor(() => {
      expect(screen.getByText(/Failed to convert namespace/)).toBeInTheDocument();
    });
  });

  test('does not re-register already registered clusters', async () => {
    mockUseRegisteredClusters.mockReturnValue(new Set(['test-cluster']));

    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      clusterName: 'test-cluster',
      isAksProject: true,
      category: 'needs-import',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));

    render(<ImportAKSProjects />);

    // Select the namespace
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected
    fireEvent.click(screen.getByText('Import Selected Projects'));

    await waitFor(() => {
      expect(screen.getByText(/successfully imported/)).toBeInTheDocument();
    });

    expect(mockRegisterAKSCluster).not.toHaveBeenCalled();
  });

  test('select all / deselect all work correctly', () => {
    const ns1 = makeDiscoveredNamespace({ name: 'ns1' });
    const ns2 = makeDiscoveredNamespace({ name: 'ns2' });
    const ns3 = makeDiscoveredNamespace({ name: 'ns3' });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns1, ns2, ns3]));

    render(<ImportAKSProjects />);

    // Click Select All
    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText(/3 selected/)).toBeInTheDocument();

    // Click Deselect All
    fireEvent.click(screen.getByText('Deselect All'));
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
  });

  test('cancel navigates to home', () => {
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([]));

    render(<ImportAKSProjects />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockPush).toHaveBeenCalledWith('/');
  });

  test('displays error when cluster registration fails', async () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      clusterName: 'cluster-a',
      resourceGroup: 'rg-a',
      subscriptionId: 'sub-a',
      isAksProject: false,
      category: 'needs-conversion',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockRegisterAKSCluster.mockResolvedValue({ success: false, message: 'Auth failed' });

    render(<ImportAKSProjects />);

    // Select the namespace
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected -- opens the conversion dialog
    fireEvent.click(screen.getByText('Import Selected Projects'));
    fireEvent.click(screen.getByText('Confirm & Import'));

    await waitFor(() => {
      expect(screen.getByText(/Auth failed/)).toBeInTheDocument();
    });
  });

  test('does not create allowedNamespaces restriction when none existed (#489)', async () => {
    const ns = makeDiscoveredNamespace({
      name: 'ns1',
      clusterName: 'test-cluster',
      isAksProject: true,
      category: 'needs-import',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockRegisterAKSCluster.mockResolvedValue({ success: true });

    render(<ImportAKSProjects />);

    // Select the namespace
    const row = screen.getByTestId('row-ns1');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected (already a project, no conversion dialog)
    fireEvent.click(screen.getByText('Import Selected Projects'));

    // Wait for import to finish
    await waitFor(() => {
      expect(screen.getByText('Go To Projects')).toBeInTheDocument();
    });

    // When allowedNamespaces was empty, setClusterSettings should NOT be called
    // to avoid hiding all other projects (see #489)
    expect(mockSetClusterSettings).not.toHaveBeenCalled();
  });

  test('appends to allowedNamespaces when restriction already exists', async () => {
    // Override the mock to return a non-empty allowedNamespaces
    vi.mocked(mockSetClusterSettings).mockClear();
    const clusterSettingsMod = await import('../../utils/shared/clusterSettings');
    vi.spyOn(clusterSettingsMod, 'getClusterSettings').mockReturnValue({
      allowedNamespaces: ['existing-ns'],
    });

    const ns = makeDiscoveredNamespace({
      name: 'new-ns',
      clusterName: 'test-cluster',
      isAksProject: true,
      category: 'needs-import',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
    mockRegisterAKSCluster.mockResolvedValue({ success: true });

    render(<ImportAKSProjects />);

    // Select the namespace
    const row = screen.getByTestId('row-new-ns');
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Click Import Selected (already a project, no conversion dialog)
    fireEvent.click(screen.getByText('Import Selected Projects'));

    await waitFor(() => {
      expect(screen.getByText('Go To Projects')).toBeInTheDocument();
    });

    // When allowedNamespaces was non-empty, setClusterSettings should be called
    // with the union of existing and imported namespaces
    expect(mockSetClusterSettings).toHaveBeenCalledWith('test-cluster', {
      allowedNamespaces: ['existing-ns', 'new-ns'],
    });

    // Clean up spy
    vi.restoreAllMocks();
  });

  test('handles mixed results with some successes and some failures', async () => {
    const ns1 = makeDiscoveredNamespace({
      name: 'ns-ok',
      clusterName: 'cluster-a',
      resourceGroup: 'rg-a',
      subscriptionId: 'sub-a',
      isAksProject: false,
      category: 'needs-conversion',
    });
    const ns2 = makeDiscoveredNamespace({
      name: 'ns-fail',
      clusterName: 'cluster-a',
      resourceGroup: 'rg-a',
      subscriptionId: 'sub-a',
      isAksProject: false,
      category: 'needs-conversion',
    });
    mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns1, ns2]));
    mockRegisterAKSCluster.mockResolvedValue({ success: true });
    mockApplyProjectLabels
      .mockResolvedValueOnce(undefined) // ns-ok succeeds
      .mockRejectedValueOnce(new Error('Forbidden')); // ns-fail fails

    render(<ImportAKSProjects />);

    // Select all namespaces
    fireEvent.click(screen.getByText('Select All'));

    // Click Import Selected -- opens the conversion dialog
    fireEvent.click(screen.getByText('Import Selected Projects'));
    fireEvent.click(screen.getByText('Confirm & Import'));

    await waitFor(() => {
      // Should show both success and error results
      expect(screen.getByText(/converted and imported/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to convert namespace/)).toBeInTheDocument();
  });

  test('Go To Projects button navigates via history.replace and reloads', async () => {
    const reloadMock = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadMock });

    try {
      const ns = makeDiscoveredNamespace({
        name: 'ns-ok',
        clusterName: 'cluster-a',
        resourceGroup: 'rg-a',
        subscriptionId: 'sub-a',
        isAksProject: true,
        category: 'needs-import',
      });
      mockUseNamespaceDiscovery.mockReturnValue(defaultDiscoveryReturn([ns]));
      mockRegisterAKSCluster.mockResolvedValue({ success: true });

      render(<ImportAKSProjects />);

      // Select the namespace
      const row = screen.getByTestId('row-ns-ok');
      const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(checkbox);

      // Click Import Selected (already a project, no conversion dialog)
      fireEvent.click(screen.getByText('Import Selected Projects'));

      await waitFor(() => {
        expect(screen.getByText('Go To Projects')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Go To Projects'));

      expect(mockReplace).toHaveBeenCalledWith('/');
      expect(reloadMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
