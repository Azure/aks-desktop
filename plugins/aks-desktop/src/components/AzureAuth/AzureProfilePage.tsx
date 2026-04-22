// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, Card, CircularProgress, Container, Typography } from '@mui/material';
import React from 'react';
import { useAzureProfilePage } from './hooks/useAzureProfilePage';

const pageSx = { minHeight: '100vh', backgroundColor: 'background.default', pt: 2 } as const;
const infoBoxSx = {
  mb: 3,
  p: 2,
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  textAlign: 'left',
} as const;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={infoBoxSx}>
      <Typography variant="caption" sx={{ fontWeight: 600, mb: 0.5, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontSize: '1rem', wordBreak: 'break-all' }}>
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Azure Profile page.
 *
 * Displays the logged-in user's Azure account details and provides actions to
 * add a cluster or log out. Redirects to `/azure/login` when the user is not
 * authenticated.
 *
 * All stateful logic (auth state, logout flow, navigation, redirect guard)
 * lives in {@link useAzureProfilePage}.
 */
export default function AzureProfilePage() {
  const { t } = useTranslation();
  const {
    isChecking,
    isLoggedIn,
    username,
    tenantId,
    subscriptionId,
    loggingOut,
    handleBack,
    handleAddCluster,
    handleLogout,
  } = useAzureProfilePage();

  if (isChecking) {
    return (
      <Box sx={pageSx}>
        <Container maxWidth="sm">
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '50vh',
            }}
          >
            <CircularProgress />
            <Typography variant="body1" sx={{ mt: 2 }}>
              {t('Loading Azure account information')}...
            </Typography>
          </Box>
        </Container>
      </Box>
    );
  }

  // Don't render anything if not logged in (will redirect)
  if (!isLoggedIn) {
    return null;
  }

  return (
    <Box sx={pageSx}>
      <Container maxWidth="sm">
        <Button
          variant="text"
          onClick={handleBack}
          startIcon={<Icon icon="mdi:chevron-left" height={20} width={20} aria-hidden="true" />}
          sx={{
            mb: 3,
            color: 'text.secondary',
            textTransform: 'uppercase',
            fontSize: 14,
            '&:hover': { color: 'primary.main' },
          }}
        >
          {t('Back')}
        </Button>

        <Card sx={{ textAlign: 'center', p: 4 }}>
          <Box
            component={Icon}
            icon="logos:microsoft-azure"
            aria-hidden="true"
            sx={{
              fontSize: 64,
              color: 'primary.main',
              mb: 2,
              display: 'block',
              mx: 'auto',
            }}
          />

          <Typography variant="h4" sx={{ mb: 1, fontWeight: 600 }}>
            {t('Azure Account')}
          </Typography>

          <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
            {t('Logged in as')} <strong>{username}</strong>
          </Typography>

          {tenantId && <InfoRow label="Tenant ID" value={tenantId} />}

          {subscriptionId && <InfoRow label="Default Subscription ID" value={subscriptionId} />}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleAddCluster}
              startIcon={<Icon icon="mdi:cloud-plus" aria-hidden="true" />}
              sx={{ p: 1.5, textTransform: 'none', fontSize: 16 }}
            >
              {t('Add Cluster from Azure')}
            </Button>

            <Button
              variant="outlined"
              color="primary"
              onClick={handleLogout}
              disabled={loggingOut}
              startIcon={
                loggingOut ? (
                  <CircularProgress size={20} aria-hidden="true" />
                ) : (
                  <Icon icon="mdi:logout" aria-hidden="true" />
                )
              }
              sx={{ p: 1.5, textTransform: 'none', fontSize: 16 }}
            >
              {loggingOut ? `${t('Logging out')}...` : t('Log out')}
            </Button>
          </Box>
        </Card>
      </Container>
    </Box>
  );
}
