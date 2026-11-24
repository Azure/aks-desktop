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
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useTelemetryFeatureOpened } from '../../hooks/useTelemetryFeatureOpened';
import { trackError } from '../../telemetry';
import { trackAksFeature } from '../../telemetry/aksFeature';
import { getLoginStatus, getNativeLoginStatus, initiateLogin } from '../../utils/azure/az-auth';
import type { NativeCloudName } from '../../utils/azure/azure-cloud-config';
import {
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_RETRY_DELAY_MS,
  LOGIN_TIMEOUT_MS,
} from '../../utils/constants/timing';
import CliLoginStep from './CliLoginStep';

interface AzureLoginPageProps {
  /** Route to open after authentication when no redirect query parameter is set. */
  redirectTo?: string;
}

type LoginAttemptOutcome = 'idle' | 'active' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Records a terminal Azure login failure without exposing error details.
 *
 * @param errorClass - Privacy-safe category for the login failure.
 * @returns Nothing.
 */
function trackLoginFailure(errorClass: 'TimeoutError' | 'UnknownError') {
  trackAksFeature('aksd.auth-login', 'failed');
  try {
    trackError({ area: 'auth-login', errorClass, phase: 'failed' });
  } catch {}
}

/**
 * Starts native Azure authentication and offers Azure CLI sign-in.
 *
 * @param props - Login page configuration.
 * @param props.redirectTo - Fallback route to open after authentication.
 * @returns Azure authentication page.
 */
