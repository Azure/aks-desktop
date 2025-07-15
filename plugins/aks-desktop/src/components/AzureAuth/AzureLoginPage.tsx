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
  styled,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { getLoginStatus, initiateLogin } from '../../utils/azure/az-cli';

const PREFIX = 'AzureLoginPage';

const classes = {
  root: `${PREFIX}-root`,
  container: `${PREFIX}-container`,
  card: `${PREFIX}-card`,
  logo: `${PREFIX}-logo`,
  title: `${PREFIX}-title`,
  subtitle: `${PREFIX}-subtitle`,
  loginButton: `${PREFIX}-loginButton`,
  statusMessage: `${PREFIX}-statusMessage`,
  errorMessage: `${PREFIX}-errorMessage`,
};

const StyledBox = styled(Box)(({ theme }) => ({
  [`&.${classes.root}`]: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.background.default,
  },

  [`& .${classes.container}`]: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(3),
  },

  [`& .${classes.card}`]: {
    maxWidth: 500,
    width: '100%',
    textAlign: 'center',
    padding: theme.spacing(4),
  },

  [`& .${classes.logo}`]: {
    fontSize: '64px',
    color: theme.palette.primary.main,
    marginBottom: theme.spacing(2),
  },

  [`& .${classes.title}`]: {
    marginBottom: theme.spacing(2),
    fontWeight: 600,
  },

  [`& .${classes.subtitle}`]: {
    marginBottom: theme.spacing(4),
    color: theme.palette.text.secondary,
  },

  [`& .${classes.loginButton}`]: {
    minWidth: 200,
    padding: theme.spacing(1.5, 4),
    textTransform: 'none',
    fontSize: '16px',
  },

  [`& .${classes.statusMessage}`]: {
    marginTop: theme.spacing(2),
    color: theme.palette.info.main,
  },

  [`& .${classes.errorMessage}`]: {
    marginTop: theme.spacing(2),
    color: theme.palette.error.main,
  },
}));

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

  if (checking) {
    return (
      <StyledBox className={classes.root}>
        <Container className={classes.container}>
          <CircularProgress />
          <Typography variant="body1">Checking authentication status...</Typography>
        </Container>
      </StyledBox>
    );
  }

  return (
    <StyledBox className={classes.root}>
      <Container className={classes.container} maxWidth="sm">
        <Card className={classes.card}>
          <CardContent>
            {loading && (
              <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={40} />
              </Box>
            )}

            <Icon icon="logos:microsoft-azure" className={classes.logo} />

            <Typography variant="h4" className={classes.title}>
              Azure Authentication
            </Typography>

            <Typography variant="body1" className={classes.subtitle}>
              Sign in with your Azure account to manage AKS clusters and resources
            </Typography>

            {!loading ? (
              <Button
                variant="contained"
                color="primary"
                className={classes.loginButton}
                onClick={handleLogin}
                startIcon={<Icon icon="mdi:login" />}
              >
                Sign in with Azure
              </Button>
            ) : (
              <Button
                variant="outlined"
                color="secondary"
                className={classes.loginButton}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            )}

            {statusMessage && (
              <Typography variant="body2" className={classes.statusMessage}>
                {statusMessage}
              </Typography>
            )}

            {errorMessage && (
              <Box className={classes.errorMessage}>
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
    </StyledBox>
  );
}
