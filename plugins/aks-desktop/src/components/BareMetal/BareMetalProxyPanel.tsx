// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Typography } from '@mui/material';
import React from 'react';
import type { BareMetalProxyStatus } from './proxy';

/** Props for the BareMetal proxy control panel. */
export interface BareMetalProxyPanelProps {
  /** Optional HTML id for the panel section element. */
  panelId?: string;
  /** Current proxy status, or null when status is unknown. */
  proxyStatus: BareMetalProxyStatus | null;
  /** Whether a proxy action (start/stop/restart) is currently in progress. */
  proxyActionLoading: boolean;
  /** When true, all action buttons are disabled. */
  disabled: boolean;
  /** Called when the user clicks Start Proxy. */
  onProxyStart: () => void;
  /** Called when the user clicks Stop Proxy. */
  onProxyStop: () => void;
  /** Called when the user clicks Restart Proxy. */
  onProxyRestart: () => void;
  /** Called when the user clicks Refresh Status. */
  onProxyRefresh: () => void;
}

export default function BareMetalProxyPanel({
  panelId,
  proxyStatus,
  proxyActionLoading,
  disabled,
  onProxyStart,
  onProxyStop,
  onProxyRestart,
  onProxyRefresh,
}: BareMetalProxyPanelProps) {
  const { t } = useTranslation();
  const titleId = `${panelId || 'baremetal-proxy-panel'}-title`;

  return (
    <Box
      component="section"
      id={panelId}
      aria-labelledby={titleId}
      tabIndex={panelId ? -1 : undefined}
      p={2}
      border={1}
      borderColor="divider"
      borderRadius={1}
    >
      <Typography id={titleId} variant="subtitle2" component="h2" gutterBottom>
        {t('Proxy')}
      </Typography>

      <Typography variant="body2" sx={{ mb: 1 }} role="status" aria-live="polite">
        <strong>{t('Status')}:</strong>{' '}
        {proxyStatus?.status ? proxyStatus.status.toUpperCase() : t('Unknown')}
        {proxyStatus?.pid ? ` (PID ${proxyStatus.pid})` : ''}
      </Typography>

      {proxyStatus?.lastError && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {proxyStatus.lastError}
        </Alert>
      )}

      <Box display="flex" gap={1} flexWrap="wrap">
        <Button
          variant="outlined"
          onClick={onProxyStart}
          disabled={proxyActionLoading || disabled}
          startIcon={<Icon icon="mdi:play" aria-hidden="true" />}
        >
          {t('Start Proxy')}
        </Button>
        <Button
          variant="outlined"
          onClick={onProxyStop}
          disabled={proxyActionLoading || disabled}
          startIcon={<Icon icon="mdi:stop" aria-hidden="true" />}
        >
          {t('Stop Proxy')}
        </Button>
        <Button
          variant="outlined"
          onClick={onProxyRestart}
          disabled={proxyActionLoading || disabled}
          startIcon={<Icon icon="mdi:restart" aria-hidden="true" />}
        >
          {t('Restart Proxy')}
        </Button>
        <Button
          variant="text"
          onClick={onProxyRefresh}
          disabled={proxyActionLoading || disabled}
          startIcon={<Icon icon="mdi:refresh" aria-hidden="true" />}
        >
          {t('Refresh Status')}
        </Button>
      </Box>
    </Box>
  );
}