export default function AzureLoginPage({ redirectTo }: AzureLoginPageProps) {
  useTelemetryFeatureOpened('aksd.auth-login');
  const history = useHistory();
  const { t } = useTranslation();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [loginPrompt, setLoginPrompt] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showRetry, setShowRetry] = useState(false);
  const [cliLoginMode, setCliLoginMode] = useState<'native' | 'cli-only' | null>(null);
  const [selectedCloud, setSelectedCloud] = useState<NativeCloudName | ''>('');
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loginAttemptOutcomeRef = useRef<LoginAttemptOutcome>('idle');
  const loginAttemptGenerationRef = useRef(0);
  const loginAbortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  /**
   * Checks whether an asynchronous result belongs to the latest mounted attempt.
   *
   * @param attemptGeneration - Generation captured when the attempt started.
   * @returns Whether the attempt is current and the page is mounted.
   */
  const isCurrentAttempt = (attemptGeneration: number) =>
    mountedRef.current && loginAttemptGenerationRef.current === attemptGeneration;

  /**
   * Checks whether an asynchronous result belongs to the active login attempt.
   *
   * @param attemptGeneration - Generation captured when the attempt started.
   * @returns Whether the attempt is current, mounted, and active.
   */
  const isActiveAttempt = (attemptGeneration: number) =>
    isCurrentAttempt(attemptGeneration) && loginAttemptOutcomeRef.current === 'active';

  /**
   * Cancels the timeout that schedules the next account-status poll.
   *
   * @returns Nothing.
   */
  const clearPollingTimeout = () => {
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  };

  /**
   * Cancels the timeout that bounds the complete login attempt.
   *
   * @returns Nothing.
   */
  const clearLoginTimeout = () => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
  };

  /**
   * Cancels the timeout that reveals the retry action.
   *
   * @returns Nothing.
   */
  const clearLoginRetryTimeout = () => {
    if (loginRetryTimeoutRef.current) {
      clearTimeout(loginRetryTimeoutRef.current);
      loginRetryTimeoutRef.current = null;
    }
  };

  /**
   * Marks an active attempt as timed out and resets its UI state.
   *
   * @param attemptGeneration - Generation captured when the attempt started.
   * @returns Nothing.
   */
  const handleLoginTimeout = (attemptGeneration: number) => {
    if (!isActiveAttempt(attemptGeneration)) {
      return;
    }
    clearPollingTimeout();
    clearLoginRetryTimeout();
    clearLoginTimeout();
    loginAttemptOutcomeRef.current = 'failed';
    loginAbortControllerRef.current?.abort();
    loginAbortControllerRef.current = null;
    trackLoginFailure('TimeoutError');
    setStatusMessage('');
    setLoginPrompt('');
    setErrorMessage(t('Login timeout. Please try again.'));
    setLoading(false);
    setShowRetry(false);
  };

  /**
   * Starts or restarts the timeout that bounds a login attempt.
   *
   * @param attemptGeneration - Generation captured when the attempt started.
   * @returns Nothing.
   */
  const startLoginTimeout = (attemptGeneration: number) => {
    clearLoginTimeout();
    loginTimeoutRef.current = setTimeout(
      () => handleLoginTimeout(attemptGeneration),
      LOGIN_TIMEOUT_MS
    );
  };

  /**
   * Starts the delay after which the retry action becomes available.
   *
   * @param attemptGeneration - Generation captured when the attempt started.
   * @returns Nothing.
   */
  const startLoginRetryTimeout = (attemptGeneration: number) => {
    clearLoginRetryTimeout();
    loginRetryTimeoutRef.current = setTimeout(() => {
      loginRetryTimeoutRef.current = null;
      if (isActiveAttempt(attemptGeneration)) {
        setShowRetry(true);
      }
    }, LOGIN_RETRY_DELAY_MS);
  };

  /**
   * Resolves the post-login route from the query, component prop, or default.
   *
   * @returns Route to open after authentication.
   */
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
      if (loginAttemptOutcomeRef.current === 'active') {
        loginAttemptOutcomeRef.current = 'cancelled';
        loginAbortControllerRef.current?.abort();
        loginAbortControllerRef.current = null;
      }
      clearPollingTimeout();
      clearLoginRetryTimeout();
      clearLoginTimeout();
    };
  }, []);

  /**
   * Checks the existing Azure session before offering CLI sign-in or redirecting.
   *
   * @returns Promise that resolves after the initial status check completes.
   */
  const checkLoginStatus = async () => {
    let statusCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const result = await Promise.race([
        getLoginStatus().then(async status => ({
          status,
          nativeStatus: status.isLoggedIn ? await getNativeLoginStatus() : null,
        })),
        new Promise<null>(resolve => {
          statusCheckTimeout = setTimeout(() => resolve(null), LOGIN_TIMEOUT_MS);
        }),
      ]);
      if (!mountedRef.current) {
        return;
      }
      if (result?.status.isLoggedIn) {
        // Trigger update event for sidebar label
        window.dispatchEvent(new CustomEvent('azure-auth-update'));
        if (result.nativeStatus?.isLoggedIn) {
          setCliLoginMode('native');
        } else {
          history.push(getRedirectTarget());
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        console.error('Error checking login status:', error);
      }
    } finally {
      if (statusCheckTimeout) clearTimeout(statusCheckTimeout);
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  };

  /**
   * Starts native Azure login, verifies status immediately, and polls if needed.
   *
   * @returns Promise that resolves after login initiation and its immediate check.
   */
  const handleLogin = async () => {
    if (loginAttemptOutcomeRef.current === 'active') {
      return;
    }
    const attemptGeneration = ++loginAttemptGenerationRef.current;
    const abortController = new AbortController();
    loginAbortControllerRef.current = abortController;
    loginAttemptOutcomeRef.current = 'active';
    trackAksFeature('aksd.auth-login', 'started');
    setLoading(true);
    setShowRetry(false);
    setErrorMessage('');
    setLoginPrompt('');
    setStatusMessage(`${t('Initiating Azure login')}...`);
    startLoginTimeout(attemptGeneration);

    try {
      const result = await initiateLogin(abortController.signal, selectedCloud || undefined);

      if (!isActiveAttempt(attemptGeneration)) {
        return;
      }

      if (!result.success) {
        clearLoginRetryTimeout();
        clearLoginTimeout();
        loginAttemptOutcomeRef.current = 'failed';
        abortController.abort();
        loginAbortControllerRef.current = null;
        trackLoginFailure('UnknownError');
        setStatusMessage('');
        setErrorMessage(result.message);
        setLoading(false);
        setShowRetry(false);
        return;
      }

      startLoginRetryTimeout(attemptGeneration);
      setLoginPrompt(result.message);
      setStatusMessage(t('Checking authentication status'));

      // Check immediately, then poll for login completion
      let pollCount = 0;
      const maxPolls = Math.ceil(LOGIN_TIMEOUT_MS / LOGIN_POLL_INTERVAL_MS);

      /**
       * Checks Azure account state for the current login attempt.
       *
       * @param countTowardTimeout - Whether this check consumes one polling attempt.
       * @returns Promise that resolves after account state is processed.
       */
      const pollLoginStatus = async (countTowardTimeout = true) => {
        if (!isActiveAttempt(attemptGeneration)) {
          return;
        }
        if (countTowardTimeout) {
          pollCount++;
        }

        try {
          const status = await getNativeLoginStatus();

          if (!isActiveAttempt(attemptGeneration)) {
            return;
          }

          if (status.isLoggedIn) {
            clearPollingTimeout();
            clearLoginRetryTimeout();
            clearLoginTimeout();
            loginAttemptOutcomeRef.current = 'succeeded';
            loginAbortControllerRef.current = null;
            trackAksFeature('aksd.auth-login', 'succeeded');
            setLoading(false);
            setStatusMessage('');
            setLoginPrompt('');

            // Trigger update event for sidebar label
            window.dispatchEvent(new CustomEvent('azure-auth-update'));

            setCliLoginMode('native');
          } else if (status.error && !status.needsRelogin && status.error !== 'Not logged in') {
            clearPollingTimeout();
            clearLoginRetryTimeout();
            clearLoginTimeout();
            loginAttemptOutcomeRef.current = 'failed';
            abortController.abort();
            loginAbortControllerRef.current = null;
            trackLoginFailure('UnknownError');
            setStatusMessage('');
            setLoginPrompt('');
            setErrorMessage(status.error);
            setLoading(false);
            setShowRetry(false);
          } else if (pollCount >= maxPolls) {
            handleLoginTimeout(attemptGeneration);
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
            return;
          }
          console.error('Error polling login status:', error);
        }
      };

      /**
       * Schedules the next non-overlapping account-status poll.
       *
       * @returns Nothing.
       */
      const scheduleNextPoll = () => {
        pollingTimeoutRef.current = setTimeout(async () => {
          pollingTimeoutRef.current = null;
          await pollLoginStatus();
          if (isActiveAttempt(attemptGeneration)) {
            scheduleNextPoll();
          }
        }, LOGIN_POLL_INTERVAL_MS);
      };

      await pollLoginStatus(false);
      if (isActiveAttempt(attemptGeneration)) {
        scheduleNextPoll();
      }
    } catch (error) {
      if (!isActiveAttempt(attemptGeneration)) {
        return;
      }
      console.error('Error initiating login:', error);
      clearLoginRetryTimeout();
      clearLoginTimeout();
      loginAttemptOutcomeRef.current = 'failed';
      abortController.abort();
      loginAbortControllerRef.current = null;
      trackLoginFailure('UnknownError');
      setStatusMessage('');
      setErrorMessage(
        t('Failed to initiate login: {{message}}', {
          message: error instanceof Error ? error.message : t('Unknown error'),
        })
      );
      setLoading(false);
      setShowRetry(false);
    }
  };

  /**
   * Cancels the active login attempt and clears its pending timers and messages.
   *
   * @returns Nothing.
   */
  const handleCancel = () => {
    if (loginAttemptOutcomeRef.current !== 'active') {
      return;
    }
    loginAttemptGenerationRef.current++;
    loginAttemptOutcomeRef.current = 'cancelled';
    loginAbortControllerRef.current?.abort();
    loginAbortControllerRef.current = null;
    trackAksFeature('aksd.auth-login', 'cancelled');
    clearPollingTimeout();
    clearLoginRetryTimeout();
    clearLoginTimeout();
    setLoading(false);
    setShowRetry(false);
    setStatusMessage('');
    setLoginPrompt('');
    setErrorMessage('');
  };

  /**
   * Cancels the current attempt and starts a fresh Azure login attempt.
   *
   * @returns Promise that resolves after the replacement attempt is initiated.
   */
  const handleRetry = async () => {
    if (loginAttemptOutcomeRef.current !== 'active') {
      return;
    }
    handleCancel();
    await handleLogin();
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

  if (cliLoginMode) {
    return (
      <Box sx={rootSx}>
        <Container sx={containerSx} maxWidth="sm">
          <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
            <CardContent>
              <CliLoginStep
                nativeAuthenticated={cliLoginMode === 'native'}
                onBack={() => setCliLoginMode(null)}
                onContinue={() => {
                  if (cliLoginMode === 'cli-only') {
                    window.dispatchEvent(new CustomEvent('azure-auth-update'));
                  }
                  history.push(getRedirectTarget());
                }}
              />
            </CardContent>
          </Card>
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
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <TextField
                  select
                  label={t('Azure cloud')}
                  value={selectedCloud}
                  onChange={event => setSelectedCloud(event.target.value as NativeCloudName | '')}
                  SelectProps={{ native: true }}
                  sx={{ minWidth: 200 }}
                >
                  <option value="">{t('Automatic (Azure CLI or public cloud)')}</option>
                  <option value="AzureCloud">{t('Azure public cloud')}</option>
                  <option value="AzureUSGovernment">{t('Azure US Government')}</option>
                  <option value="AzureChinaCloud">{t('Azure China')}</option>
                </TextField>
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
                <Button onClick={() => setCliLoginMode('cli-only')}>
                  {t('Sign in with Azure CLI instead')}
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
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
                {showRetry && (
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleRetry}
                    sx={{
                      minWidth: 200,
                      py: 1.5,
                      px: 4,
                      textTransform: 'none',
                      fontSize: 16,
                    }}
                  >
                    {t('Retry')}
                  </Button>
                )}
              </Box>
            )}

            {statusMessage && (
              <Typography variant="body2" sx={{ mt: 2, color: 'info.main' }}>
                {statusMessage}
              </Typography>
            )}

            {loginPrompt && (
              <Typography variant="body2" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
                {loginPrompt}
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
