// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockApply = vi.hoisted(() => vi.fn());
const mockDryRunApply = vi.hoisted(() => vi.fn());

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, any>) => {
      if (opts) {
        let result = key;
        for (const [k, v] of Object.entries(opts)) {
          result = result.replace(`{{${k}}}`, String(v));
        }
        return result;
      }
      return key;
    },
  }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  apply: mockApply,
}));

vi.mock('@kinvolk/headlamp-plugin/lib/k8s/cluster', () => ({}));

vi.mock('./utils/dryRunApply', () => ({
  dryRunApply: mockDryRunApply,
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock('@iconify/react', () => ({
  Icon: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));

import DeployWizard from './DeployWizard';

const deploymentYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-deploy
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: nginx:latest`;

const multiResourceYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-deploy
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: test-svc
spec:
  ports:
    - port: 80`;

const listResourceYaml = `apiVersion: v1
kind: List
items:
  - apiVersion: apps/v1
    kind: Deployment
    metadata:
      name: list-deploy
    spec:
      replicas: 1
      template:
        spec:
          containers:
            - name: app
              image: nginx:1.0
  - apiVersion: v1
    kind: Service
    metadata:
      name: list-svc
    spec:
      ports:
        - port: 80`;

function renderAndNavigateToYamlDeploy(yaml: string) {
  const onClose = vi.fn();
  render(<DeployWizard cluster="test-cluster" namespace="default" onClose={onClose} />);

  // Step 1: Select YAML source via aria-label button
  const yamlButton = screen.getByRole('button', { name: 'Kubernetes YAML' });
  fireEvent.click(yamlButton);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  // Step 2: Enter YAML in the mock Monaco editor
  const editor = screen.getByTestId('monaco-editor');
  fireEvent.change(editor, { target: { value: yaml } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  return onClose;
}

describe('DeployWizard handleDeploy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('shows dry-run validation errors and does not call apply', async () => {
    mockDryRunApply.mockRejectedValue(
      new Error(
        'admission webhook "validation.gatekeeper.sh" denied the request: container image must not use latest tag'
      )
    );

    renderAndNavigateToYamlDeploy(deploymentYaml);

    const deployBtn = screen.getAllByRole('button', { name: /^Deploy$/ }).pop()!;
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(mockDryRunApply).toHaveBeenCalledTimes(1);
    });

    expect(mockApply).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(
        screen.getByText(/admission webhook.*denied the request.*latest tag/i)
      ).toBeInTheDocument();
    });
  });

  test('proceeds to apply when dry-run passes', async () => {
    mockDryRunApply.mockResolvedValue({});
    mockApply.mockResolvedValue({});

    renderAndNavigateToYamlDeploy(deploymentYaml);

    const deployBtn = screen.getAllByRole('button', { name: /^Deploy$/ }).pop()!;
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(mockDryRunApply).toHaveBeenCalledTimes(1);
      expect(mockApply).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText(/Applied 1 resource\(s\) successfully/)).toBeInTheDocument();
    });
  });

  test('shows per-resource errors on partial apply failure', async () => {
    mockDryRunApply.mockResolvedValue({});
    mockApply.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Service port conflict'));

    renderAndNavigateToYamlDeploy(multiResourceYaml);

    const deployBtn = screen.getAllByRole('button', { name: /^Deploy$/ }).pop()!;
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(mockDryRunApply).toHaveBeenCalledTimes(2);
      expect(mockApply).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByText(/Applied 1 resource\(s\), but 1 failed/)).toBeInTheDocument();
      expect(screen.getByText(/Service\/test-svc: Service port conflict/)).toBeInTheDocument();
    });
  });

  test('shows multiple dry-run errors for multiple resources', async () => {
    mockDryRunApply
      .mockRejectedValueOnce(new Error('Deployment denied'))
      .mockRejectedValueOnce(new Error('Service denied'));

    renderAndNavigateToYamlDeploy(multiResourceYaml);

    const deployBtn = screen.getAllByRole('button', { name: /^Deploy$/ }).pop()!;
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(mockDryRunApply).toHaveBeenCalledTimes(2);
    });

    expect(mockApply).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText(/Deployment\/test-deploy: Deployment denied/)).toBeInTheDocument();
      expect(screen.getByText(/Service\/test-svc: Service denied/)).toBeInTheDocument();
    });
  });

  test('expands List resources and dry-runs each item individually', async () => {
    mockDryRunApply.mockResolvedValue({});
    mockApply.mockResolvedValue({});

    renderAndNavigateToYamlDeploy(listResourceYaml);

    const deployBtn = screen.getAllByRole('button', { name: /^Deploy$/ }).pop()!;
    fireEvent.click(deployBtn);

    await waitFor(() => {
      // Should dry-run each item in the List, not the List itself
      expect(mockDryRunApply).toHaveBeenCalledTimes(2);
      expect(mockApply).toHaveBeenCalledTimes(2);
    });

    // Verify dryRunApply was called with individual resources, not the List wrapper
    const dryRunCalls = mockDryRunApply.mock.calls;
    expect(dryRunCalls[0][0]).toMatchObject({
      kind: 'Deployment',
      metadata: { name: 'list-deploy' },
    });
    expect(dryRunCalls[1][0]).toMatchObject({ kind: 'Service', metadata: { name: 'list-svc' } });

    await waitFor(() => {
      expect(screen.getByText(/Applied 2 resource\(s\) successfully/)).toBeInTheDocument();
    });
  });
});

describe('DeployWizard container step navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('can jump back to an earlier step and forward again', async () => {
    render(<DeployWizard cluster="test-cluster" namespace="default" onClose={vi.fn()} />);
    const stepButton = (name: RegExp) => screen.getByRole('button', { name });

    fireEvent.click(screen.getByRole('button', { name: 'Container Image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.change(screen.getByLabelText('Application name'), { target: { value: 'my-app' } });
    fireEvent.change(screen.getByLabelText('Container image'), { target: { value: 'my-image' } });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(stepButton(/Networking/)).toHaveAttribute('aria-current', 'step'));

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(stepButton(/Healthchecks/)).toHaveAttribute('aria-current', 'step'));

    // Never-visited steps stay disabled.
    expect(stepButton(/Advanced/)).toBeDisabled();

    fireEvent.click(stepButton(/Basics/));
    await waitFor(() => expect(screen.getByLabelText('Application name')).toHaveValue('my-app'));

    // Going back must not re-gate the steps that were already visited.
    expect(stepButton(/Healthchecks/)).not.toBeDisabled();

    // Leaving and re-entering the Configure step must not re-gate them either.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Configure' }).pop()!);
    await waitFor(() => expect(stepButton(/Healthchecks/)).not.toBeDisabled());

    fireEvent.click(stepButton(/Healthchecks/));
    await waitFor(() => expect(stepButton(/Healthchecks/)).toHaveAttribute('aria-current', 'step'));
  });
});
