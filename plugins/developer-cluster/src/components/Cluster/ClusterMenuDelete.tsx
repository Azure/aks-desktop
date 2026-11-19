// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// Delete in AKS Desktop's cluster menu. The plugin claims the Delete of the local context,
// identified by the CLI's `context_info.managedBy`, with AKS Desktop's generic delete handler
// (patch 8519), so Headlamp's Delete, which only removes the kubeconfig entry, opens this dialog
// instead: the shared confirmation dialog, then Overview's Delete, which runs the CLI, and
// Overview, which shows the progress.

import { useHistory } from 'react-router-dom';
import { canRefresh } from '../../common/gates';
import { isLocalContext } from '../../contract/capability';
import { PLUGIN_ROUTES } from '../../contract/routes';
import { deleteLocalContext } from '../../workflow/delete';
import { getWorkflowState } from '../../workflow/store';
import { useWorkflow } from '../shared/hooks';
import { DeleteClusterDialog } from './DeleteClusterDialog';

/** The dialog name Delete opens; Headlamp keeps one open dialog per cluster row. */
const DELETE_DIALOG = 'developer-cluster-delete';

/** The fields of a Headlamp cluster this file reads. */
interface MenuCluster {
  readonly name?: unknown;
  readonly meta_data?: {
    readonly originalName?: unknown;
    readonly extensions?: { readonly context_info?: { readonly name?: unknown } };
  };
}

/**
 * The kubeconfig context of the Developer Cluster, identified by the CLI's `context_info`, or null
 * for any other cluster.
 */
function localContextName(cluster: MenuCluster | null | undefined): string | null {
  if (!isLocalContext(cluster)) return null;
  const name = cluster?.meta_data?.originalName ?? cluster?.name;
  return typeof name === 'string' && name !== '' ? name : null;
}

/**
 * The cluster name the dialog shows: the CLI records it in the context's `context_info`; the
 * context name stands in when it is missing. Delete requires the target to have this name.
 */
function localClusterName(cluster: MenuCluster, contextName: string): string {
  const name = cluster.meta_data?.extensions?.context_info?.name;
  return typeof name === 'string' && name !== '' ? name : contextName;
}

/** The plugin's claim on Delete for the local context (`registerClusterProviderDeleteHandler`). */
export const LOCAL_DELETE_HANDLER = Object.freeze({
  owns: (cluster: MenuCluster | null | undefined) => localContextName(cluster) !== null,
  dialog: DELETE_DIALOG,
});

interface DialogProps {
  readonly cluster: MenuCluster;
  readonly openConfirmDialog: string | null;
  readonly setOpenConfirmDialog: (value: string) => void;
}

export function ClusterMenuDeleteDialog({
  cluster,
  openConfirmDialog,
  setOpenConfirmDialog,
}: DialogProps) {
  const history = useHistory();
  const state = useWorkflow();
  const contextName = localContextName(cluster);
  if (contextName === null) return null;
  const clusterName = localClusterName(cluster, contextName);
  return (
    <DeleteClusterDialog
      open={openConfirmDialog === DELETE_DIALOG}
      clusterName={clusterName}
      // Another operation, such as Overview's refresh, would make the workflow refuse Delete.
      confirmDisabled={!canRefresh(state)}
      onClose={() => setOpenConfirmDialog('')}
      onConfirm={() => {
        // Re-checks the latest state: the click can follow an update that has not rendered yet.
        // Headlamp closes the dialog before this call, so a refused Delete reopens it.
        if (!canRefresh(getWorkflowState())) {
          setOpenConfirmDialog(DELETE_DIALOG);
          return;
        }
        setOpenConfirmDialog('');
        // Sets the running phase before Overview opens, so Overview shows the progress.
        deleteLocalContext(contextName, clusterName);
        history.push(PLUGIN_ROUTES.overview);
      }}
    />
  );
}
