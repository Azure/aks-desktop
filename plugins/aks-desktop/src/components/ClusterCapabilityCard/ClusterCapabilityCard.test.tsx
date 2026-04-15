// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ClusterCapabilities } from '../../types/ClusterCapabilities';

// Mock K8s.ResourceClasses.Namespace.useGet
const mockUseGet = vi.fn();
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Namespace: {
        useGet: (...args: any[]) => mockUseGet(...args),
      },
    },
  },
}));

// Mock useClusterCapabilities hook
const mockFetchCapabilities = vi.fn();
const mockUseClusterCapabilities = vi.fn();
vi.mock('../CreateAKSProject/hooks/useClusterCapabilities', () => ({
  useClusterCapabilities: () => mockUseClusterCapabilities(),
}));

// Mock ClusterConfigurePanel
vi.mock('../CreateAKSProject/components/ClusterConfigurePanel', () => ({
  ClusterConfigurePanel: (props: any) => (
    <div data-testid="cluster-configure-panel" data-cluster={props.clusterName} />
  ),
}));

import ClusterCapabilityCard from './ClusterCapabilityCard';

function makeCapabilities(overrides: Partial<ClusterCapabilities> = {}): ClusterCapabilities {
  return {
    sku: 'Automatic',
    aadEnabled: true,
    azureRbacEnabled: true,
    networkPolicy: 'cilium',
    networkPlugin: 'azure',
    prometheusEnabled: true,
    containerInsightsEnabled: true,
    kedaEnabled: true,
    vpaEnabled: true,
    ...overrides,
  };
}

const defaultProject = {
  namespaces: ['test-namespace'],
  clusters: ['test-cluster'],
};

describe('ClusterCapabilityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: namespace with labels
    mockUseGet.mockReturnValue([
      {
        jsonData: {
          metadata: {
            labels: {
              'aks-desktop/project-subscription': 'test-sub',
              'aks-desktop/project-resource-group': 'test-rg',
            },
          },
        },
      },
    ]);

    // Default: no capabilities yet
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: null,
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test('renders nothing while loading', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: null,
      loading: true,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    const { container } = render(<ClusterCapabilityCard project={defaultProject} />);
    expect(container.innerHTML).toBe('');
  });

  test('renders nothing when capabilities are null and not loading', () => {
    const { container } = render(<ClusterCapabilityCard project={defaultProject} />);
    expect(container.innerHTML).toBe('');
  });

  test('renders nothing when all capabilities are met', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities(),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    const { container } = render(<ClusterCapabilityCard project={defaultProject} />);
    expect(container.innerHTML).toBe('');
  });

  test('renders error alert when capability check fails', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: null,
      loading: false,
      error: 'Some error',
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(screen.getByText('Cluster Configuration')).toBeTruthy();
    expect(screen.getByText(/Unable to check cluster capabilities/)).toBeTruthy();
  });

  test('renders Azure RBAC warning when not enabled', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ azureRbacEnabled: false }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(screen.getByText(/Azure RBAC for Kubernetes is not enabled/)).toBeTruthy();
  });

  test('renders network policy warning when none configured', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ networkPolicy: 'none' }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(screen.getByText(/No network policy engine configured/)).toBeTruthy();
  });

  test('renders Prometheus warning when not enabled', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ prometheusEnabled: false }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(screen.getByText(/Managed Prometheus is not enabled/)).toBeTruthy();
  });

  test('renders KEDA and VPA warning when both disabled', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ kedaEnabled: false, vpaEnabled: false }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(
      screen.getByText(/KEDA and VPA are not enabled\. Autoscaling features will be limited/)
    ).toBeTruthy();
  });

  test('renders KEDA-only warning when only KEDA is disabled', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ kedaEnabled: false, vpaEnabled: true }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(
      screen.getByText(/KEDA is not enabled\. Event-driven autoscaling will be unavailable/)
    ).toBeTruthy();
  });

  test('renders VPA-only warning when only VPA is disabled', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ vpaEnabled: false, kedaEnabled: true }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(
      screen.getByText(/VPA is not enabled\. Vertical pod autoscaling will be unavailable/)
    ).toBeTruthy();
  });

  test('renders ClusterConfigurePanel when addons are missing', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ prometheusEnabled: false }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(screen.getByTestId('cluster-configure-panel')).toBeTruthy();
  });

  test('does not render ClusterConfigurePanel when only non-configurable issues exist', () => {
    mockUseClusterCapabilities.mockReturnValue({
      capabilities: makeCapabilities({ azureRbacEnabled: false }),
      loading: false,
      error: null,
      fetchCapabilities: mockFetchCapabilities,
    });

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(screen.queryByTestId('cluster-configure-panel')).toBeNull();
  });

  test('calls fetchCapabilities with correct params on mount', () => {
    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(mockFetchCapabilities).toHaveBeenCalledWith('test-sub', 'test-rg', 'test-cluster');
  });

  test('does not call fetchCapabilities when namespace labels are missing', () => {
    mockUseGet.mockReturnValue([
      {
        jsonData: {
          metadata: {
            labels: {},
          },
        },
      },
    ]);

    render(<ClusterCapabilityCard project={defaultProject} />);

    expect(mockFetchCapabilities).not.toHaveBeenCalled();
  });
});
