// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => ({ trackFeature: vi.fn() }));
const dialogMocks = vi.hoisted(() => ({
  open: false,
  initialApplicationName: undefined as string | undefined,
  openDialog: vi.fn(),
  closeDialog: vi.fn(),
}));
const deployUrlState = vi.hoisted(() => ({
  shouldOpenDialog: false,
  initialApplicationName: undefined as string | undefined,
  clearUrlTrigger: vi.fn(),
}));
const azureHookMocks = vi.hoisted(() => ({
  useAzureContext: vi.fn(),
  useNamespaceCapabilities: vi.fn(),
}));
const deployWizardMocks = vi.hoisted(() => ({ render: vi.fn() }));

vi.mock('../../telemetry', () => telemetryMocks);
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useAzureContext', () => ({
  useAzureContext: azureHookMocks.useAzureContext,
}));
vi.mock('../../hooks/useNamespaceCapabilities', () => ({
  useNamespaceCapabilities: azureHookMocks.useNamespaceCapabilities,
}));
vi.mock('../DeployWizard/DeployWizard', () => ({
  default: (props: Record<string, unknown>) => {
    deployWizardMocks.render(props);
    return <div>Deploy wizard</div>;
  },
}));
vi.mock('./hooks/useDeployUrlParams', () => ({
  useDeployUrlParams: () => ({
    shouldOpenDialog: deployUrlState.shouldOpenDialog,
    initialApplicationName: deployUrlState.initialApplicationName,
    clearUrlTrigger: deployUrlState.clearUrlTrigger,
  }),
}));
vi.mock('./hooks/useDialogState', () => ({
  useDialogState: () => ({
    open: dialogMocks.open,
    initialApplicationName: dialogMocks.initialApplicationName,
    openDialog: dialogMocks.openDialog,
    closeDialog: dialogMocks.closeDialog,
  }),
}));

import DeployButton from './DeployButton';

describe('DeployButton telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deployUrlState.shouldOpenDialog = false;
    deployUrlState.initialApplicationName = undefined;
    dialogMocks.open = false;
    dialogMocks.initialApplicationName = undefined;
    azureHookMocks.useAzureContext.mockReturnValue({ azureContext: null, error: null });
    azureHookMocks.useNamespaceCapabilities.mockReturnValue({
      isManagedNamespace: false,
      azureRbacEnabled: false,
    });
  });

  afterEach(() => cleanup());

  it('does not resolve Azure context while the deploy dialog is closed', () => {
    render(<DeployButton project={{ id: 'project', clusters: ['cluster-1'], namespaces: [] }} />);

    expect(azureHookMocks.useAzureContext).not.toHaveBeenCalled();
    expect(azureHookMocks.useNamespaceCapabilities).not.toHaveBeenCalled();
  });

  it('reports the deploy workflow opening from the user action', () => {
    render(<DeployButton project={{ id: 'project', clusters: [], namespaces: [] }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deploy Application' }));

    expect(telemetryMocks.trackFeature).toHaveBeenCalledWith({
      feature: 'aksd.deploy',
      status: 'opened',
    });
    expect(dialogMocks.openDialog).toHaveBeenCalledOnce();
  });

  it('still opens the dialog when telemetry throws', () => {
    telemetryMocks.trackFeature.mockImplementationOnce(() => {
      throw new Error('telemetry unavailable');
    });
    render(<DeployButton project={{ id: 'project', clusters: [], namespaces: [] }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deploy Application' }));

    expect(dialogMocks.openDialog).toHaveBeenCalledOnce();
  });

  it('reports a URL-triggered deploy opening once across rerenders', () => {
    deployUrlState.shouldOpenDialog = true;
    deployUrlState.initialApplicationName = 'synthetic-app';
    const { rerender } = render(
      <DeployButton project={{ id: 'project', clusters: [], namespaces: [] }} />
    );

    expect(telemetryMocks.trackFeature).toHaveBeenCalledTimes(1);
    expect(dialogMocks.openDialog).toHaveBeenCalledTimes(1);
    expect(deployUrlState.clearUrlTrigger).toHaveBeenCalledTimes(1);

    deployUrlState.initialApplicationName = 'changed-before-url-cleared';
    rerender(<DeployButton project={{ id: 'project', clusters: [], namespaces: [] }} />);

    expect(telemetryMocks.trackFeature).toHaveBeenCalledTimes(1);
    expect(dialogMocks.openDialog).toHaveBeenCalledTimes(1);
    expect(deployUrlState.clearUrlTrigger).toHaveBeenCalledTimes(1);
  });

  it('forwards Azure context and default namespace capabilities to the deploy wizard', () => {
    dialogMocks.open = true;
    azureHookMocks.useAzureContext.mockReturnValue({
      azureContext: {
        subscriptionId: 'subscription-1',
        resourceGroup: 'resource-group-1',
        tenantId: 'tenant-1',
      },
      error: 'Azure context warning',
    });
    azureHookMocks.useNamespaceCapabilities.mockReturnValue({
      isManagedNamespace: true,
      azureRbacEnabled: true,
    });

    render(<DeployButton project={{ id: 'project', clusters: ['cluster-1'], namespaces: [] }} />);

    expect(azureHookMocks.useAzureContext).toHaveBeenCalledWith('cluster-1');
    expect(azureHookMocks.useNamespaceCapabilities).toHaveBeenCalledWith({
      subscriptionId: 'subscription-1',
      resourceGroup: 'resource-group-1',
      clusterName: 'cluster-1',
      namespace: 'default',
    });
    expect(deployWizardMocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster: 'cluster-1',
        azureContext: {
          subscriptionId: 'subscription-1',
          resourceGroup: 'resource-group-1',
          clusterName: 'cluster-1',
          isManagedNamespace: true,
          azureRbacEnabled: true,
        },
        azureContextError: 'Azure context warning',
      })
    );
  });
});
