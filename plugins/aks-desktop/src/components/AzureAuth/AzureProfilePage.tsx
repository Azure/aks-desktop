// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon, InlineIcon } from '@iconify/react';
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
import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAzureAuth } from '../../hooks/useAzureAuth';

const PREFIX = 'AzureProfilePage';

const classes = {
  root: `${PREFIX}-root`,
  container: `${PREFIX}-container`,
  card: `${PREFIX}-card`,
  header: `${PREFIX}-header`,
  backButton: `${PREFIX}-backButton`,
  logo: `${PREFIX}-logo`,
  title: `${PREFIX}-title`,
  subtitle: `${PREFIX}-subtitle`,
  infoSection: `${PREFIX}-infoSection`,
  infoLabel: `${PREFIX}-infoLabel`,
  infoValue: `${PREFIX}-infoValue`,
  buttonContainer: `${PREFIX}-buttonContainer`,
  actionButton: `${PREFIX}-actionButton`,
  logoutButton: `${PREFIX}-logoutButton`,
  errorMessage: `${PREFIX}-errorMessage`,
};

const StyledBox = styled(Box)(({ theme }) => ({
  [`&.${classes.root}`]: {
    minHeight: '100vh',
    backgroundColor: theme.palette.background.default,
    paddingTop: theme.spacing(2),
  },

  [`& .${classes.container}`]: {
    maxWidth: 600,
  },

  [`& .${classes.card}`]: {
    textAlign: 'center',
    padding: theme.spacing(4),
  },

  [`& .${classes.header}`]: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: theme.spacing(3),
  },

  [`& .${classes.backButton}`]: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    color: theme.palette.text.secondary,
    '&:hover': {
      color: theme.palette.primary.main,
    },
  },

  [`& .${classes.logo}`]: {
    fontSize: '64px',
    color: theme.palette.primary.main,
    marginBottom: theme.spacing(2),
  },

  [`& .${classes.title}`]: {
    marginBottom: theme.spacing(1),
    fontWeight: 600,
  },

  [`& .${classes.subtitle}`]: {
    marginBottom: theme.spacing(3),
    color: theme.palette.text.secondary,
  },

  [`& .${classes.infoSection}`]: {
    marginBottom: theme.spacing(3),
    padding: theme.spacing(2),
    backgroundColor: theme.palette.action.hover,
    borderRadius: theme.shape.borderRadius,
    textAlign: 'left',
  },

  [`& .${classes.infoLabel}`]: {
    fontWeight: 600,
    marginBottom: theme.spacing(0.5),
    color: theme.palette.text.secondary,
  },

  [`& .${classes.infoValue}`]: {
    fontSize: '1rem',
    wordBreak: 'break-all',
  },

  [`& .${classes.buttonContainer}`]: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    marginTop: theme.spacing(3),
  },

  [`& .${classes.actionButton}`]: {
    padding: theme.spacing(1.5),
    textTransform: 'none',
    fontSize: '16px',
  },

  [`& .${classes.logoutButton}`]: {
    padding: theme.spacing(1.5),
    textTransform: 'none',
    fontSize: '16px',
  },

  [`& .${classes.errorMessage}`]: {
    marginTop: theme.spacing(2),
    color: theme.palette.error.main,
    textAlign: 'left',
  },
}));

export default function AzureProfilePage() {
  const history = useHistory();
  const authStatus = useAzureAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleBack = () => {
    history.push('/');
  };

  const handleAddCluster = () => {
    history.push('/add-cluster-aks');
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      // Import dynamically to avoid circular dependencies
      const { runCommandAsync } = await import('../../utils/azure/az-cli');
      await runCommandAsync('az', ['logout']);

      // Trigger update event for sidebar label
      window.dispatchEvent(new CustomEvent('azure-auth-update'));

      // Redirect to login page after logout
      setTimeout(() => {
        history.push('/azure/login');
      }, 500);
    } catch (error) {
      console.error('Error logging out:', error);
      setLoggingOut(false);
    }
  };

  // Redirect to login page if not logged in
  React.useEffect(() => {
    if (!authStatus.isChecking && !authStatus.isLoggedIn) {
      history.push('/azure/login');
    }
  }, [authStatus.isChecking, authStatus.isLoggedIn, history]);

  if (authStatus.isChecking) {
    return (
      <StyledBox className={classes.root}>
        <Container className={classes.container}>
          <Box
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            minHeight="50vh"
          >
            <CircularProgress />
            <Typography variant="body1" sx={{ mt: 2 }}>
              Loading Azure account information...
            </Typography>
          </Box>
        </Container>
      </StyledBox>
    );
  }

  // Don't render anything if not logged in (will redirect)
  if (!authStatus.isLoggedIn) {
    return null;
  }

  return (
    <StyledBox className={classes.root}>
      <Container className={classes.container}>
        {/* Back Button */}
        <Box className={classes.header}>
          <Box className={classes.backButton} onClick={handleBack} role="button">
            <Box pt={0.5}>
              <InlineIcon icon="mdi:chevron-left" height={20} width={20} />
            </Box>
            <Box fontSize={14} style={{ textTransform: 'uppercase' }}>
              Back
            </Box>
          </Box>
        </Box>

        <Card className={classes.card}>
          <CardContent>
            <Icon icon="logos:microsoft-azure" className={classes.logo} />

            <Typography variant="h4" className={classes.title}>
              Azure Account
            </Typography>

            <Typography variant="body1" className={classes.subtitle}>
              Logged in as <strong>{authStatus.username}</strong>
            </Typography>

            {authStatus.tenantId && (
              <Box className={classes.infoSection}>
                <Typography variant="caption" className={classes.infoLabel}>
                  Tenant ID
                </Typography>
                <Typography variant="body2" className={classes.infoValue}>
                  {authStatus.tenantId}
                </Typography>
              </Box>
            )}

            {authStatus.subscriptionId && (
              <Box className={classes.infoSection}>
                <Typography variant="caption" className={classes.infoLabel}>
                  Default Subscription ID
                </Typography>
                <Typography variant="body2" className={classes.infoValue}>
                  {authStatus.subscriptionId}
                </Typography>
              </Box>
            )}

            <Box className={classes.buttonContainer}>
              <Button
                variant="contained"
                color="primary"
                className={classes.actionButton}
                onClick={handleAddCluster}
                startIcon={<Icon icon="mdi:cloud-plus" />}
              >
                Add Cluster from Azure
              </Button>

              <Button
                variant="outlined"
                color="primary"
                className={classes.logoutButton}
                onClick={handleLogout}
                disabled={loggingOut}
                startIcon={loggingOut ? <CircularProgress size={20} /> : <Icon icon="mdi:logout" />}
              >
                {loggingOut ? 'Logging out...' : 'Log out'}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </StyledBox>
  );
}
