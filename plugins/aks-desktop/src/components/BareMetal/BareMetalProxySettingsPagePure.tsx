// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Container,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import type { AKSCluster, Subscription } from '../../utils/azure/aks';
import BareMetalProxyPanel from './BareMetalProxyPanel';
import type { BareMetalProxyStatus } from './proxy';

/** Props for the pure (presentational) BareMetal proxy settings page. */
export interface BareMetalProxySettingsPagePureProps {
  /** Whether Azure subscriptions are currently loading. */
  loadingSubscriptions: boolean;
  /** Whether BareMetal clusters are currently loading. */
  loadingClusters: boolean;
  /** General error message to display, e.g. subscription/cluster load failure. */
  error: string;
  /** Proxy-specific UI error message. */
  proxyUiError: string;
  /** Whether the proxy connection was unexpectedly dropped. */
  proxyDropped: boolean;
  /** Available Azure subscriptions. */
  subscriptions: Subscription[];
  /** Currently selected subscription, or null if none. */
  selectedSubscription: Subscription | null;
  /** Available BareMetal (aksarc) clusters for the selected subscription. */
  clusters: AKSCluster[];
  /** Currently selected cluster, or null if none. */
  selectedCluster: AKSCluster | null;
  /** Current proxy status, or null when unknown. */
  proxyStatus: BareMetalProxyStatus | null;
  /** Whether a proxy action (start/stop/restart) is in progress. */
  proxyActionLoading: boolean;
  /** Called when the user selects a different subscription. */
  onSubscriptionChange: (value: Subscription | null) => void;
  /** Called when the user selects a different cluster. */
  onClusterChange: (value: AKSCluster | null) => void;
  /** Called when the user clicks Start Proxy. */
  onProxyStart: () => void;
  /** Called when the user clicks Stop Proxy. */
  onProxyStop: () => void;
  /** Called when the user clicks Restart Proxy. */
  onProxyRestart: () => void;
  /** Called when the user clicks Refresh Status. */
  onProxyRefresh: () => void;
  /** Called when the user dismisses the proxy-dropped warning. */
  onDismissProxyDropped: () => void;
  /** Called when the user clicks Open Proxy Controls in the dropped alert. */
  onOpenRegisterControls: () => void;
  /** Called when the user clicks the Back button. */
  onBack: () => void;
}

export default function BareMetalProxySettingsPagePure({
  loadingSubscriptions,
  loadingClusters,
  error,
  proxyUiError,
  proxyDropped,
  subscriptions,
  selectedSubscription,
  clusters,
  selectedCluster,
  proxyStatus,
  proxyActionLoading,
  onSubscriptionChange,
  onClusterChange,
  onProxyStart,
  onProxyStop,
  onProxyRestart,
  onProxyRefresh,
  onDismissProxyDropped,
  onOpenRegisterControls,
  onBack,
}: BareMetalProxySettingsPagePureProps) {
  const { t } = useTranslation();

  return (
    <Box component="main" sx={{ minHeight: '100vh', backgroundColor: 'background.default', pt: 2 }}>
      <Container maxWidth="md">
        <Button
          variant="text"
          onClick={onBack}
          startIcon={<Icon icon="mdi:chevron-left" height={20} width={20} aria-hidden="true" />}
          sx={{ mb: 3, color: 'text.secondary', textTransform: 'uppercase', fontSize: 14 }}
        >
          {t('Back')}
        </Button>

        <Card sx={{ p: 3 }}>
          <Box display="flex" alignItems="center" gap={1} sx={{ mb: 2 }}>
            <Typography variant="h5" component="h1">
              {t('BareMetal Proxy')}
            </Typography>
            <Chip label={t('Preview')} size="small" color="warning" variant="outlined" />
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {proxyUiError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {proxyUiError}
            </Alert>
          )}

          {proxyDropped && selectedCluster && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              onClose={onDismissProxyDropped}
              action={
                <Box display="flex" gap={1}>
                  <Button color="inherit" size="small" onClick={onProxyRestart}>
                    {t('Restart Proxy')}
                  </Button>
                  <Button color="inherit" size="small" onClick={onOpenRegisterControls}>
                    {t('Open Proxy Controls')}
                  </Button>
                </Box>
              }
            >
              {t('BareMetal proxy disconnected')}
            </Alert>
          )}

          <Box display="flex" flexDirection="column" gap={2}>
            <Autocomplete
              options={subscriptions}
              value={selectedSubscription}
              onChange={(_e, value) => onSubscriptionChange(value)}
              getOptionLabel={option => option.name}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              loading={loadingSubscriptions}
              renderInput={params => (
                <TextField
                  {...params}
                  label={t('Subscription')}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingSubscriptions ? (
                          <CircularProgress color="inherit" size={20} aria-hidden="true" />
                        ) : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <Autocomplete
              options={clusters}
              value={selectedCluster}
              onChange={(_e, value) => onClusterChange(value)}
              getOptionLabel={option => option.name}
              isOptionEqualToValue={(option, value) =>
                option.name === value.name && option.resourceGroup === value.resourceGroup
              }
              loading={loadingClusters}
              disabled={!selectedSubscription}
              renderInput={params => (
                <TextField
                  {...params}
                  label={t('BareMetal cluster')}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingClusters ? (
                          <CircularProgress color="inherit" size={20} aria-hidden="true" />
                        ) : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            {!loadingClusters && selectedSubscription && clusters.length === 0 && (
              <Alert severity="info">
                {t('No BareMetal clusters found in this subscription.')}
              </Alert>
            )}

            {selectedCluster && (
              <BareMetalProxyPanel
                panelId="baremetal-proxy-controls"
                proxyStatus={proxyStatus}
                proxyActionLoading={proxyActionLoading}
                disabled={false}
                onProxyStart={onProxyStart}
                onProxyStop={onProxyStop}
                onProxyRestart={onProxyRestart}
                onProxyRefresh={onProxyRefresh}
              />
            )}
          </Box>
        </Card>
      </Container>
    </Box>
  );
}
