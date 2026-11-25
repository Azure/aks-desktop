// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../../hooks/useAzureAuth';
import { trackError } from '../../../telemetry';
import { trackAksFeature } from '../../../telemetry/aksFeature';
import { PROFILE_REDIRECT_DELAY_MS } from '../../../utils/constants/timing';

function trackLogoutFailure() {
  trackAksFeature('aksd.auth-logout', 'failed');
  try {
    trackError({ area: 'auth-logout', errorClass: 'UnknownError', phase: 'failed' });
  } catch {}
}

/**
 * Return type for {@link useAzureProfilePage}.
 */
export interface UseAzureProfilePageResult {
  /** Whether the auth state is still being determined. */
  isChecking: boolean;
  /** Whether the user is currently logged in to Azure. */
  isLoggedIn: boolean;
  /** The logged-in user's Azure username, or `undefined` if not available. */
  username: string | undefined;
  /** The active tenant ID, or `undefined` if not available. */
  tenantId: string | undefined;
  /** The default subscription ID, or `undefined` if not available. */
  subscriptionId: string | undefined;
  /** `true` while the logout command is in flight. */
  loggingOut: boolean;
  /** Error requiring user action after a partial sign-out. */
  logoutError: string;
  /** Information about a native-only sign-out. */
  logoutNotice: string;
  /** Navigates back to the home page. */
  handleBack: () => void;
  /** Navigates to the Add Cluster from Azure page. */
  handleAddCluster: () => void;
  /**
   * Signs out of native and Azure CLI sessions. On success, dispatches an
   * `azure-auth-update` event and redirects to the login page after
   * {@link PROFILE_REDIRECT_DELAY_MS}.
   */
  handleLogout: () => Promise<void>;
}

/**
 * Encapsulates all stateful logic for the Azure Profile page.
 *
 * Responsibilities:
 * - Exposes the current Azure auth state fields needed by the page.
 * - Redirects to `/azure/login` when the user is not logged in.
 * - Provides `handleBack`, `handleAddCluster`, and `handleLogout` callbacks.
 * - Manages the `loggingOut` in-flight state for the logout button.
 */
export function useAzureProfilePage(): UseAzureProfilePageResult {
  const { t } = useTranslation();
  const history = useHistory();
  const authStatus = useAzureAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [logoutNotice, setLogoutNotice] = useState('');
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const logoutAttemptGenerationRef = useRef(0);
  const logoutInFlightRef = useRef(false);

  const isCurrentLogoutAttempt = (attemptGeneration: number) =>
    mountedRef.current && logoutAttemptGenerationRef.current === attemptGeneration;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      logoutAttemptGenerationRef.current++;
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  // Redirect to login page when the user is not (or no longer) logged in,
  // except while an explicit logout flow is already handling the redirect.
  useEffect(() => {
    if (!loggingOut && !logoutError && !authStatus.isChecking && !authStatus.isLoggedIn) {
      history.push('/azure/login');
    }
  }, [authStatus.isChecking, authStatus.isLoggedIn, history, loggingOut, logoutError]);

  const handleBack = () => {
    history.push('/');
  };

  const handleAddCluster = () => {
    history.push('/add-cluster-aks');
  };

  const handleLogout = async () => {
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    const attemptGeneration = ++logoutAttemptGenerationRef.current;
    trackAksFeature('aksd.auth-logout', 'started');
    setLoggingOut(true);
    setLogoutError('');
    setLogoutNotice('');
    let policyNotSaved = false;
    let nativeSignedOut = false;
    const policyWarning = t(
      'Azure sign-out could not be saved. Azure CLI accounts may be reused after the app reloads. Retry sign-out.'
    );
    try {
      const { logoutNative } = await import('../../../utils/azure/native-auth');
      policyNotSaved = (await logoutNative()) === false;
      nativeSignedOut = true;
      window.dispatchEvent(new CustomEvent('azure-auth-update'));
      // Dynamic import avoids circular dependencies at module load time.
      const { runCommandAsync, isCliNotFoundError } = await import(
        '../../../utils/azure/az-cli-core'
      );
      const result = await runCommandAsync('az', ['logout']);
      if (!isCurrentLogoutAttempt(attemptGeneration)) {
        return;
      }
      const stderr = result.stderr?.trim() ?? '';
      let cliUnavailable = false;
      if (stderr && (isCliNotFoundError(stderr) || /there are no active accounts/i.test(stderr))) {
        cliUnavailable = true;
      } else if (stderr && !stderr.split('\n').every(line => line.trim().startsWith('WARNING:'))) {
        console.error('Azure CLI logout error:', stderr);
        trackLogoutFailure();
        setLogoutError(
          t(
            'Native Azure sign-out completed, but Azure CLI sign-out failed. Retry or run az logout manually.'
          ) + (policyNotSaved ? ` ${policyWarning}` : '')
        );
        setLoggingOut(false);
        return;
      }

      if (policyNotSaved) {
        trackLogoutFailure();
        setLogoutError(
          (cliUnavailable ? `${t('Azure CLI was not available.')} ` : '') + policyWarning
        );
        setLoggingOut(false);
        return;
      }

      if (cliUnavailable) {
        setLogoutNotice(t('Azure CLI was not available. Native Azure sign-out completed.'));
      }
      trackAksFeature('aksd.auth-logout', 'succeeded');

      // Stay in loggingOut=true state until the component unmounts on redirect.
      redirectTimerRef.current = setTimeout(() => {
        if (isCurrentLogoutAttempt(attemptGeneration)) {
          history.push('/azure/login');
        }
      }, PROFILE_REDIRECT_DELAY_MS);
    } catch (error) {
      if (!isCurrentLogoutAttempt(attemptGeneration)) {
        return;
      }
      console.error('Error logging out:', error);
      trackLogoutFailure();
      setLogoutError(
        (nativeSignedOut
          ? t(
              'Native Azure sign-out completed, but Azure CLI sign-out failed. Retry or run az logout manually.'
            )
          : t('Native Azure sign-out could not be completed. Retry sign-out.')) +
          (policyNotSaved ? ` ${policyWarning}` : '')
      );
      setLoggingOut(false);
    } finally {
      logoutInFlightRef.current = false;
    }
  };

  return {
    isChecking: authStatus.isChecking,
    isLoggedIn: authStatus.isLoggedIn,
    username: authStatus.username,
    tenantId: authStatus.tenantId,
    subscriptionId: authStatus.subscriptionId,
    loggingOut,
    logoutError,
    logoutNotice,
    handleBack,
    handleAddCluster,
    handleLogout,
  };
}
