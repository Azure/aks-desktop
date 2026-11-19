// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ConfirmDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_CONTEXT_MANAGED_BY } from '../../contract/devctl';
import { deleteLocalContext } from '../../workflow/delete';
import { update } from '../../workflow/store';
import { ClusterMenuDeleteDialog } from './ClusterMenuDelete';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (text: string) => text }),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  ConfirmDialog: vi.fn(() => null),
}));

vi.mock('../../workflow/delete', () => ({
  deleteLocalContext: vi.fn(),
}));

/** A Home row for the local context, as Headlamp lists it. */
const CLUSTER = {
  name: 'dev-cluster',
  meta_data: {
    extensions: { context_info: { managedBy: LOCAL_CONTEXT_MANAGED_BY, name: 'dev-cluster' } },
  },
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

function openDialog(setOpenConfirmDialog = vi.fn()) {
  render(
    <MemoryRouter>
      <ClusterMenuDeleteDialog
        cluster={CLUSTER}
        openConfirmDialog="developer-cluster-delete"
        setOpenConfirmDialog={setOpenConfirmDialog}
      />
    </MemoryRouter>
  );
  return setOpenConfirmDialog;
}

describe('the cluster-menu Delete dialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    update({ busy: false });
  });

  it('deletes the context and the cluster the dialog names', () => {
    const setOpen = openDialog();

    act(() => confirm());

    expect(deleteLocalContext).toHaveBeenCalledExactlyOnceWith('dev-cluster', 'dev-cluster');
    expect(setOpen).toHaveBeenLastCalledWith('');
  });

  it('keeps Delete disabled while another operation runs', () => {
    update({ busy: true });
    openDialog();
    expect(dialogProps().confirmButtonDisabled).toBe(true);

    act(() => update({ busy: false }));
    expect(dialogProps().confirmButtonDisabled).toBe(false);
  });

  it('keeps the dialog open when an operation starts just before the click', () => {
    const setOpen = openDialog();
    const rendered = dialogProps();
    expect(rendered.confirmButtonDisabled).toBe(false);

    act(() => {
      update({ busy: true });
      confirm(rendered);
    });

    expect(deleteLocalContext).not.toHaveBeenCalled();
    expect(setOpen).toHaveBeenLastCalledWith('developer-cluster-delete');
  });
});
