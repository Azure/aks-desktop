// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The confirmation dialog of Delete, shared by Overview and AKS Desktop's cluster menu. It states
// what the CLI's delete removes and keeps (`aks-devctl/src/cmd/cluster.go`, `runDelete`): the
// cluster's WSL instance, named after the cluster, and its entries in the default kubeconfig. There
// is no option: every Delete removes the WSL instance.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { ConfirmDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Stack, Typography } from '@mui/material';

/** The props of DeleteClusterDialog. */
interface DeleteClusterDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** The cluster the dialog names. */
  readonly clusterName: string;
  /**
   * Disables Delete cluster while the workflow would refuse it. Only AKS Desktop's cluster menu,
   * whose Headlamp supports it, sets it.
   */
  readonly confirmDisabled?: boolean;
  /** Called when the dialog closes: on Cancel, on a click outside it, and before `onConfirm`. */
  readonly onClose: () => void;
  /** Called when the user selects Delete cluster. */
  readonly onConfirm: () => void;
}

/**
 * The confirmation dialog of Delete: it names the cluster and states what Delete removes and keeps.
 *
 * @param props - Whether the dialog is open, the cluster it names and its callbacks.
 * @returns Headlamp's confirmation dialog with Cancel and Delete cluster.
 */
export function DeleteClusterDialog({
  open,
  clusterName,
  confirmDisabled,
  onClose,
  onConfirm,
}: DeleteClusterDialogProps) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      title={String(t('Delete cluster'))}
      description={
        <Stack spacing={1.5}>
          <Typography variant="body2">
            {t(
              'Permanently delete the {{name}} cluster and its associated data. This cannot be undone.',
              { name: clusterName }
            )}
          </Typography>
          <Typography variant="body2">
            {t(
              "This removes the cluster's WSL instance, {{name}}, and everything in it, and removes the cluster's entries from your kubeconfig. Other WSL distributions and kubeconfig entries, downloaded files and settings are kept.",
              { name: clusterName }
            )}
          </Typography>
        </Stack>
      }
      cancelLabel={String(t('Cancel'))}
      confirmLabel={String(t('Delete cluster'))}
      // Omitted unless set, so a Headlamp without the prop receives nothing new.
      {...(confirmDisabled === undefined ? {} : { confirmButtonDisabled: confirmDisabled })}
      handleClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
