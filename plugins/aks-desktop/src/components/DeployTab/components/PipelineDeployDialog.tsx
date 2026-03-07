// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import React, { useCallback, useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import { dispatchWorkflow } from '../../../utils/github/github-api';
import { PIPELINE_WORKFLOW_FILENAME } from '../../GitHubPipeline/constants';
import { useGitHubAuthContext } from '../../GitHubPipeline/GitHubAuthContext';

interface PipelineDeployDialogProps {
  open: boolean;
  onClose: () => void;
  repo: GitHubRepo;
  cluster: string;
  namespace: string;
  resourceGroup: string;
}

export function PipelineDeployDialog({
  open,
  onClose,
  repo,
  cluster,
  namespace,
  resourceGroup,
}: PipelineDeployDialogProps) {
  const gitHubAuth = useGitHubAuthContext();
  const [dispatching, setDispatching] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleDeploy = useCallback(async () => {
    if (!gitHubAuth.octokit) return;
    setDispatching(true);
    setResult(null);
    setErrorMessage('');
    try {
      await dispatchWorkflow(
        gitHubAuth.octokit,
        repo.owner,
        repo.repo,
        PIPELINE_WORKFLOW_FILENAME,
        repo.defaultBranch,
        {
          'cluster-name': cluster,
          'resource-group': resourceGroup,
          namespace,
        }
      );
      setResult('success');
    } catch (err) {
      setResult('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to trigger deployment');
    } finally {
      setDispatching(false);
    }
  }, [gitHubAuth.octokit, repo, cluster, namespace, resourceGroup]);

  const handleClose = () => {
    setResult(null);
    setErrorMessage('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Deploy via Pipeline</DialogTitle>
      <DialogContent>
        <Box sx={{ py: 1 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Trigger <strong>deploy-to-aks.yml</strong> workflow on{' '}
            <strong>
              {repo.owner}/{repo.repo}
            </strong>{' '}
            with the following parameters:
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body2">
              <strong>Cluster:</strong> {cluster}
            </Typography>
            <Typography variant="body2">
              <strong>Resource Group:</strong> {resourceGroup}
            </Typography>
            <Typography variant="body2">
              <strong>Namespace:</strong> {namespace}
            </Typography>
          </Box>
          {!gitHubAuth.authState.isAuthenticated &&
            (gitHubAuth.authState.isAuthorizingBrowser ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={14} />
                  <Typography variant="body2" color="text.secondary">
                    Waiting for browser authorization...
                  </Typography>
                </Box>
              </Alert>
            ) : (
              <Alert
                severity="warning"
                sx={{ mb: 2 }}
                action={
                  <Button color="inherit" size="small" onClick={gitHubAuth.startOAuth}>
                    Sign in
                  </Button>
                }
              >
                GitHub authentication required to trigger deployment.
              </Alert>
            ))}
          {result === 'success' && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Workflow dispatch triggered successfully. Check GitHub Actions for progress.
            </Alert>
          )}
          {result === 'error' && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {errorMessage}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{result ? 'Close' : 'Cancel'}</Button>
        {!result && (
          <Button
            variant="contained"
            onClick={handleDeploy}
            disabled={dispatching || !gitHubAuth.authState.isAuthenticated}
            startIcon={
              dispatching ? <CircularProgress size={16} /> : <Icon icon="mdi:rocket-launch" />
            }
          >
            {dispatching ? 'Triggering...' : 'Deploy'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
