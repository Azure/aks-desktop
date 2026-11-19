// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Delete cluster, the last control on Overview. Delete is one button without typed confirmation or
// consent; it opens the confirmation dialog, which states what Delete removes. The cluster menu on
// AKS Desktop's Home opens the same dialog. AKS Desktop must not offer its own NodeClean Delete
// beside this one.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { canDelete } from '../../common/gates';
import { LocalTarget } from '../../contract/capability';
import { deleteLocalCluster } from '../../workflow/delete';
import { getWorkflowState, WorkflowState } from '../../workflow/store';
import { failureText } from '../shared/failureText';
import { InfoBanner } from '../shared/InfoBanner';
import { ProgressNotice } from '../shared/Progress';
import { DeleteClusterDialog } from './DeleteClusterDialog';

/**
 * Deletes recorded by the guest agent took under a minute; the estimate leaves headroom for slower
 * computers. The CLI itself gives up only after 30 minutes.
 */
const DELETE_ESTIMATE_MINUTES = 5;

/**
 * A running Delete on Overview: its progress and how long it can take.
 *
 * @returns The progress notice and a banner with the time estimate.
 */
export function DeleteProgress() {
  const { t } = useTranslation();
  return (
    <Stack spacing={3}>
      <ProgressNotice text={String(t('Deleting your Developer Cluster'))} />
      <InfoBanner
        title={String(
          t('Deleting the cluster can take up to {{minutes}} minutes.', {
            minutes: DELETE_ESTIMATE_MINUTES,
          })
        )}
      />
    </Stack>
  );
}

/**
 * The result of the last Delete once no cluster is registered; nothing otherwise.
 *
 * @param props - `state`, the workflow state.
 * @returns A success notice after a completed Delete, otherwise null.
 */
export function DeleteResultNotice({ state }: { readonly state: WorkflowState }) {
  const { t } = useTranslation();
  if (state.deletePhase !== 'deleted') return null;
  return (
    <Alert severity="success">
      {t('Cluster deleted. Its WSL instance and kubeconfig entries were removed.')}
    </Alert>
  );
}

/** The props of DeleteButtonSection. */
interface DeleteSectionProps {
  /** The workflow state. */
  readonly state: WorkflowState;
  /** The cluster Overview shows; Delete runs only while it is still the loaded target. */
  readonly target: LocalTarget;
}

/**
 * The failure of the last Delete. Overview shows it with the cluster and, once a refresh finds no
 * cluster, on the landing page; the CLI can fail after it removed the cluster's context.
 *
 * @param props - `state`, the workflow state.
 * @returns An error notice with the failure text after a failed Delete, otherwise null.
 */
export function DeleteFailureNotice({ state }: { readonly state: WorkflowState }) {
  const { t } = useTranslation();
  const failure = state.deletePhase === 'failed' ? state.deleteFailure : null;
  if (failure === null) return null;
  return (
    <Alert severity="error">
      <Stack spacing={1}>
        <span>{t('Deleting the cluster failed.')}</span>
        <span>{failureText(t, failure)}</span>
      </Stack>
    </Alert>
  );
}

/**
 * Overview's Delete: one button after a divider, without typed confirmation or consent. It opens
 * the shared confirmation dialog and passes the target it shows, so the workflow refuses to delete
 * a target that changed since the page rendered.
 *
 * @param props - The workflow state and the target Overview shows.
 * @returns The divider, the Delete failure notice, the Delete cluster button and its dialog.
 */
export function DeleteButtonSection({ state, target }: DeleteSectionProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  /**
   * Closes the dialog and starts Delete of the shown target. Re-checks the latest state: the click
   * can follow an update that has not rendered yet, such as a refresh after Headlamp's cluster list
   * changed. Headlamp closes the dialog before this call, so a refused Delete reopens it.
   */
  function startDelete() {
    if (!canDelete(getWorkflowState())) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    deleteLocalCluster(target);
  }

  return (
    <Stack spacing={2}>
      <Divider />
      <DeleteFailureNotice state={state} />
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="body2" color="text.secondary">
            {t('Delete the cluster and its data to free up resources on this device.')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('This deletes the underlying cluster—not just its connection in AKS Desktop.')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          color="error"
          disabled={!canDelete(state)}
          onClick={() => setConfirming(true)}
          sx={{ flexShrink: 0 }}
        >
          {t('Delete cluster')}
        </Button>
      </Stack>
      <DeleteClusterDialog
        open={confirming}
        clusterName={target.name}
        // Another operation, such as a refresh, would make the workflow refuse Delete.
        confirmDisabled={!canDelete(state)}
        onClose={() => setConfirming(false)}
        onConfirm={startDelete}
      />
    </Stack>
  );
}
