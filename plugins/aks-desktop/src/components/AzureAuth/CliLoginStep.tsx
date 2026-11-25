// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { initiateCliLogin } from '../../utils/azure/az-auth';
import {
  allowCliOperations,
  blockCliOperations,
  isAzCliInstalled,
} from '../../utils/azure/az-cli-core';
import {
  allowAzureCliFallback,
  getNativeAuthGeneration,
  logoutNative,
} from '../../utils/azure/native-auth';

interface CliLoginStepProps {
  onContinue: () => void;
  onBack?: () => void;
  nativeAuthenticated?: boolean;
}

/** Offers a separate CLI sign-in for workflows that still use Azure CLI. */
export default function CliLoginStep({
  onContinue,
  onBack,
  nativeAuthenticated = true,
}: CliLoginStepProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<'checking' | 'ready' | 'pending' | 'failed' | 'unavailable'>(
    'checking'
  );
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const continued = useRef(false);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  const continueOnce = () => {
    if (continued.current) return;
    continued.current = true;
    onContinueRef.current();
  };

  const continueWithoutCli = () => {
    if (continued.current) return;
    blockCliOperations();
    continueOnce();
  };

  const goBack = () => {
    if (continued.current) return;
    continued.current = true;
    blockCliOperations();
    onBack?.();
  };

  const signIn = async () => {
    if (pending.current) return;
    pending.current = true;
    setState('pending');
    setError('');
    try {
      if (!nativeAuthenticated) {
        const persisted = await logoutNative();
        if (!mounted.current || continued.current) return;
        if (!persisted) {
          throw new Error(
            'Azure sign-out policy could not be saved. Enable application storage and retry.'
          );
        }
      }
      const generation = getNativeAuthGeneration();
      const result = await initiateCliLogin();
      if (!mounted.current || continued.current) return;
      if (generation !== getNativeAuthGeneration()) {
        setError('Azure account changed during CLI sign-in. Please retry.');
        setState('failed');
        return;
      }
      if (result.success) {
        if (!nativeAuthenticated) allowAzureCliFallback();
        allowCliOperations();
        continueOnce();
      } else {
        setError(result.message);
        setState('failed');
      }
    } catch (error) {
      if (!mounted.current || continued.current) return;
      setError(error instanceof Error ? error.message : 'Azure CLI sign-in failed.');
      setState('failed');
    } finally {
      pending.current = false;
    }
  };

  useEffect(() => {
    mounted.current = true;
    blockCliOperations();
    isAzCliInstalled().then(installed => {
      if (!mounted.current || continued.current) return;
      if (installed && nativeAuthenticated) setState('ready');
      else if (installed) void signIn();
      else if (nativeAuthenticated) continueWithoutCli();
      else setState('unavailable');
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  if (state === 'checking') {
    return (
      <Box>
        <Typography>{t('Checking Azure CLI availability')}...</Typography>
        {nativeAuthenticated ? (
          <Button onClick={continueWithoutCli}>{t('Continue without Azure CLI')}</Button>
        ) : (
          <Button onClick={goBack}>{t('Back')}</Button>
        )}
      </Box>
    );
  }

  if (state === 'unavailable') {
    return (
      <Box>
        <Typography role="alert">{t('Azure CLI is not available.')}</Typography>
        <Button onClick={goBack}>{t('Back')}</Button>
      </Box>
    );
  }

  return (
    <Box>
      <Typography sx={{ mb: 2 }}>
        {nativeAuthenticated
          ? t(
              'Sign in to Azure CLI with the same account to use CLI-dependent features. Your selected Azure CLI cloud will be used.'
            )
          : t('Sign in with Azure CLI using your selected Azure CLI cloud.')}
      </Typography>
      {nativeAuthenticated && (
        <Typography sx={{ mb: 2 }}>
          {t(
            'If Azure CLI uses a different cloud, select the same cloud in Azure CLI before retrying. AKS Desktop will not change your Azure CLI cloud.'
          )}
        </Typography>
      )}
      {state === 'pending' ? (
        <Box role="status">
          <CircularProgress size={24} />
          <Typography>
            {t('Complete Azure CLI sign-in in your browser. This may take a few minutes.')}
          </Typography>
          <Typography>
            {t(
              'Azure CLI sign-in cannot be cancelled and may change the CLI account after you leave this page.'
            )}
          </Typography>
          {nativeAuthenticated ? (
            <Button onClick={continueWithoutCli}>
              {t('Continue without waiting for Azure CLI')}
            </Button>
          ) : (
            <Button onClick={goBack}>{t('Back')}</Button>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Button variant="contained" onClick={signIn}>
            {state === 'failed' ? t('Retry Azure CLI sign-in') : t('Sign in to Azure CLI')}
          </Button>
          {nativeAuthenticated ? (
            <Button variant="outlined" onClick={continueWithoutCli}>
              {t('Continue without Azure CLI')}
            </Button>
          ) : (
            <Button variant="outlined" onClick={goBack}>
              {t('Back')}
            </Button>
          )}
        </Box>
      )}
      {error && (
        <Typography role="alert" sx={{ mt: 2, whiteSpace: 'pre-wrap', color: 'error.main' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
