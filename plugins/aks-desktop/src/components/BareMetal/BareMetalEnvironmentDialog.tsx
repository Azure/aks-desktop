// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useCallback, useEffect, useState } from 'react';
import { useAzureAuth } from '../../hooks/useAzureAuth';
import BareMetalEnvironmentDialogPure from './BareMetalEnvironmentDialogPure';
import {
  BAREMETAL_ENV_DEFAULTS,
  type BareMetalEnvironmentConfig,
  setupBareMetalEnvironment,
  teardownBareMetalEnvironment,
} from './environment';
import { useBareMetalExtensionCheck } from './useBareMetalExtensionCheck';

interface BareMetalEnvironmentDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function BareMetalEnvironmentDialog({
  open,
  onClose,
}: BareMetalEnvironmentDialogProps) {
  const { t } = useTranslation();
  const authStatus = useAzureAuth();
  const extensionCheck = useBareMetalExtensionCheck();

  const [formData, setFormData] = useState({
    subscription: '',
    groupName: '',
    location: 'eastus',
    username: '',
    password: '',
    vmName: '',
  });
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'setup' | 'teardown' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Check extensions when dialog opens
  useEffect(() => {
    if (open) {
      extensionCheck.checkExtensions();
    }
  }, [open, extensionCheck.checkExtensions]);

  const handleChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSetup = useCallback(async () => {
    setLoading(true);
    setLoadingAction('setup');
    setError('');
    setSuccess('');

    try {
      const config: BareMetalEnvironmentConfig = {
        subscription: formData.subscription.trim(),
        groupName: formData.groupName.trim() || BAREMETAL_ENV_DEFAULTS.groupName,
        location: formData.location.trim(),
        username: formData.username.trim(),
        password: formData.password,
        vmName: formData.vmName.trim() || BAREMETAL_ENV_DEFAULTS.vmName,
      };

      const result = await setupBareMetalEnvironment(config);
      if (result.success) {
        setSuccess(result.message);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(
        t('Setup failed: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  }, [formData, t]);

  const handleTeardown = useCallback(async () => {
    setLoading(true);
    setLoadingAction('teardown');
    setError('');
    setSuccess('');

    try {
      const groupName = formData.groupName.trim() || BAREMETAL_ENV_DEFAULTS.groupName;
      const result = await teardownBareMetalEnvironment(formData.subscription.trim(), groupName);

      if (result.success) {
        setSuccess(result.message);
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(
        t('Teardown failed: {{message}}', {
          message: err instanceof Error ? err.message : t('Unknown error'),
        })
      );
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  }, [formData, t]);

  return (
    <BareMetalEnvironmentDialogPure
      open={open}
      isLoggedIn={authStatus.isLoggedIn}
      isChecking={authStatus.isChecking}
      formData={formData}
      loading={loading}
      loadingAction={loadingAction}
      error={error}
      success={success}
      extensionStatus={extensionCheck}
      onClose={onClose}
      onChange={handleChange}
      onSetup={handleSetup}
      onTeardown={handleTeardown}
      onDismissError={() => setError('')}
      onDismissSuccess={() => setSuccess('')}
      onInstallExtensions={extensionCheck.installExtensions}
    />
  );
}
