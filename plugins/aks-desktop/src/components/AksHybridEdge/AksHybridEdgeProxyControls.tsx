// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemText,
  MenuItem,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  azurePortalClusterUrl,
  checkClusterReachable,
  startProxy,
  stopProxy,
  verifyAksHybridEdgeCluster,
} from '../../utils/azure/aksHybridEdgeProxy';
import {
  getClusterSettings,
  markAksHybridEdgeAppearance,
} from '../../utils/shared/clusterSettings';
import { openExternalUrl } from '../../utils/shared/openExternalUrl';

/** Confirm-dialog id used to coordinate the start-proxy dialog with its menu item. */
const START_DIALOG_ID = 'aks-hybrid-edge-proxy-start';

/**
 * Cluster action-menu item to start or stop the AKS Hybrid & Edge proxy.
 * Registered via `registerClusterProviderMenuItem`.
 *
 * Driven purely by **reachability** — the observable truth of whether a proxy is
 * serving the cluster, which is independent of renderer reloads (the proxy is
 * owned by the app/main layer, not the renderer):
 *  - reachable → the proxy is up → offer **Stop**;
 *  - not reachable → offer **Start**;
 *  - still probing → a disabled placeholder so the item doesn't flip.
 */
export function AksHybridEdgeProxyMenuItem({
  cluster,
  handleMenuClose,
  setOpenConfirmDialog,
}: {
  cluster: any;
  handleMenuClose: () => void;
  setOpenConfirmDialog: (value: string) => void;
}) {
  const { t } = useTranslation();
  const settings = getClusterSettings(cluster?.name);
  const clusterName: string = cluster?.name;
  const isAksHybridEdge =
    settings.clusterType === 'aksarc' && !!settings.subscriptionId && !!settings.resourceGroup;

  const [reachable, setReachable] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!isAksHybridEdge || !clusterName) {
      return;
    }
    let cancelled = false;
    checkClusterReachable(clusterName).then(r => {
      if (!cancelled) {
        setReachable(r.success);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAksHybridEdge, clusterName]);

  if (!isAksHybridEdge) {
    return null;
  }

  // Still probing — show a disabled placeholder rather than flipping the label.
  if (reachable === null) {
    return (
      <MenuItem disabled>
        <ListItemText>{t('Checking AKS Hybrid & Edge proxy…')}</ListItemText>
      </MenuItem>
    );
  }

  // Reachable → a proxy is serving the cluster → offer to stop it.
  if (reachable) {
    return (
      <MenuItem
        onClick={() => {
          handleMenuClose();
          stopProxy(clusterName).catch(err =>
            console.error('[AKS] Failed to stop AKS Hybrid & Edge proxy:', err)
          );
        }}
      >
        <ListItemText>{t('Stop AKS Hybrid & Edge proxy')}</ListItemText>
      </MenuItem>
    );
  }

  // Not reachable → offer to start (idempotent in the app layer).
  return (
    <MenuItem
      onClick={() => {
        handleMenuClose();
        setOpenConfirmDialog(START_DIALOG_ID);
      }}
    >
      <ListItemText>{t('Start AKS Hybrid & Edge proxy')}</ListItemText>
    </MenuItem>
  );
}

type StartPhase = 'starting' | 'verifying' | 'error' | 'done';

/**
 * Dialog that drives starting the AKS Hybrid & Edge proxy for a cluster and verifying
 * connectivity. Registered via `registerClusterProviderDialog`. Used to
 * (re)connect a cluster after a full app restart, when the proxy is gone.
 */
