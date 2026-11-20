// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The confirmation dialog of Delete, shared by Overview and AKS Desktop's cluster menu. It states
// what the CLI's delete removes and keeps (`aks-devctl/src/cmd/cluster.go`, `runDelete`): the
// cluster's WSL instance, named after the cluster, and its entries in the default kubeconfig. There
// is no option: every Delete removes the WSL instance.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { ConfirmDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Stack, Typography } from '@mui/material';

interface DeleteClusterDialogProps {
  readonly open: boolean;
  /** The cluster the dialog names. */
  readonly clusterName: string;
  /**
   * Disables Delete cluster while the workflow would refuse it. Only AKS Desktop's cluster menu,
   * whose Headlamp supports it, sets it.
   */
  readonly confirmDisabled?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

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
