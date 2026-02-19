// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { GitHubAuthState } from '../types';

interface GitHubAuthScreenProps {
  /** Current GitHub device flow auth state. */
  authState: GitHubAuthState;
  /** Starts the device flow authorization. */
  onStartDeviceFlow: () => void;
  /** Cancels the authorization. */
  onCancel: () => void;
  /** Proceeds after successful authorization. */
  onContinue: () => void;
}

const PERMISSIONS = [
  { name: 'Contents', level: 'write', purpose: 'Push agent config files' },
  { name: 'Workflows', level: 'write', purpose: 'Create setup workflow in .github/workflows/' },
  { name: 'Pull requests', level: 'write', purpose: 'Create setup PR' },
  { name: 'Issues', level: 'write', purpose: 'Trigger Copilot agent' },
  { name: 'Actions', level: 'write', purpose: 'Monitor and trigger workflow runs' },
];

export const GitHubAuthScreen: React.FC<GitHubAuthScreenProps> = ({
  authState,
  onStartDeviceFlow,
  onCancel,
  onContinue,
}) => {
  const { isAuthenticated, isAuthorizingDevice, userCode, verificationUri, username, error } =
    authState;

  // Auto-advance after authentication — gives user time to see the success state.
  // Use a ref for onContinue to avoid restarting the timer when the callback identity changes.
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useEffect(() => {
    if (!isAuthenticated) return;
    setAutoAdvancing(true);
    timerRef.current = setTimeout(() => {
      onContinueRef.current();
    }, 1500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAuthenticated]);

  // Authenticated — show success
  if (isAuthenticated) {
    return (
      <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
        <CardContent>
          <Box
            component={Icon}
            icon="mdi:check-circle"
            sx={{ fontSize: 64, color: 'success.main', mb: 2, display: 'block', mx: 'auto' }}
          />
          <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
            Connected to GitHub
          </Typography>
          <Typography variant="body1" sx={{ mb: 1, color: 'text.secondary' }}>
            Signed in as <strong>{username}</strong>
          </Typography>
          {autoAdvancing && (
            <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
              Continuing...
            </Typography>
          )}
          <Button
            variant="contained"
            color="primary"
            onClick={onContinue}
            sx={{ minWidth: 200, py: 1.5, px: 4, textTransform: 'none', fontSize: 16 }}
          >
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Device flow in progress — show user code
  if (isAuthorizingDevice && userCode) {
    return (
      <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
        <CardContent>
          <Box
            component={Icon}
            icon="mdi:github"
            sx={{ fontSize: 48, mb: 2, display: 'block', mx: 'auto' }}
          />
          <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
            Enter code on GitHub
          </Typography>
          <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
            Enter this code on GitHub to authorize AKS Desktop
          </Typography>

          <Box
            sx={{
              py: 2,
              px: 4,
              mb: 3,
              bgcolor: 'action.hover',
              borderRadius: 2,
              display: 'inline-block',
            }}
          >
            <Typography
              variant="h3"
              sx={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 4 }}
            >
              {userCode}
            </Typography>
          </Box>

          <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={24} sx={{ mr: 1.5 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Waiting for authorization...
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button
              variant="contained"
              color="primary"
              onClick={() => window.open(verificationUri!, '_blank')}
              startIcon={<Icon icon="mdi:open-in-new" />}
              sx={{ textTransform: 'none', fontSize: 14 }}
            >
              Open GitHub
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              onClick={onCancel}
              sx={{ textTransform: 'none', fontSize: 14 }}
            >
              Cancel
            </Button>
          </Box>
        </CardContent>
      </Card>
    );
  }

  // Initial state — show connect button
  return (
    <Card sx={{ maxWidth: 500, width: '100%', textAlign: 'center', p: 4 }}>
      <CardContent>
        <Box
          component={Icon}
          icon="mdi:github"
          sx={{ fontSize: 64, mb: 2, display: 'block', mx: 'auto' }}
        />
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
          Connect to GitHub
        </Typography>
        <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
          Authorize AKS Desktop to create deployment pipelines in your repositories
        </Typography>

        <Box sx={{ mb: 3, textAlign: 'left' }}>
          <Typography variant="body2" sx={{ mb: 1.5, fontWeight: 600 }}>
            Required permissions:
          </Typography>
          {PERMISSIONS.map(perm => (
            <Box key={perm.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Chip label={perm.level} size="small" variant="outlined" sx={{ minWidth: 48 }} />
              <Typography variant="body2">
                <strong>{perm.name}</strong> — {perm.purpose}
              </Typography>
            </Box>
          ))}
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        <Button
          variant="contained"
          color="primary"
          onClick={onStartDeviceFlow}
          startIcon={<Icon icon="mdi:github" />}
          sx={{ minWidth: 200, py: 1.5, px: 4, textTransform: 'none', fontSize: 16 }}
        >
          Connect to GitHub
        </Button>
      </CardContent>
    </Card>
  );
};
