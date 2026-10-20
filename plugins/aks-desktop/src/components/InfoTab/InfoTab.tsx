// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, CircularProgress, Divider, Typography } from '@mui/material';
import React from 'react';
import { ComputeStep } from '../shared/ComputeStep';
import { NetworkingStep } from '../shared/NetworkingStep';
import { useInfoTab } from './hooks/useInfoTab';

/**
 * Props for the {@link InfoTab} component.
 */
interface InfoTabProps {
  /** The project whose networking and compute quota settings are displayed and edited. */
  project: {
    /** Cluster names associated with the project; the first entry is used for API calls. */
    clusters: string[];
    /** Kubernetes namespace names associated with the project; the first entry is used. */
    namespaces: string[];
    /** Project identifier, which may differ from the namespace name. */
    id: string;
  };
}

/**
 * Displays and allows editing of the networking policies and compute quota for a managed namespace.
 *
 * Fetches current settings from the Azure CLI and pre-populates the form. Provides a save
 * button that is enabled only when there are valid, unsaved changes.
 *
 * @param props.project - The project whose settings are managed.
 */
const InfoTab: React.FC<InfoTabProps> = ({ project }) => {
  const { t } = useTranslation();
  const {
    loading,
    revalidating,
    updating,
    resolvingTarget,
    canRefresh,
    error,
    saveError,
    namespaceDetails,
    formData,
    validation,
    hasChanges,
    hasRemoteChanges,
    handleFormDataChange,
    handleSave,
    handleRefresh,
  } = useInfoTab(project);

  return (
    <Box sx={{ minHeight: loading ? '100vh' : 'auto', p: 3 }}>
      {loading && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            py: 4,
            height: '100%',
          }}
        >
          <CircularProgress aria-label={t('Loading namespace settings')} />
        </Box>
      )}
      {!loading && error && (
        <Alert severity={namespaceDetails ? 'warning' : 'error'} sx={{ mb: 2 }}>
          {error}
          <Button onClick={handleRefresh} disabled={!canRefresh || revalidating || updating}>
            {t('Retry')}
          </Button>
        </Alert>
      )}
      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError}
        </Alert>
      )}

      {!loading && namespaceDetails && (
        <Box>
          {hasRemoteChanges && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('Settings changed on the server. Your unsaved changes have been kept.')}
            </Alert>
          )}
          <Box sx={{ mb: 3 }}>
            <NetworkingStep
              formData={formData}
              onFormDataChange={handleFormDataChange}
              validation={validation}
            />
          </Box>
          <Divider sx={{ my: 2 }} />
          <Box>
            <ComputeStep
              formData={formData}
              onFormDataChange={handleFormDataChange}
              validation={validation}
            />
          </Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 1,
              mt: 3,
            }}
          >
            {revalidating && (
              <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} aria-hidden="true" />
                <Typography variant="body2">{t('Refreshing data in background')}</Typography>
              </Box>
            )}
            <Button
              variant="outlined"
              onClick={handleRefresh}
              disabled={!canRefresh || revalidating || updating}
              aria-busy={revalidating}
            >
              {t('Refresh')}
            </Button>
            <Button
              variant="contained"
              color="primary"
              disabled={!hasChanges || !validation.isValid || updating || resolvingTarget}
              onClick={handleSave}
            >
              {updating ? `${t('Updating')}...` : t('Update')}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default InfoTab;
