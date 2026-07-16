// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => ({ trackFeature: vi.fn() }));
const dialogMocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  closeDialog: vi.fn(),
}));
const deployUrlState = vi.hoisted(() => ({
  shouldOpenDialog: false,
  initialApplicationName: undefined as string | undefined,
  clearUrlTrigger: vi.fn(),
}));

vi.mock('../../telemetry', () => telemetryMocks);
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../DeployWizard/DeployWizard', () => ({
  default: () => <div>Deploy wizard</div>,
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
    open: false,
    initialApplicationName: undefined,
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
  });

  afterEach(() => cleanup());

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
});
