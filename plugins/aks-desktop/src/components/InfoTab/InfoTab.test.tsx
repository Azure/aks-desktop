// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import InfoTab from './InfoTab';

const state = vi.hoisted(() => ({
  loading: false,
  revalidating: false,
  updating: false,
  resolvingTarget: false,
  error: null as string | null,
  saveError: null as string | null,
  namespaceDetails: {} as object | null,
  formData: {},
  validation: { isValid: true },
  hasChanges: true,
  hasRemoteChanges: false,
  canRefresh: true,
  handleFormDataChange: vi.fn(),
  handleSave: vi.fn(),
  handleRefresh: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./hooks/useInfoTab', () => ({ useInfoTab: () => state }));
vi.mock('../shared/NetworkingStep', () => ({
  NetworkingStep: () => <div>Networking editor</div>,
}));
vi.mock('../shared/ComputeStep', () => ({
  ComputeStep: () => <div>Compute editor</div>,
}));
const project = { id: 'project', clusters: ['cluster'], namespaces: ['namespace'] };

describe('InfoTab recovery and status', () => {
  afterEach(cleanup);
  beforeEach(() => {
    state.loading = state.revalidating = state.updating = state.hasRemoteChanges = false;
    state.resolvingTarget = false;
    state.error = state.saveError = null;
    state.namespaceDetails = {};
    state.hasChanges = true;
    state.canRefresh = true;
    state.validation.isValid = true;
    vi.clearAllMocks();
  });

  test('initial failure has a Retry action', () => {
    state.error = 'Details unavailable';
    state.namespaceDetails = null;
    render(<InfoTab project={project} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Details unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.handleRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Networking editor')).not.toBeInTheDocument();
  });

  test.each(['error', 'saveError'] as const)('%s keeps the editor and edits usable', field => {
    state[field] = 'Try again';
    render(<InfoTab project={project} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Try again');
    expect(screen.getByText('Networking editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  test('refresh exposes an accessible status and busy button', () => {
    state.revalidating = true;
    render(<InfoTab project={project} />);
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing data in background');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('loading indicator has an accessible name', () => {
    state.loading = true;
    state.namespaceDetails = null;
    render(<InfoTab project={project} />);
    expect(
      screen.getByRole('progressbar', { name: 'Loading namespace settings' })
    ).toBeInTheDocument();
  });

  test('metadata refresh keeps the editor but blocks saving an unresolved scope', () => {
    state.resolvingTarget = true;
    render(<InfoTab project={project} />);
    expect(screen.getByText('Networking editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  test('server changes inform the user without discarding the editor', () => {
    state.hasRemoteChanges = true;
    render(<InfoTab project={project} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Your unsaved changes have been kept.');
    expect(screen.getByText('Networking editor')).toBeInTheDocument();
  });
});