export function AksHybridEdgeProxyStartDialog({
  cluster,
  openConfirmDialog,
  setOpenConfirmDialog,
}: {
  cluster: any;
  openConfirmDialog: string | null;
  setOpenConfirmDialog: (value: string) => void;
}) {
  const { t } = useTranslation();
  const open = openConfirmDialog === START_DIALOG_ID;
  const settings = getClusterSettings(cluster?.name);

  const [phase, setPhase] = React.useState<StartPhase>('starting');
  const [errorMsg, setErrorMsg] = React.useState('');
  // Set when the failure is an unhealthy-cluster case, so we can offer a link to
  // inspect the cluster in the Azure portal (where the state can be remediated).
  const [showPortalLink, setShowPortalLink] = React.useState(false);
  const startedRef = React.useRef(false);

  const clusterName: string = cluster?.name;
  const subscriptionId = settings.subscriptionId;
  const resourceGroup = settings.resourceGroup;

  const run = React.useCallback(async () => {
    if (!subscriptionId || !resourceGroup || !clusterName) {
      setErrorMsg(t('Missing Azure metadata for this cluster.'));
      setPhase('error');
      return;
    }
    const target = { subscriptionId, resourceGroup, clusterName };
    setPhase('starting');
    setErrorMsg('');
    setShowPortalLink(false);

    try {
      const start = await startProxy(target);
      if (!start.success) {
        setErrorMsg(start.error || t('Unknown error'));
        setPhase('error');
        return;
      }

      setPhase('verifying');
      const verify = await verifyAksHybridEdgeCluster(clusterName, {
        target: { subscriptionId, resourceGroup },
      });
      if (!verify.success) {
        await stopProxy(clusterName);
        setErrorMsg(verify.error || t('Unknown error'));
        // A non-Succeeded currentState means the cluster is unhealthy in
        // Azure — offer a link to inspect/remediate it there.
        setShowPortalLink(!!verify.currentState && verify.currentState !== 'Succeeded');
        setPhase('error');
        return;
      }

      // Ensure the distinct name badge is present (covers clusters registered
      // before badge support existed, reconnected via this dialog).
      markAksHybridEdgeAppearance(clusterName);
      setPhase('done');
    } catch (err) {
      await stopProxy(clusterName);
      setErrorMsg(err instanceof Error ? err.message : t('Unknown error'));
      setPhase('error');
    }
  }, [subscriptionId, resourceGroup, clusterName, t]);

  // Kick off the start flow once when the dialog opens; reset when it closes.
  React.useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      run();
    } else if (!open) {
      startedRef.current = false;
      setPhase('starting');
      setErrorMsg('');
    }
  }, [open, run]);

  if (!open || settings.clusterType !== 'aksarc') {
    return null;
  }

  const close = () => setOpenConfirmDialog('');
  const busy = phase === 'starting' || phase === 'verifying';

  return (
    <Dialog open={open} onClose={busy ? undefined : close} maxWidth="xs" fullWidth>
      <DialogTitle>{t('Connect AKS Hybrid & Edge cluster')}</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} pt={1}>
          {phase === 'starting' && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={18} aria-hidden="true" />
              <Typography variant="body2">{t('Starting AKS Hybrid & Edge proxy...')}</Typography>
            </Box>
          )}
          {phase === 'verifying' && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={18} aria-hidden="true" />
              <Typography variant="body2">{t('Verifying cluster connection...')}</Typography>
            </Box>
          )}
          {phase === 'error' && <Alert severity="error">{errorMsg}</Alert>}
          {phase === 'done' && (
            <Alert severity="success">
              {t('Connected to "{{cluster}}". Reload to view the cluster.', {
                cluster: clusterName,
              })}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {phase === 'error' && (
          <>
            <Button onClick={close}>{t('Close')}</Button>
            {showPortalLink && subscriptionId && resourceGroup && (
              <Button
                onClick={() =>
                  openExternalUrl(
                    azurePortalClusterUrl({ subscriptionId, resourceGroup, clusterName })
                  )
                }
              >
                {t('Open in Azure portal')}
              </Button>
            )}
            <Button variant="contained" onClick={() => run()}>
              {t('Retry')}
            </Button>
          </>
        )}
        {phase === 'done' && (
          <Button
            variant="contained"
            onClick={() => {
              close();
              window.location.reload();
            }}
          >
            {t('Reload')}
          </Button>
        )}
        {busy && <Button disabled>{t('Please wait...')}</Button>}
      </DialogActions>
    </Dialog>
  );
}
