// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon, ...props }: any) => <span data-testid={`icon-${icon}`} {...props} />,
}));

import type { UseWorkloadIdentitySetupReturn } from '../hooks/useWorkloadIdentitySetup';
import { WorkloadIdentitySetup } from './WorkloadIdentitySetup';

const mockRepo = { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' };

function makeIdentitySetup(
  overrides: Partial<UseWorkloadIdentitySetupReturn> = {}
): UseWorkloadIdentitySetupReturn {
  return {
    status: 'idle',
    error: null,
    result: null,
    setupWorkloadIdentity: vi.fn(),
    ...overrides,
  };
}

const defaultProps = {
  subscriptionId: '12345678-1234-1234-1234-123456789abc',
  resourceGroup: 'cluster-rg',
  clusterName: 'my-cluster',
  repo: mockRepo,
  projectName: 'my-project',
  isManagedNamespace: false as const,
};

describe('WorkloadIdentitySetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders TextField with default rg-<projectName> value', () => {
    render(<WorkloadIdentitySetup {...defaultProps} identitySetup={makeIdentitySetup()} />);

    const textField = screen.getByDisplayValue('rg-my-project');
    expect(textField).toBeInTheDocument();
  });

  it('updates TextField when projectName prop changes', () => {
    const { rerender } = render(
      <WorkloadIdentitySetup {...defaultProps} identitySetup={makeIdentitySetup()} />
    );

    expect(screen.getByDisplayValue('rg-my-project')).toBeInTheDocument();

    rerender(
      <WorkloadIdentitySetup
        {...defaultProps}
        projectName="new-project"
        identitySetup={makeIdentitySetup()}
      />
    );

    expect(screen.getByDisplayValue('rg-new-project')).toBeInTheDocument();
  });

  it('disables Continue button when TextField is empty', () => {
    render(<WorkloadIdentitySetup {...defaultProps} identitySetup={makeIdentitySetup()} />);

    const textField = screen.getByDisplayValue('rg-my-project');
    fireEvent.change(textField, { target: { value: '' } });

    const button = screen.getByRole('button', { name: /Continue/i });
    expect(button).toBeDisabled();
  });

  it('disables Continue button when TextField is whitespace only', () => {
    render(<WorkloadIdentitySetup {...defaultProps} identitySetup={makeIdentitySetup()} />);

    const textField = screen.getByDisplayValue('rg-my-project');
    fireEvent.change(textField, { target: { value: '   ' } });

    const button = screen.getByRole('button', { name: /Continue/i });
    expect(button).toBeDisabled();
  });

  it('passes trimmed identityRG to setupWorkloadIdentity', () => {
    const mockSetup = vi.fn();
    render(
      <WorkloadIdentitySetup
        {...defaultProps}
        identitySetup={makeIdentitySetup({ setupWorkloadIdentity: mockSetup })}
      />
    );

    const textField = screen.getByDisplayValue('rg-my-project');
    fireEvent.change(textField, { target: { value: '  rg-custom  ' } });

    const button = screen.getByRole('button', { name: /Continue/i });
    fireEvent.click(button);

    expect(mockSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        identityResourceGroup: 'rg-custom',
      })
    );
  });

  it('shows progress steps when status is not idle', () => {
    render(
      <WorkloadIdentitySetup
        {...defaultProps}
        identitySetup={makeIdentitySetup({ status: 'checking' })}
      />
    );

    expect(screen.getByText('Checking for existing identity...')).toBeInTheDocument();
    expect(screen.getByText('Ensuring resource group exists...')).toBeInTheDocument();
  });

  it('shows error alert and TextField with Retry button when status is error', () => {
    render(
      <WorkloadIdentitySetup
        {...defaultProps}
        identitySetup={makeIdentitySetup({
          status: 'error',
          error: 'Permission denied',
        })}
      />
    );

    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    // TextField should be visible in error state for editing before retry
    expect(screen.getByDisplayValue('rg-my-project')).toBeInTheDocument();
  });

  it('allows editing RG and retrying in error state', () => {
    const mockSetup = vi.fn();
    render(
      <WorkloadIdentitySetup
        {...defaultProps}
        identitySetup={makeIdentitySetup({
          status: 'error',
          error: 'RG not found',
          setupWorkloadIdentity: mockSetup,
        })}
      />
    );

    const textField = screen.getByDisplayValue('rg-my-project');
    fireEvent.change(textField, { target: { value: 'rg-corrected' } });

    const retryButton = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryButton);

    expect(mockSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        identityResourceGroup: 'rg-corrected',
      })
    );
  });

  it('disables Retry button when RG field is empty in error state', () => {
    render(
      <WorkloadIdentitySetup
        {...defaultProps}
        identitySetup={makeIdentitySetup({
          status: 'error',
          error: 'Some error',
        })}
      />
    );

    const textField = screen.getByDisplayValue('rg-my-project');
    fireEvent.change(textField, { target: { value: '' } });

    const retryButton = screen.getByRole('button', { name: /Retry/i });
    expect(retryButton).toBeDisabled();
  });

  it('shows success alert when status is done', () => {
    render(
      <WorkloadIdentitySetup
        {...defaultProps}
        identitySetup={makeIdentitySetup({ status: 'done' })}
      />
    );

    expect(screen.getByText('Workload identity configured successfully.')).toBeInTheDocument();
  });

  it('shows warning alerts alongside success when result has warnings', () => {
    render(
      <WorkloadIdentitySetup
        {...defaultProps}
        identitySetup={makeIdentitySetup({
          status: 'done',
          result: {
            clientId: 'client-id',
            tenantId: 'tenant-id',
            principalId: 'principal-id',
            identityName: 'id-my-project-github',
            isExisting: false,
            warnings: ['Failed to assign AcrPull to kubelet identity: Forbidden'],
          },
        })}
      />
    );

    expect(screen.getByText('Workload identity configured successfully.')).toBeInTheDocument();
    expect(
      screen.getByText('Failed to assign AcrPull to kubelet identity: Forbidden')
    ).toBeInTheDocument();
  });

  it('displays identity name based on projectName', () => {
    render(<WorkloadIdentitySetup {...defaultProps} identitySetup={makeIdentitySetup()} />);

    expect(screen.getByText('id-my-project-github')).toBeInTheDocument();
  });
});
