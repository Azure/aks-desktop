// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const t = (key: string) => key;
  return {
    useTranslation: () => ({ t }),
  };
});

import { ConversionDialog } from './ConversionDialog';

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  namespacesToConvert: [
    { name: 'ns-alpha', clusterName: 'cluster-1', isManagedNamespace: true },
    { name: 'ns-beta', clusterName: 'cluster-2', isManagedNamespace: true },
  ],
  namespacesToImport: [] as { name: string; clusterName: string; isManagedNamespace: boolean }[],
  converting: false,
};

describe('ConversionDialog', () => {
  afterEach(() => {
    cleanup();
  });

  test('renders with correct title', () => {
    render(<ConversionDialog {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Convert Namespaces to AKS Projects')).toBeInTheDocument();
  });

  test('displays all 4 labels when managed namespaces are present', () => {
    render(<ConversionDialog {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    const labelTexts = [
      'headlamp.dev/project-id: <namespace-name>',
      'headlamp.dev/project-managed-by: aks-desktop',
      'aks-desktop/project-subscription: <subscription-id> (managed namespaces only)',
      'aks-desktop/project-resource-group: <resource-group> (managed namespaces only)',
    ];
    for (const text of labelTexts) {
      expect(
        within(dialog).getByText((_, el) => el?.tagName === 'DIV' && el?.textContent === text)
      ).toBeInTheDocument();
    }
  });

  test('displays only 2 core labels when no managed namespaces are present', () => {
    render(
      <ConversionDialog
        {...defaultProps}
        namespacesToConvert={[
          { name: 'ns-regular', clusterName: 'cluster-1', isManagedNamespace: false },
        ]}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(
        (_, el) =>
          el?.tagName === 'DIV' && el?.textContent === 'headlamp.dev/project-id: <namespace-name>'
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        (_, el) =>
          el?.tagName === 'DIV' &&
          el?.textContent === 'headlamp.dev/project-managed-by: aks-desktop'
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        (_, el) =>
          el?.tagName === 'DIV' && el?.textContent?.includes('aks-desktop/project-subscription')
      )
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        (_, el) =>
          el?.tagName === 'DIV' && el?.textContent?.includes('aks-desktop/project-resource-group')
      )
    ).not.toBeInTheDocument();
  });

  test('displays all 4 labels when mix of managed and regular namespaces', () => {
    render(
      <ConversionDialog
        {...defaultProps}
        namespacesToConvert={[
          { name: 'ns-managed', clusterName: 'cluster-1', isManagedNamespace: true },
          { name: 'ns-regular', clusterName: 'cluster-2', isManagedNamespace: false },
        ]}
      />
    );

    const dialog = screen.getByRole('dialog');
    const labelTexts = [
      'headlamp.dev/project-id: <namespace-name>',
      'headlamp.dev/project-managed-by: aks-desktop',
      'aks-desktop/project-subscription: <subscription-id> (managed namespaces only)',
      'aks-desktop/project-resource-group: <resource-group> (managed namespaces only)',
    ];
    for (const text of labelTexts) {
      expect(
        within(dialog).getByText((_, el) => el?.tagName === 'DIV' && el?.textContent === text)
      ).toBeInTheDocument();
    }
  });

  test('lists namespaces to convert', () => {
    render(<ConversionDialog {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Namespaces to convert:')).toBeInTheDocument();
    expect(within(dialog).getByText('ns-alpha')).toBeInTheDocument();
    expect(within(dialog).getByText('ns-beta')).toBeInTheDocument();
  });

  test('lists namespaces to import when provided', () => {
    render(
      <ConversionDialog
        {...defaultProps}
        namespacesToImport={[
          { name: 'ns-existing', clusterName: 'cluster-3', isManagedNamespace: true },
        ]}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Already AKS projects (will import directly):')
    ).toBeInTheDocument();
    expect(within(dialog).getByText('ns-existing')).toBeInTheDocument();
  });

  test('does not show import section when namespacesToImport is empty', () => {
    render(<ConversionDialog {...defaultProps} namespacesToImport={[]} />);

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).queryByText('Already AKS projects (will import directly):')
    ).not.toBeInTheDocument();
  });

  test('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(<ConversionDialog {...defaultProps} onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Confirm button calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConversionDialog {...defaultProps} onConfirm={onConfirm} />);

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Confirm & Import'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('buttons are disabled when converting', () => {
    render(<ConversionDialog {...defaultProps} converting />);

    const dialog = screen.getByRole('dialog');
    const cancelButton = within(dialog).getByText('Cancel').closest('button');
    const convertingButton = within(dialog).getByText('Converting...').closest('button');

    expect(cancelButton).toBeDisabled();
    expect(convertingButton).toBeDisabled();
  });

  test('shows "Converting..." text and hides "Confirm & Import" when converting', () => {
    render(<ConversionDialog {...defaultProps} converting />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Converting...')).toBeInTheDocument();
    expect(within(dialog).queryByText('Confirm & Import')).not.toBeInTheDocument();
  });

  test('dialog is not accessible when open is false', () => {
    render(<ConversionDialog {...defaultProps} open={false} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
