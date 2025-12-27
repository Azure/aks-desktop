// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { getLoginStatus, initiateLogin } from '../../utils/azure/az-cli';

interface AzureLoginPageProps {
  redirectTo?: string;
}

export default function AzureLoginPage({ redirectTo }: AzureLoginPageProps) {
  const history = useHistory();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Get redirect target from URL query parameter or prop, fallback to profile page
  const getRedirectTarget = () => {
    const params = new URLSearchParams(location.search);
    const redirectParam = params.get('redirect');
    return redirectParam || redirectTo || '/azure/profile';
  };

  // Check if already logged in on mount
  useEffect(() => {
    checkLoginStatus();
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, []);

  const checkLoginStatus = async () => {
    try {
      const status = await getLoginStatus();
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
      setChecking(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('Initiating Azure login...');

    try {
      const result = await initiateLogin();

      if (!result.success) {
        setErrorMessage(result.message);
        setLoading(false);
        return;
      }

      setStatusMessage(
        'Please complete the authentication in your browser. This window will automatically redirect once login is complete.'
      );

      // Start polling for login completion
      let pollCount = 0;
      const maxPolls = 60; // 5 minutes max (60 * 5 seconds)

      const interval = setInterval(async () => {
        pollCount++;

        try {
          const status = await getLoginStatus();

          if (status.isLoggedIn) {
            clearInterval(interval);
            setStatusMessage('Login successful! Redirecting...');

            // Trigger update event for sidebar label
            window.dispatchEvent(new CustomEvent('azure-auth-update'));

            // Wait a moment before redirecting
            setTimeout(() => {
              const target = getRedirectTarget();
              history.push(target);
            }, 1000);
          } else if (pollCount >= maxPolls) {
            clearInterval(interval);
            setErrorMessage('Login timeout. Please try again.');
            setLoading(false);
          } else {
            const remaining = ((maxPolls - pollCount) * 5) / 60;
            setStatusMessage(
              `Waiting for login completion... (${remaining.toFixed(1)} minutes remaining)`
            );
          }
        } catch (error) {
          console.error('Error polling login status:', error);
        }
      }, 5000); // Poll every 5 seconds

      setPollingInterval(interval);
    } catch (error) {
      console.error('Error initiating login:', error);
      setErrorMessage(
        `Failed to initiate login: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
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
          <Typography variant="body1">Checking authentication status...</Typography>
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
              Azure Authentication
            </Typography>

            <Typography variant="body1" sx={{ mb: 4, color: 'text.secondary' }}>
              Sign in with your Azure account to manage AKS clusters and resources
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
                Sign in with Azure
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
                Cancel
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
