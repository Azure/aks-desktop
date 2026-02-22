// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ClusterCapabilities } from '../../../../types/ClusterCapabilities';

// Mock the az-cli functions
vi.mock('../../../../utils/azure/az-cli', () => ({
  enableClusterAddon: vi.fn(),
  getClusterCapabilities: vi.fn(),
}));

import { enableClusterAddon, getClusterCapabilities } from '../../../../utils/azure/az-cli';
import { ClusterConfigurePanel } from '../ClusterConfigurePanel';

const mockEnableClusterAddon = vi.mocked(enableClusterAddon);
const mockGetClusterCapabilities = vi.mocked(getClusterCapabilities);

const defaultProps = {
  subscriptionId: 'test-sub-id',
  resourceGroup: 'test-rg',
  clusterName: 'test-cluster',
  onConfigured: vi.fn(),
};

function makeCapabilities(overrides: Partial<ClusterCapabilities> = {}): ClusterCapabilities {
  return {
    sku: 'Base',
    aadEnabled: true,
    azureRbacEnabled: true,
    networkPolicy: 'none',
    networkPlugin: 'azure',
    prometheusEnabled: false,
    containerInsightsEnabled: false,
    kedaEnabled: false,
    vpaEnabled: false,
    ...overrides,
  };
}

describe('ClusterConfigurePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockEnableClusterAddon.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  test('renders addon list based on capabilities', () => {
    const capabilities = makeCapabilities({
      prometheusEnabled: false,
      kedaEnabled: false,
      vpaEnabled: true,
    });

    render(<ClusterConfigurePanel {...defaultProps} capabilities={capabilities} />);

    // Prometheus and KEDA should be listed as missing addons with checkboxes
    expect(screen.getByText('Azure Monitor Metrics (Managed Prometheus)')).toBeTruthy();
    expect(screen.getByText('KEDA (Event-Driven Autoscaling)')).toBeTruthy();

    // VPA is already enabled, so it should NOT appear as a checkbox option
    expect(screen.queryByText('VPA (Vertical Pod Autoscaler)')).toBeNull();
  });

  test('does not show network policy as configurable', () => {
    const capabilities = makeCapabilities({
      networkPolicy: 'none',
      prometheusEnabled: false,
    });

    render(<ClusterConfigurePanel {...defaultProps} capabilities={capabilities} />);

    // Should show an info message about network policy (MUI Alert may render text in multiple nodes)
    const networkPolicyMessages = screen.queryAllByText(
      /Network policy engine cannot be changed after cluster creation/
    );
    expect(networkPolicyMessages.length).toBeGreaterThan(0);

    // Should NOT have a checkbox for network policy
    const checkboxes = screen.getAllByRole('checkbox');
    const labels = checkboxes.map(cb => {
      const label = cb.closest('label');
      return label?.textContent || '';
    });
    const hasNetworkPolicyCheckbox = labels.some(l => l.toLowerCase().includes('network policy'));
    expect(hasNetworkPolicyCheckbox).toBe(false);
  });

  test('returns null when all addons enabled and no network policy warning', () => {
    const capabilities = makeCapabilities({
      prometheusEnabled: true,
      kedaEnabled: true,
      vpaEnabled: true,
      networkPolicy: 'cilium',
    });

    const { container } = render(
      <ClusterConfigurePanel {...defaultProps} capabilities={capabilities} />
    );

    // Component should render nothing
    expect(container.innerHTML).toBe('');
  });

  test('calls enableClusterAddon for each selected addon', async () => {
    const capabilities = makeCapabilities({
      prometheusEnabled: false,
      kedaEnabled: false,
      vpaEnabled: true,
      networkPolicy: 'cilium',
    });

    // After enabling, return capabilities with all enabled so polling completes
    mockGetClusterCapabilities.mockResolvedValue(
      makeCapabilities({
        prometheusEnabled: true,
        kedaEnabled: true,
        vpaEnabled: true,
        networkPolicy: 'cilium',
      })
    );

    render(<ClusterConfigurePanel {...defaultProps} capabilities={capabilities} />);

    // Both Prometheus and KEDA checkboxes should be pre-selected (they're missing)
    const configureButtons = screen.getAllByRole('button', { name: /Configure Cluster/i });
    fireEvent.click(configureButtons[0]);

    await waitFor(() => {
      expect(mockEnableClusterAddon).toHaveBeenCalledTimes(2);
    });

    // Verify each addon was called with the correct parameters
    expect(mockEnableClusterAddon).toHaveBeenCalledWith({
      subscriptionId: 'test-sub-id',
      resourceGroup: 'test-rg',
      clusterName: 'test-cluster',
      addon: 'azure-monitor-metrics',
    });
    expect(mockEnableClusterAddon).toHaveBeenCalledWith({
      subscriptionId: 'test-sub-id',
      resourceGroup: 'test-rg',
      clusterName: 'test-cluster',
      addon: 'keda',
    });
  });

  test('shows loading state during configuration', async () => {
    const capabilities = makeCapabilities({
      prometheusEnabled: false,
      kedaEnabled: true,
      vpaEnabled: true,
      networkPolicy: 'cilium',
    });

    // First poll returns not-yet-enabled, so polling continues and shows progress
    mockGetClusterCapabilities.mockResolvedValue(
      makeCapabilities({
        prometheusEnabled: false,
        kedaEnabled: true,
        vpaEnabled: true,
        networkPolicy: 'cilium',
      })
    );

    render(<ClusterConfigurePanel {...defaultProps} capabilities={capabilities} />);

    // MUI may render duplicate button elements in jsdom
    const configureButtons = screen.getAllByRole('button', { name: /Configure Cluster/i });
    fireEvent.click(configureButtons[0]);

    // After enabling completes, polling starts and shows progress indicator
    await waitFor(() => {
      const configuringMessages = screen.queryAllByText(/Configuring cluster/i);
      expect(configuringMessages.length).toBeGreaterThan(0);
    });

    // Should show a progress indicator (CircularProgress renders role="progressbar")
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
  });

  test('calls onConfigured callback after successful configuration and polling', async () => {
    const onConfigured = vi.fn();

    const capabilities = makeCapabilities({
      prometheusEnabled: false,
      kedaEnabled: true,
      vpaEnabled: true,
      networkPolicy: 'cilium',
    });

    // First poll: addon is now enabled
    mockGetClusterCapabilities.mockResolvedValue(
      makeCapabilities({
        prometheusEnabled: true,
        kedaEnabled: true,
        vpaEnabled: true,
        networkPolicy: 'cilium',
      })
    );

    const { container } = render(
      <ClusterConfigurePanel
        {...defaultProps}
        capabilities={capabilities}
        onConfigured={onConfigured}
      />
    );

    // Use container-scoped query to avoid test leakage from previous renders
    const configureButton = container.querySelector('button:not([disabled])') as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(configureButton);
    });

    // Flush async enabling and polling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(onConfigured).toHaveBeenCalledTimes(1);

    // Success message should also appear (MUI Alert may render text in multiple nodes)
    const completeMessages = screen.queryAllByText(/Configuration Complete/i);
    expect(completeMessages.length).toBeGreaterThan(0);
    const successMessages = screen.queryAllByText(
      /All selected addons have been enabled successfully/i
    );
    expect(successMessages.length).toBeGreaterThan(0);
  });

  test('shows cost warning', () => {
    const capabilities = makeCapabilities({
      prometheusEnabled: false,
    });

    render(<ClusterConfigurePanel {...defaultProps} capabilities={capabilities} />);

    // MUI may render text in multiple DOM nodes
    const costWarnings = screen.queryAllByText(
      /Enabling these addons may incur additional Azure costs/i
    );
    expect(costWarnings.length).toBeGreaterThan(0);
  });

  test('resets state when cluster changes after successful configuration', async () => {
    const onConfigured = vi.fn();

    // First cluster: only prometheus is missing
    const cluster1Capabilities = makeCapabilities({
      prometheusEnabled: false,
      kedaEnabled: true,
      vpaEnabled: true,
      networkPolicy: 'cilium',
    });

    // After enabling, first cluster reports all enabled
    mockGetClusterCapabilities.mockResolvedValue(
      makeCapabilities({
        prometheusEnabled: true,
        kedaEnabled: true,
        vpaEnabled: true,
        networkPolicy: 'cilium',
      })
    );

    const { rerender } = render(
      <ClusterConfigurePanel
        {...defaultProps}
        clusterName="cluster-one"
        capabilities={cluster1Capabilities}
        onConfigured={onConfigured}
      />
    );

    // Verify the first cluster's missing addon checkbox is shown
    expect(screen.getByText('Azure Monitor Metrics (Managed Prometheus)')).toBeTruthy();

    // Click configure and wait for success
    const configureButton = screen.getAllByRole('button', { name: /Configure Cluster/i })[0];
    await act(async () => {
      fireEvent.click(configureButton);
    });

    // Flush async enabling and polling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    // Verify success state is showing
    const completeMessages = screen.queryAllByText(/Configuration Complete/i);
    expect(completeMessages.length).toBeGreaterThan(0);

    // Configure button should be hidden on success
    expect(screen.queryByRole('button', { name: /Configure Cluster/i })).toBeNull();

    // Now switch to a different cluster with different missing addons
    const cluster2Capabilities = makeCapabilities({
      prometheusEnabled: true,
      kedaEnabled: false,
      vpaEnabled: false,
      networkPolicy: 'cilium',
    });

    await act(async () => {
      rerender(
        <ClusterConfigurePanel
          {...defaultProps}
          clusterName="cluster-two"
          capabilities={cluster2Capabilities}
          onConfigured={onConfigured}
        />
      );
    });

    // Success message should be gone
    expect(screen.queryByText(/Configuration Complete/i)).toBeNull();

    // New cluster's missing addons should be shown as checkboxes
    expect(screen.getByText('KEDA (Event-Driven Autoscaling)')).toBeTruthy();
    expect(screen.getByText('VPA (Vertical Pod Autoscaler)')).toBeTruthy();

    // Prometheus should NOT be shown (it's already enabled on cluster-two)
    expect(screen.queryByText('Azure Monitor Metrics (Managed Prometheus)')).toBeNull();

    // Configure button should be visible again
    const newConfigureButtons = screen.getAllByRole('button', { name: /Configure Cluster/i });
    expect(newConfigureButtons.length).toBeGreaterThan(0);
  });
});
