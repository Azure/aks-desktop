// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { ComputeStep } from '../CreateAKSProject/components/ComputeStep';
import { NetworkingStep } from '../CreateAKSProject/components/NetworkingStep';
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
    /** The managed namespace name used as the project identifier. */
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
    error,
    namespaceDetails,
    formData,
    validation,
    hasChanges,
    handleFormDataChange,
    handleSave,
    handleRefresh,
  } = useInfoTab(project);

  return (
    <Card>
      <CardContent sx={{ minHeight: loading ? '100vh' : 'auto' }}>
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
            <CircularProgress />
          </Box>
        )}
        {!loading && error && <Typography color="error">{error}</Typography>}

        {!loading && !error && namespaceDetails && (
          <Box>
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
                <Tooltip title={t('Refreshing data in background')}>
                  <CircularProgress size={16} />
                </Tooltip>
              )}
              <Button
                variant="outlined"
                onClick={handleRefresh}
                disabled={revalidating || updating}
              >
                {t('Refresh')}
              </Button>
              <Button
                variant="contained"
                color="primary"
                disabled={!project.id || !hasChanges || !validation.isValid || updating}
                onClick={handleSave}
              >
                {updating ? `${t('Updating')}...` : t('Update')}
              </Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default InfoTab;
