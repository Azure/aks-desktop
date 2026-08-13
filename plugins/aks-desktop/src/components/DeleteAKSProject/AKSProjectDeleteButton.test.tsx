// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleDelete: vi.fn(),
  trackAksFeature: vi.fn(),
}));

vi.mock('@iconify/react', () => ({
  Icon: () => null,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (message: string) => message }),
}));

vi.mock('./hooks/useProjectDeletion', () => ({
  useProjectDeletion: () => ({ handleDelete: mocks.handleDelete }),
}));

vi.mock('./hooks/useProjectPermissions', () => ({
  useProjectPermissions: () => ({ canDelete: true, isLoading: false }),
}));

vi.mock('../../telemetry/aksFeature', () => ({
  trackAksFeature: mocks.trackAksFeature,
}));

vi.mock('./components/AKSProjectDeleteDialog', () => ({
  AKSProjectDeleteDialog: ({
    onClose,
    onDelete,
    open,
  }: {
    onClose: () => void;
    onDelete: () => void;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog">
        <button onClick={onClose}>Cancel</button>
        <button onClick={onDelete}>Confirm</button>
      </div>
    ) : null,
}));

import AKSProjectDeleteButton from './AKSProjectDeleteButton';

const project = {
  clusters: ['sensitive-cluster'],
  id: 'sensitive-project',
  namespaces: ['sensitive-namespace'],
};

describe('AKSProjectDeleteButton telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleDelete.mockImplementation((_project, _deleteNamespaces, onClose) => onClose());
  });

  afterEach(() => {
    cleanup();
  });

  test('tracks opened and explicit pre-confirm cancellation for each interaction', () => {
    render(<AKSProjectDeleteButton project={project} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(mocks.trackAksFeature).toHaveBeenLastCalledWith('aksd.project-delete', 'opened');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.trackAksFeature).toHaveBeenLastCalledWith('aksd.project-delete', 'cancelled');

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(mocks.trackAksFeature.mock.calls).toEqual([
      ['aksd.project-delete', 'opened'],
      ['aksd.project-delete', 'cancelled'],
      ['aksd.project-delete', 'opened'],
    ]);
  });

  test('confirmation closes without tracking cancellation', () => {
    render(<AKSProjectDeleteButton project={project} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mocks.handleDelete).toHaveBeenCalledWith(project, false, expect.any(Function));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.trackAksFeature.mock.calls).toEqual([['aksd.project-delete', 'opened']]);
  });
});
