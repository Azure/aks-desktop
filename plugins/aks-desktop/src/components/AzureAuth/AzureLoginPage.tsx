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
import { trackError, trackFeature } from '../../telemetry';
import { getLoginStatus, initiateLogin } from '../../utils/azure/az-auth';
import {
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_REDIRECT_DELAY_MS,
  LOGIN_TIMEOUT_MS,
} from '../../utils/constants/timing';

interface AzureLoginPageProps {
  redirectTo?: string;
}

function safelyTrackFeature(properties: Parameters<typeof trackFeature>[0]) {
  try {
    trackFeature(properties);
  } catch {}
}

function safelyTrackError(properties: Parameters<typeof trackError>[0]) {
  try {
    trackError(properties);
  } catch {}
}

export default function AzureLoginPage({ redirectTo }: AzureLoginPageProps) {
  const history = useHistory();
  const { t } = useTranslation();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const loginAttemptRef = useRef(0);
  const terminalTrackedRef = useRef(false);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const trackTerminal = (
    status: 'succeeded' | 'failed' | 'cancelled',
    errorClass?: 'AuthenticationError' | 'TimeoutError'
  ) => {
    if (terminalTrackedRef.current) return;
    terminalTrackedRef.current = true;
    safelyTrackFeature({ feature: 'aksd.azure-login', status });
    if (errorClass) {
      safelyTrackError({ area: 'azure-login', errorClass, phase: 'failed' });
    }
  };

  // Get redirect target from URL query parameter or prop, fallback to profile page
  const getRedirectTarget = () => {
    const params = new URLSearchParams(location.search);
    const redirectParam = params.get('redirect');
    return redirectParam || redirectTo || '/azure/profile';
  };

  // Check if already logged in on mount
  useEffect(() => {
    mountedRef.current = true;
    safelyTrackFeature({ feature: 'aksd.azure-login', status: 'opened' });
    checkLoginStatus();
    return () => {
      mountedRef.current = false;
      loginAttemptRef.current++;
      stopPolling();
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
        redirectTimeoutRef.current = null;
      }
    };
  }, []);

  const checkLoginStatus = async () => {
    try {
      const status = await getLoginStatus();
      if (!mountedRef.current) return;
      if (status.isLoggedIn) {
        // Trigger update event for sidebar label
        window.dispatchEvent(new CustomEvent('azure-auth-update'));
        // Already logged in, redirect to original target
        const target = getRedirectTarget();
        history.push(target);
      }
    } catch (error) {
      console.error('Error checking login status:', error);
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  };

  const handleLogin = async () => {
    stopPolling();
    const attemptId = ++loginAttemptRef.current;
    terminalTrackedRef.current = false;
    safelyTrackFeature({ feature: 'aksd.azure-login', status: 'started' });
    setLoading(true);
    setErrorMessage('');
    setStatusMessage(`${t('Initiating Azure login')}...`);

    try {
      const result = await initiateLogin();
      if (!mountedRef.current || loginAttemptRef.current !== attemptId) return;

      if (!result.success) {
        trackTerminal('failed', 'AuthenticationError');
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
      let pollInFlight = false;
      const maxPolls = Math.ceil(LOGIN_TIMEOUT_MS / LOGIN_POLL_INTERVAL_MS);

      const isActiveAttempt = () =>
        mountedRef.current && loginAttemptRef.current === attemptId && !terminalTrackedRef.current;

      const finishWithTimeout = () => {
        stopPolling();
        trackTerminal('failed', 'TimeoutError');
        setErrorMessage(t('Login timeout. Please try again.'));
        setLoading(false);
      };

      const pollLoginStatus = async () => {
        if (!isActiveAttempt() || pollInFlight || pollCount >= maxPolls) return;
        pollInFlight = true;
        pollCount++;

        try {
          const status = await getLoginStatus();
          if (!isActiveAttempt()) return;

          if (status.isLoggedIn) {
            stopPolling();
            trackTerminal('succeeded');
            setStatusMessage(`${t('Login successful! Redirecting')}...`);

            // Trigger update event for sidebar label
            window.dispatchEvent(new CustomEvent('azure-auth-update'));

            // Wait a moment before redirecting
            redirectTimeoutRef.current = setTimeout(() => {
              if (!mountedRef.current || loginAttemptRef.current !== attemptId) return;
              const target = getRedirectTarget();
              history.push(target);
            }, LOGIN_REDIRECT_DELAY_MS);
          } else if (pollCount >= maxPolls) {
            finishWithTimeout();
          } else {
            const remaining = ((maxPolls - pollCount) * LOGIN_POLL_INTERVAL_MS) / 60_000;
            setStatusMessage(
              t('Waiting for login completion... ({{minutes}} minutes remaining)', {
                minutes: remaining.toFixed(1),
              })
            );
          }
        } catch (error) {
          console.error('Error polling login status:', error);
          if (isActiveAttempt() && pollCount >= maxPolls) {
            finishWithTimeout();
          }
        } finally {
          pollInFlight = false;
        }
      };

      pollingIntervalRef.current = setInterval(() => {
        void pollLoginStatus();
      }, LOGIN_POLL_INTERVAL_MS);
    } catch (error) {
      if (!mountedRef.current || loginAttemptRef.current !== attemptId) return;
      trackTerminal('failed', 'AuthenticationError');
      console.error('Error initiating login:', error);
      setErrorMessage(
        t('Failed to initiate login: {{message}}', {
          message: error instanceof Error ? error.message : t('Unknown error'),
        })
      );
      setLoading(false);
    }
  };

  const handleCancel = () => {
    loginAttemptRef.current++;
    stopPolling();
    trackTerminal('cancelled');
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
