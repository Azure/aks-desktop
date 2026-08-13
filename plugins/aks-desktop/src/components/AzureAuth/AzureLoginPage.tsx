// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useTelemetryFeatureOpened } from '../../hooks/useTelemetryFeatureOpened';
import { trackError } from '../../telemetry';
import { trackAksFeature } from '../../telemetry/aksFeature';
import { getLoginStatus, initiateLogin } from '../../utils/azure/az-auth';
import {
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_REDIRECT_DELAY_MS,
  LOGIN_TIMEOUT_MS,
} from '../../utils/constants/timing';

interface AzureLoginPageProps {
  redirectTo?: string;
}

type LoginAttemptOutcome = 'idle' | 'active' | 'succeeded' | 'failed' | 'cancelled';

function trackLoginFailure(errorClass: 'TimeoutError' | 'UnknownError') {
  trackAksFeature('aksd.auth-login', 'failed');
  try {
    trackError({ area: 'auth-login', errorClass, phase: 'failed' });
  } catch {}
}

export default function AzureLoginPage({ redirectTo }: AzureLoginPageProps) {
  useTelemetryFeatureOpened('aksd.auth-login');
  const history = useHistory();
  const { t } = useTranslation();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginAttemptOutcomeRef = useRef<LoginAttemptOutcome>('idle');
  const loginAttemptGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const isCurrentAttempt = (attemptGeneration: number) =>
    mountedRef.current && loginAttemptGenerationRef.current === attemptGeneration;

  const isActiveAttempt = (attemptGeneration: number) =>
    isCurrentAttempt(attemptGeneration) && loginAttemptOutcomeRef.current === 'active';

  // Get redirect target from URL query parameter or prop, fallback to profile page
  const getRedirectTarget = () => {
    const params = new URLSearchParams(location.search);
    const redirectParam = params.get('redirect');
    return redirectParam || redirectTo || '/azure/profile';
  };

  // Check if already logged in on mount
  useEffect(() => {
    mountedRef.current = true;
    checkLoginStatus();
    return () => {
      mountedRef.current = false;
      loginAttemptGenerationRef.current++;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    };
  }, []);

  const checkLoginStatus = async () => {
    try {
      const status = await getLoginStatus();
      if (!mountedRef.current) {
        return;
      }
      if (status.isLoggedIn) {
        // Trigger update event for sidebar label
        window.dispatchEvent(new CustomEvent('azure-auth-update'));
        // Already logged in, redirect to original target
        const target = getRedirectTarget();
        history.push(target);
      }
    } catch (error) {
      if (mountedRef.current) {
        console.error('Error checking login status:', error);
      }
    } finally {
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  };

  const handleLogin = async () => {
    const attemptGeneration = ++loginAttemptGenerationRef.current;
    loginAttemptOutcomeRef.current = 'active';
    trackAksFeature('aksd.auth-login', 'started');
    setLoading(true);
    setErrorMessage('');
    setStatusMessage(`${t('Initiating Azure login')}...`);

    try {
      const result = await initiateLogin();

      if (!isActiveAttempt(attemptGeneration)) {
        return;
      }

      if (!result.success) {
        loginAttemptOutcomeRef.current = 'failed';
        trackLoginFailure('UnknownError');
        setErrorMessage(result.message);
        setLoading(false);
        return;
      }

      setStatusMessage(
        t(
          'Please complete the authentication in your browser. This window will automatically redirect once login is complete.'
        )
      );

      // Start polling for login completion
      let pollCount = 0;
      const maxPolls = Math.ceil(LOGIN_TIMEOUT_MS / LOGIN_POLL_INTERVAL_MS);

      const interval = setInterval(async () => {
        if (!isActiveAttempt(attemptGeneration)) {
          clearInterval(interval);
          return;
        }
        pollCount++;

        try {
          const status = await getLoginStatus();

          if (!isActiveAttempt(attemptGeneration)) {
            clearInterval(interval);
            return;
          }

          if (status.isLoggedIn) {
            clearInterval(interval);
            pollingIntervalRef.current = null;
            loginAttemptOutcomeRef.current = 'succeeded';
            trackAksFeature('aksd.auth-login', 'succeeded');
            setStatusMessage(`${t('Login successful! Redirecting')}...`);

            // Trigger update event for sidebar label
            window.dispatchEvent(new CustomEvent('azure-auth-update'));

            // Wait a moment before redirecting
            redirectTimeoutRef.current = setTimeout(() => {
              if (
                isCurrentAttempt(attemptGeneration) &&
                loginAttemptOutcomeRef.current === 'succeeded'
              ) {
                const target = getRedirectTarget();
                history.push(target);
              }
            }, LOGIN_REDIRECT_DELAY_MS);
          } else if (pollCount >= maxPolls) {
            clearInterval(interval);
            pollingIntervalRef.current = null;
            loginAttemptOutcomeRef.current = 'failed';
            trackLoginFailure('TimeoutError');
            setErrorMessage(t('Login timeout. Please try again.'));
            setLoading(false);
          } else {
            const remaining = ((maxPolls - pollCount) * LOGIN_POLL_INTERVAL_MS) / 60_000;
            setStatusMessage(
              t('Waiting for login completion... ({{minutes}} minutes remaining)', {
                minutes: remaining.toFixed(1),
              })
            );
          }
        } catch (error) {
          if (!isActiveAttempt(attemptGeneration)) {
            clearInterval(interval);
            return;
          }
          console.error('Error polling login status:', error);
        }
      }, LOGIN_POLL_INTERVAL_MS);

      pollingIntervalRef.current = interval;
    } catch (error) {
      if (!isActiveAttempt(attemptGeneration)) {
        return;
      }
      console.error('Error initiating login:', error);
      loginAttemptOutcomeRef.current = 'failed';
      trackLoginFailure('UnknownError');
      setErrorMessage(
        t('Failed to initiate login: {{message}}', {
          message: error instanceof Error ? error.message : t('Unknown error'),
        })
      );
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (loginAttemptOutcomeRef.current !== 'active') {
      return;
    }
    loginAttemptGenerationRef.current++;
    loginAttemptOutcomeRef.current = 'cancelled';
    trackAksFeature('aksd.auth-login', 'cancelled');
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setLoading(false);
    setStatusMessage('');
    setErrorMessage('');
  };

  const rootSx = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bgcolor: 'background.default',
  };

  const containerSx = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
  };

  if (checking) {
    return (
      <Box sx={rootSx}>
        <Container sx={containerSx}>
          <CircularProgress />
          <Typography variant="body1">{t('Checking authentication status')}...</Typography>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={rootSx}>
      <Container sx={containerSx} maxWidth="sm">
        <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
          <CardContent>
            {loading && (
              <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={40} />
              </Box>
            )}

            <Box
              component={Icon}
              icon="logos:microsoft-azure"
              sx={{
                fontSize: 64,
                color: 'primary.main',
                mb: 2,
                display: 'block',
                mx: 'auto',
              }}
            />

            <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
              {t('Azure Authentication')}
            </Typography>

            <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
              {t('Sign in with your Azure account to manage AKS clusters and resources')}
            </Typography>

            {!loading ? (
              <Button
                variant="contained"
                color="primary"
                onClick={handleLogin}
                startIcon={<Icon icon="mdi:login" />}
                sx={{
                  minWidth: 200,
                  py: 1.5,
                  px: 4,
                  textTransform: 'none',
                  fontSize: 16,
                }}
              >
                {t('Sign in with Azure')}
              </Button>
            ) : (
              <Button
                variant="outlined"
                color="secondary"
                onClick={handleCancel}
                sx={{
                  minWidth: 200,
                  py: 1.5,
                  px: 4,
                  textTransform: 'none',
                  fontSize: 16,
                }}
              >
                {t('Cancel')}
              </Button>
            )}

            {statusMessage && (
              <Typography variant="body2" sx={{ mt: 2, color: 'info.main' }}>
                {statusMessage}
              </Typography>
            )}

            {errorMessage && (
              <Box sx={{ mt: 2, color: 'error.main' }}>
                <Typography
                  variant="body2"
                  component="div"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    textAlign: 'left',
                    fontFamily: errorMessage.includes('http') ? 'monospace' : 'inherit',
                  }}
                >
                  {errorMessage}
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
