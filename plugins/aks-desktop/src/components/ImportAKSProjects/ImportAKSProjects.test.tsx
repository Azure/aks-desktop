// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
  // Minimal Table mock: renders rows and exposes renderRowSelectionToolbar via a toolbar slot
  Table: ({ data, columns, loading, renderRowSelectionToolbar, enableRowSelection }: any) => {
    const [selected, setSelected] = React.useState<Set<number>>(new Set());

    const fakeTable = {
      getSelectedRowModel: () => ({
        rows: Array.from(selected).map(i => ({ original: data[i] })),
      }),
    };

    return (
      <div>
        <div data-testid="table-toolbar">
          {renderRowSelectionToolbar && renderRowSelectionToolbar({ table: fakeTable })}
        </div>
        <table data-testid="namespace-table" data-loading={loading}>
          <thead>
            <tr>
              {enableRowSelection && <th />}
              {columns.map((c: any, i: number) => (
                <th key={i}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((item: any, i: number) => (
              <tr key={i} data-testid={`row-${item.name}`}>
                {enableRowSelection && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        setSelected(next);
                      }}
                    />
                  </td>
                )}
                {columns.map((col: any, j: number) => (
                  <td key={j}>
                    {col.Cell
                      ? col.Cell({ row: { original: item } })
                      : String(col.accessorFn(item))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
}));

vi.mock('../AzureAuth/AzureAuthGuard', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: any) => <span data-testid={`icon-${icon}`} />,
}));

// Mock the hook so component tests focus purely on rendering/wiring
const mockHandleImportClick = vi.fn();
const mockHandleConversionClose = vi.fn();
const mockHandleConversionConfirm = vi.fn();
const mockHandleGoToProjects = vi.fn();
const mockRefresh = vi.fn();
const mockClearError = vi.fn();
const mockClearSuccess = vi.fn();
const mockClearDiscoveryError = vi.fn();

let mockHookReturn: any;

vi.mock('./hooks/useImportAKSProjects', () => ({
  useImportAKSProjects: () => mockHookReturn,
}));

// Import after mocks
import type { DiscoveredNamespace } from '../../hooks/useNamespaceDiscovery';
import ImportAKSProjects from './ImportAKSProjects';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNs(overrides: Partial<DiscoveredNamespace> = {}): DiscoveredNamespace {
  return {
    name: 'test-ns',
    clusterName: 'test-cluster',
    resourceGroup: 'test-rg',
    subscriptionId: 'test-sub',
    labels: {},
    provisioningState: 'Succeeded',
    isAksProject: true,
    isManagedNamespace: true,
    category: 'needs-import',
    ...overrides,
  };
}

function defaultHookReturn(overrides: Partial<any> = {}) {
  return {
    error: '',
    success: '',
    namespaces: [],
    loadingNamespaces: false,
    discoveryError: null,
    importing: false,
    importResults: undefined,
    showConversionDialog: false,
    namespacesToConvert: [],
    namespacesToImport: [],
    refresh: mockRefresh,
    clearError: mockClearError,
    clearSuccess: mockClearSuccess,
    clearDiscoveryError: mockClearDiscoveryError,
    handleImportClick: mockHandleImportClick,
    handleConversionConfirm: mockHandleConversionConfirm,
    handleConversionClose: mockHandleConversionClose,
    handleGoToProjects: mockHandleGoToProjects,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportAKSProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookReturn = defaultHookReturn();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  test('renders namespace table with discovered namespaces', () => {
    mockHookReturn = defaultHookReturn({
      namespaces: [makeNs({ name: 'ns1' }), makeNs({ name: 'ns2' })],
    });

    render(<ImportAKSProjects />);

    expect(screen.getByTestId('row-ns1')).toBeInTheDocument();
    expect(screen.getByTestId('row-ns2')).toBeInTheDocument();
  });

  test('passes loading state to table', () => {
    mockHookReturn = defaultHookReturn({ loadingNamespaces: true });

    render(<ImportAKSProjects />);

    expect(screen.getByTestId('namespace-table')).toHaveAttribute('data-loading', 'true');
  });

  test('shows error alert for import error', () => {
    mockHookReturn = defaultHookReturn({ error: 'Something went wrong' });

    render(<ImportAKSProjects />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  test('shows error alert for discovery error', () => {
    mockHookReturn = defaultHookReturn({ discoveryError: 'Discovery failed' });

    render(<ImportAKSProjects />);

    expect(screen.getByText('Discovery failed')).toBeInTheDocument();
  });

  test('shows success alert', () => {
    mockHookReturn = defaultHookReturn({ success: 'Import complete' });

    render(<ImportAKSProjects />);

    expect(screen.getByText('Import complete')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Table toolbar — Import button wiring
  // -------------------------------------------------------------------------

  test('calls handleImportClick with selected namespaces when Import is clicked', () => {
    const ns = makeNs({ name: 'ns1' });
    mockHookReturn = defaultHookReturn({ namespaces: [ns] });

    render(<ImportAKSProjects />);

    // Select the row via the table mock checkbox
    const checkbox = screen.getByTestId('row-ns1').querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByText('Import Selected Projects'));

    expect(mockHandleImportClick).toHaveBeenCalledWith([{ namespace: ns }]);
  });

  test('calls refresh when Refresh button is clicked', () => {
    render(<ImportAKSProjects />);

    fireEvent.click(screen.getByText('Refresh'));

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  test('disables Refresh button while importing', () => {
    mockHookReturn = defaultHookReturn({ importing: true });

    render(<ImportAKSProjects />);

    expect(screen.getByText('Refresh').closest('button')).toBeDisabled();
  });

  test('disables Import button while importing', () => {
    mockHookReturn = defaultHookReturn({ importing: true });

    render(<ImportAKSProjects />);

    expect(screen.getByText(/Importing/).closest('button')).toBeDisabled();
  });

  test('disables Import button while namespaces are loading', () => {
    mockHookReturn = defaultHookReturn({ loadingNamespaces: true });

    render(<ImportAKSProjects />);

    expect(screen.getByText('Import Selected Projects').closest('button')).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // Table / results visibility
  // -------------------------------------------------------------------------

  test('hides table and shows results when all imports succeed', () => {
    mockHookReturn = defaultHookReturn({
      importResults: [
        { namespace: 'ns1 (cluster-a)', clusterName: 'cluster-a', success: true, message: 'ok' },
      ],
    });

    render(<ImportAKSProjects />);

    expect(screen.queryByTestId('namespace-table')).not.toBeInTheDocument();
    expect(screen.getByText(/ns1 \(cluster-a\)/)).toBeInTheDocument();
  });

  test('keeps table visible when all imports fail (allows retry)', () => {
    mockHookReturn = defaultHookReturn({
      importResults: [
        {
          namespace: 'ns1 (cluster-a)',
          clusterName: 'cluster-a',
          success: false,
          message: 'auth error',
        },
      ],
    });

    render(<ImportAKSProjects />);

    expect(screen.getByTestId('namespace-table')).toBeInTheDocument();
  });

  test('shows Go To Projects button when some imports succeed', () => {
    mockHookReturn = defaultHookReturn({
      importResults: [{ namespace: 'ns1 (cl)', clusterName: 'cl', success: true, message: 'ok' }],
    });

    render(<ImportAKSProjects />);

    expect(screen.getByText('Go To Projects')).toBeInTheDocument();
  });

  test('hides Go To Projects button when all imports fail', () => {
    mockHookReturn = defaultHookReturn({
      importResults: [{ namespace: 'ns1 (cl)', clusterName: 'cl', success: false, message: 'err' }],
    });

    render(<ImportAKSProjects />);

    expect(screen.queryByText('Go To Projects')).not.toBeInTheDocument();
  });

  test('calls handleGoToProjects when Go To Projects is clicked', () => {
    mockHookReturn = defaultHookReturn({
      importResults: [{ namespace: 'ns1 (cl)', clusterName: 'cl', success: true, message: 'ok' }],
    });

    render(<ImportAKSProjects />);
    fireEvent.click(screen.getByText('Go To Projects'));

    expect(mockHandleGoToProjects).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // ConversionDialog wiring
  // -------------------------------------------------------------------------

  test('shows ConversionDialog when showConversionDialog is true', () => {
    mockHookReturn = defaultHookReturn({
      showConversionDialog: true,
      namespacesToConvert: [makeNs({ name: 'ns-convert', isAksProject: false })],
      namespacesToImport: [],
    });

    render(<ImportAKSProjects />);

    expect(screen.getByText('Convert Namespaces to AKS Projects')).toBeInTheDocument();
  });

  test('calls handleConversionClose when Cancel is clicked in dialog', () => {
    mockHookReturn = defaultHookReturn({
      showConversionDialog: true,
      namespacesToConvert: [makeNs({ name: 'ns-convert', isAksProject: false })],
      namespacesToImport: [],
    });

    render(<ImportAKSProjects />);
    // The dialog Cancel button (not the table toolbar)
    const cancelButtons = screen.getAllByText('Cancel');
    fireEvent.click(cancelButtons[0]);

    expect(mockHandleConversionClose).toHaveBeenCalledTimes(1);
  });

  test('calls handleConversionConfirm when Confirm & Import is clicked in dialog', () => {
    mockHookReturn = defaultHookReturn({
      showConversionDialog: true,
      namespacesToConvert: [makeNs({ name: 'ns-convert', isAksProject: false })],
      namespacesToImport: [],
    });

    render(<ImportAKSProjects />);
    fireEvent.click(screen.getByText('Confirm & Import'));

    expect(mockHandleConversionConfirm).toHaveBeenCalledTimes(1);
  });
});
