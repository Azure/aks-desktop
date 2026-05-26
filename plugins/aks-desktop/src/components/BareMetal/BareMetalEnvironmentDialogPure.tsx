// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { BAREMETAL_ENV_DEFAULTS } from './environment';
import type { BareMetalExtensionStatus } from './useBareMetalExtensionCheck';

/** Props for the pure (presentational) BareMetal environment setup dialog. */
export interface BareMetalEnvironmentDialogPureProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Whether the user is currently logged in to Azure. */
  isLoggedIn: boolean;
  /** Whether an Azure auth check is in progress. */
  isChecking: boolean;
  /** Current form values. */
  formData: {
    subscription: string;
    groupName: string;
    location: string;
    username: string;
    password: string;
    vmName: string;
  };
  /** Whether a setup or teardown operation is in progress. */
  loading: boolean;
  /** Which operation is running, if any. */
  loadingAction: 'setup' | 'teardown' | null;
  /** Error message from the last operation. */
  error: string;
  /** Success message from the last operation. */
  success: string;
  /** Status of required CLI extensions. */
  extensionStatus: BareMetalExtensionStatus;
  /** Called when the dialog is closed. */
  onClose: () => void;
  /** Called when a form field value changes. */
  onChange: (field: string, value: string) => void;
  /** Called when the user clicks the Setup button. */
  onSetup: () => void;
  /** Called when the user clicks the Teardown button. */
  onTeardown: () => void;
  /** Called when the user dismisses an error alert. */
  onDismissError: () => void;
  /** Called when the user dismisses a success alert. */
  onDismissSuccess: () => void;
  /** Called when the user clicks Install Extensions. */
  onInstallExtensions: () => void;
}

export default function BareMetalEnvironmentDialogPure({
  open,
  isLoggedIn,
  isChecking,
  formData,
  loading,
  loadingAction,
  error,
  success,
  extensionStatus,
  onClose,
  onChange,
  onSetup,
  onTeardown,
  onDismissError,
  onDismissSuccess,
  onInstallExtensions,
}: BareMetalEnvironmentDialogPureProps) {
  const { t } = useTranslation();

  const isFormValid =
    formData.subscription.trim() !== '' &&
    formData.location.trim() !== '' &&
    formData.username.trim() !== '' &&
    formData.password.trim() !== '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="baremetal-env-dialog-title"
    >
      <DialogTitle id="baremetal-env-dialog-title" component="h1">
        <Box display="flex" alignItems="center" gap={1}>
          <Icon icon="logos:microsoft-azure" style={{ fontSize: '24px' }} aria-hidden="true" />
          <Typography variant="h6" component="span">
            {t('BareMetal Test Environment')}
          </Typography>
          <Chip label={t('Preview')} size="small" color="warning" variant="outlined" />
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} pt={1}>
          {error && (
            <Alert severity="error" onClose={onDismissError}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" onClose={onDismissSuccess}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                {success}
              </Typography>
            </Alert>
          )}

          {isChecking && (
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={20} aria-hidden="true" />
              <Typography variant="body2" color="textSecondary">
                {t('Checking authentication status')}...
              </Typography>
            </Box>
          )}

          {!isChecking && !isLoggedIn && (
            <Alert severity="warning">
              {t('You need to be logged in to Azure to manage BareMetal test environments.')}
            </Alert>
          )}

          {/* Extension check — reuses existing install UX pattern */}
          {extensionStatus.installed === false && (
            <Alert
              severity="warning"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={onInstallExtensions}
                  disabled={extensionStatus.installing}
                  aria-busy={extensionStatus.installing || undefined}
                >
                  {extensionStatus.installing ? (
                    <Box display="flex" alignItems="center" gap={1}>
                      <CircularProgress size={16} color="inherit" aria-hidden="true" />
                      {`${t('Installing')}...`}
                    </Box>
                  ) : (
                    t('Install Extensions')
                  )}
                </Button>
              }
            >
              <Typography variant="body2">
                <strong>{t('CLI Extensions Required')}:</strong>{' '}
                {t(
                  'The connectedk8s and aksarc extensions are required for BareMetal cluster management.'
                )}
              </Typography>
              {extensionStatus.error && (
                <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
                  {extensionStatus.error}
                </Typography>
              )}
            </Alert>
          )}

          {extensionStatus.showSuccess && (
            <Alert severity="success">
              {'✓ ' + t('BareMetal CLI extensions installed successfully!')}
            </Alert>
          )}

          {!isChecking && isLoggedIn && (
            <>
              <Typography variant="body2" color="textSecondary">
                {t(
                  'Set up or tear down an AKS BareMetal test environment using the aksArc jumpstart. ' +
                    'This creates a Windows Server VM with nested Hyper-V for AKS BareMetal testing.'
                )}
              </Typography>

              <TextField
                label={t('Subscription ID')}
                value={formData.subscription}
                onChange={e => onChange('subscription', e.target.value)}
                fullWidth
                required
                disabled={loading}
                placeholder="00000000-0000-0000-0000-000000000000"
              />

              <TextField
                label={t('Resource Group')}
                value={formData.groupName}
                onChange={e => onChange('groupName', e.target.value)}
                fullWidth
                disabled={loading}
                placeholder={BAREMETAL_ENV_DEFAULTS.groupName}
                helperText={t('Defaults to "{{default}}" if left empty', {
                  default: BAREMETAL_ENV_DEFAULTS.groupName,
                })}
              />

              <TextField
                label={t('Location')}
                value={formData.location}
                onChange={e => onChange('location', e.target.value)}
                fullWidth
                required
                disabled={loading}
                placeholder="eastus"
              />

              <TextField
                label={t('VM Admin Username')}
                value={formData.username}
                onChange={e => onChange('username', e.target.value)}
                fullWidth
                required
                disabled={loading}
              />

              <TextField
                label={t('VM Admin Password')}
                value={formData.password}
                onChange={e => onChange('password', e.target.value)}
                fullWidth
                required
                disabled={loading}
                type="password"
              />

              <TextField
                label={t('VM Name')}
                value={formData.vmName}
                onChange={e => onChange('vmName', e.target.value)}
                fullWidth
                disabled={loading}
                placeholder={BAREMETAL_ENV_DEFAULTS.vmName}
                helperText={t('Defaults to "{{default}}" if left empty', {
                  default: BAREMETAL_ENV_DEFAULTS.vmName,
                })}
              />
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          {t('Cancel')}
        </Button>
        <Button
          onClick={onTeardown}
          color="error"
          variant="outlined"
          disabled={!isLoggedIn || loading || !formData.subscription.trim()}
          startIcon={
            loading && loadingAction === 'teardown' ? (
              <CircularProgress size={20} aria-hidden="true" />
            ) : (
              <Icon icon="mdi:delete" aria-hidden="true" />
            )
          }
          aria-busy={(loading && loadingAction === 'teardown') || undefined}
        >
          {loading && loadingAction === 'teardown'
            ? `${t('Tearing down')}...`
            : t('Teardown Environment')}
        </Button>
        <Button
          onClick={onSetup}
          variant="contained"
          color="primary"
          disabled={!isLoggedIn || loading || !isFormValid}
          startIcon={
            loading && loadingAction === 'setup' ? (
              <CircularProgress size={20} aria-hidden="true" />
            ) : (
              <Icon icon="mdi:rocket-launch" aria-hidden="true" />
            )
          }
          aria-busy={(loading && loadingAction === 'setup') || undefined}
        >
          {loading && loadingAction === 'setup' ? `${t('Setting up')}...` : t('Setup Environment')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
