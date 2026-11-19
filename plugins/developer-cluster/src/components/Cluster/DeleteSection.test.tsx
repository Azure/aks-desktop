// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ConfirmDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalTarget } from '../../contract/capability';
import { deleteLocalCluster } from '../../workflow/delete';
import { getWorkflowState, update } from '../../workflow/store';
import { DeleteButtonSection } from './DeleteSection';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (text: string) => text }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  ConfirmDialog: vi.fn(() => null),
}));

vi.mock('../../workflow/delete', () => ({
  deleteLocalCluster: vi.fn(),
}));

/** The cluster Overview shows. */
const TARGET: LocalTarget = {
  name: 'dev-cluster',
  kubernetesVersion: 'v1.36.5',
  image: 'Ubuntu-24.04',
  contextName: 'dev-cluster',
  listName: 'dev-cluster',
};

/** The props of the last ConfirmDialog render. */
function dialogProps() {
  const calls = vi.mocked(ConfirmDialog).mock.calls;
  return calls[calls.length - 1][0];
}

/** Selects Delete cluster as Headlamp's ConfirmDialog handles it: close, then confirm. */
function confirm(props = dialogProps()) {
  props.handleClose();
  props.onConfirm();
}

/** Renders Overview's Delete with the current workflow state and opens its dialog. */
function openDialog() {
  const view = render(<DeleteButtonSection state={getWorkflowState()} target={TARGET} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete cluster' }));
  return view;
}

describe("Overview's Delete dialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    update({ busy: false, target: TARGET, deletePhase: 'idle', deleteFailure: null });
  });

  it('deletes the shown target and closes the dialog', () => {
    openDialog();

    act(() => confirm());

    expect(deleteLocalCluster).toHaveBeenCalledExactlyOnceWith(TARGET);
    expect(dialogProps().open).toBe(false);
  });

  it('keeps Delete disabled while another operation runs', () => {
    const { rerender } = openDialog();
    expect(dialogProps().confirmButtonDisabled).toBe(false);

    update({ busy: true });
    rerender(<DeleteButtonSection state={getWorkflowState()} target={TARGET} />);
    expect(dialogProps().confirmButtonDisabled).toBe(true);
  });

  it('keeps the dialog open when an operation starts just before the click', () => {
    openDialog();
    const rendered = dialogProps();

    act(() => {
      update({ busy: true });
      confirm(rendered);
    });

    expect(deleteLocalCluster).not.toHaveBeenCalled();
    expect(dialogProps().open).toBe(true);
  });
});
