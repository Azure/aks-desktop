// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Box, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { useAzureAuth } from '../../hooks/useAzureAuth';

interface AzureAuthGuardProps {
  children: React.ReactNode;
  loadingMessage?: string;
}

/**
 * Component that wraps children and ensures user is authenticated with Azure
 * Redirects to login page if not authenticated
 */
export default function AzureAuthGuard({
  children,
  loadingMessage = 'Checking Azure authentication...',
}: AzureAuthGuardProps) {
  const authStatus = useAzureAuth(true); // Will redirect if not logged in

  if (authStatus.isChecking) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="50vh"
        gap={2}
      >
        <CircularProgress />
        <Typography variant="body2" color="textSecondary">
          {loadingMessage}
        </Typography>
      </Box>
    );
  }

  if (!authStatus.isLoggedIn) {
    // User is being redirected to login, show nothing
    return null;
  }

  return <>{children}</>;
}
