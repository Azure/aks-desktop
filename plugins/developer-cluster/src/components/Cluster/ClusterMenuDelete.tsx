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
  /** The name AKS Desktop lists the cluster under: a custom display name or the context name. */
  readonly name?: unknown;
  /** Headlamp's metadata of the cluster entry. */
  readonly meta_data?: {
    /** The kubeconfig context name; `name` stands in when it is absent. */
    readonly originalName?: unknown;
    /** The context's kubeconfig extensions; `context_info.name` is the CLI's cluster name. */
    readonly extensions?: { readonly context_info?: { readonly name?: unknown } };
  };
}

/**
 * The kubeconfig context of the Developer Cluster, identified by the CLI's `context_info`, or null
 * for any other cluster.
 *
 * @param cluster - The Headlamp cluster entry of the menu row, if any.
 * @returns The context name, or null for another cluster or an entry without a context name.
 */
function localContextName(cluster: MenuCluster | null | undefined): string | null {
  if (!isLocalContext(cluster)) return null;
  const name = cluster?.meta_data?.originalName ?? cluster?.name;
  return typeof name === 'string' && name !== '' ? name : null;
}

/**
 * The cluster name the dialog shows: the CLI records it in the context's `context_info`; the
 * context name stands in when it is missing. Delete requires the target to have this name.
 *
 * @param cluster - The Headlamp cluster entry of the local context.
 * @param contextName - The entry's context name, used when `context_info.name` is missing or empty.
 * @returns The cluster name the dialog shows.
 */
function localClusterName(cluster: MenuCluster, contextName: string): string {
  const name = cluster.meta_data?.extensions?.context_info?.name;
  return typeof name === 'string' && name !== '' ? name : contextName;
}

/** The plugin's claim on Delete for the local context (`registerClusterProviderDeleteHandler`). */
export const LOCAL_DELETE_HANDLER = Object.freeze({
  /**
   * Whether the plugin handles Delete for this cluster entry.
   *
   * @param cluster - The Headlamp cluster entry of the menu row.
   * @returns True for the local context.
   */
  owns: (cluster: MenuCluster | null | undefined) => localContextName(cluster) !== null,
  /** The dialog name Delete opens. */
  dialog: DELETE_DIALOG,
});

/** The props Headlamp passes to a cluster provider dialog. */
interface DialogProps {
  /** The Headlamp cluster entry of the menu row. */
  readonly cluster: MenuCluster;
  /** The name of the dialog open for this row, or null when none is open. */
  readonly openConfirmDialog: string | null;
  /** Opens the named dialog for this row; the plugin passes '' to close it. */
  readonly setOpenConfirmDialog: (value: string) => void;
}

/**
 * The cluster menu's Delete dialog for the local context: the shared confirmation dialog, whose
 * Delete cluster starts Overview's Delete and then opens Overview, which shows the progress.
 *
 * @param props - The cluster entry of the menu row and Headlamp's open-dialog state.
 * @returns The confirmation dialog, or null for a cluster that is not the local context.
 */
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
