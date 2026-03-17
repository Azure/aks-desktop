// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useMemo, useState } from 'react';
import { useAzureContext } from '../../../hooks/useAzureContext';
import type { GitHubRepo } from '../../../types/github';
import { openExternalUrl } from '../../../utils/shared/openExternalUrl';
import DeployWizard from '../../DeployWizard/DeployWizard';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import {
  type DeploymentProvenance,
  type DeploymentStatus,
  useClusterDeployStatus,
} from '../hooks/useClusterDeployStatus';
import { usePipelineStatus } from '../hooks/usePipelineStatus';
import { extractContainerConfigFromDeployment } from '../utils/extractContainerConfig';
import { PipelineDeployDialog } from './PipelineDeployDialog';

function getDeploymentHealth(
  t: (key: string) => string,
  d: DeploymentStatus
): {
  label: string;
  color: 'success' | 'default' | 'warning';
} {
  if (d.availableReplicas >= d.replicas && d.replicas > 0)
    return { label: t('Healthy'), color: 'success' };
  if (d.replicas === 0) return { label: t('Scaled down'), color: 'default' };
  return { label: t('Degraded'), color: 'warning' };
}

function getProvenanceDisplay(
  t: (key: string) => string,
  provenance: DeploymentProvenance
): {
  label: string;
  icon: string;
  color: 'info' | 'secondary' | 'default';
} | null {
  switch (provenance) {
    case 'pipeline':
      return { label: t('Pipeline'), icon: 'mdi:rocket-launch', color: 'info' };
    case 'vscode':
      return { label: t('VS Code'), icon: 'mdi:microsoft-visual-studio-code', color: 'info' };
    case 'manual':
      return { label: t('Manual'), icon: 'mdi:cloud-upload', color: 'secondary' };
    case 'unknown':
      return null;
    default: {
      const _exhaustive: never = provenance;
      return _exhaustive;
    }
  }
}

interface ClusterDeployCardProps {
  cluster: string;
  namespace: string;
  pipelineEnabled: boolean;
}

export function ClusterDeployCard({ cluster, namespace, pipelineEnabled }: ClusterDeployCardProps) {
  const { t } = useTranslation();
  const { azureContext } = useAzureContext(cluster);
  const pipelineStatus = usePipelineStatus(cluster, namespace);
  const pipelineRepos = pipelineStatus.isConfigured ? pipelineStatus.repos : [];
  const { deployments, services, loading, error } = useClusterDeployStatus(
    cluster,
    namespace,
    true
  );
  const [manualDeployOpen, setManualDeployOpen] = useState(false);
  const [pipelineDeployRepo, setPipelineDeployRepo] = useState<GitHubRepo | null>(null);
  const [editingDeployment, setEditingDeployment] = useState<DeploymentStatus | null>(null);

  const editingContainerConfig: Partial<ContainerConfig> | undefined = useMemo(() => {
    if (!editingDeployment?.rawDeployment) return undefined;
    const matchingService = services.find(s => s.name === editingDeployment.name);
    return extractContainerConfigFromDeployment(
      editingDeployment.rawDeployment,
      matchingService?.rawService
    );
  }, [editingDeployment, services]);

  const handleEditManual = (d: DeploymentStatus) => {
    setEditingDeployment(d);
    setManualDeployOpen(true);
  };

  const handleCloseManualDeploy = () => {
    setManualDeployOpen(false);
    setEditingDeployment(null);
  };

  const handleRedeployPipeline = (d: DeploymentStatus) => {
    if (d.pipelineRepo) {
      const parts = d.pipelineRepo.split('/');
      if (parts.length !== 2) {
        console.warn(`Invalid pipeline repo format: ${d.pipelineRepo}`);
        return;
      }
      const [owner, repo] = parts;
      const matchingRepo = pipelineRepos.find(r => r.owner === owner && r.repo === repo);
      if (matchingRepo) {
        setPipelineDeployRepo(matchingRepo);
      } else {
        console.warn(`Pipeline repo ${d.pipelineRepo} not found in configured repos`);
      }
    }
  };

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon="mdi:cloud-upload" />}
              onClick={() => {
                setEditingDeployment(null);
                setManualDeployOpen(true);
              }}
              sx={{ textTransform: 'none' }}
            >
              {t('Manual Deploy')}
            </Button>
            {pipelineEnabled &&
              pipelineRepos.map(repo => (
                <Button
                  key={`${repo.owner}/${repo.repo}`}
                  variant="contained"
                  size="small"
                  startIcon={<Icon icon="mdi:rocket-launch" aria-hidden="true" />}
                  onClick={() => setPipelineDeployRepo(repo)}
                  sx={{ textTransform: 'none' }}
                >
                  {pipelineRepos.length > 1
                    ? t('Deploy {{repo}}', { repo: repo.repo })
                    : t('Deploy via Pipeline')}
                </Button>
              ))}
          </Box>
        </Box>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {error && (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        )}

        {!loading && !error && (
          <>
            {deployments.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                {t('No deployments found in this namespace.')}
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('Deployment')}</TableCell>
                    <TableCell align="center">{t('Source')}</TableCell>
                    <TableCell align="center">{t('Replicas')}</TableCell>
                    <TableCell align="center">{t('Ready')}</TableCell>
                    <TableCell align="center">{t('Status')}</TableCell>
                    <TableCell align="right">{t('Actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deployments.map(d => {
                    const health = getDeploymentHealth(t, d);
                    const provDisplay = getProvenanceDisplay(t, d.provenance);
                    return (
                      <TableRow key={d.name}>
                        <TableCell>{d.name}</TableCell>
                        <TableCell align="center">
                          {provDisplay ? (
                            <Chip
                              icon={<Icon icon={provDisplay.icon} />}
                              label={provDisplay.label}
                              size="small"
                              color={provDisplay.color}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              —
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">{d.replicas}</TableCell>
                        <TableCell align="center">
                          {d.readyReplicas}/{d.replicas}
                        </TableCell>
                        <TableCell align="center">
                          <Chip label={health.label} size="small" color={health.color} />
                        </TableCell>
                        <TableCell align="right">
                          {d.provenance === 'manual' && (
                            <Tooltip title={t('Edit deployment')}>
                              <IconButton size="small" onClick={() => handleEditManual(d)}>
                                <Icon icon="mdi:pencil" aria-hidden="true" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {(d.provenance === 'pipeline' || d.provenance === 'vscode') &&
                            d.pipelineRunUrl && (
                              <Tooltip title={t('View workflow run')}>
                                <IconButton
                                  size="small"
                                  onClick={() => openExternalUrl(d.pipelineRunUrl ?? '')}
                                >
                                  <Icon icon="mdi:open-in-new" aria-hidden="true" />
                                </IconButton>
                              </Tooltip>
                            )}
                          {(d.provenance === 'pipeline' || d.provenance === 'vscode') &&
                            d.pipelineRepo && (
                              <Tooltip title={t('Re-deploy')}>
                                <IconButton size="small" onClick={() => handleRedeployPipeline(d)}>
                                  <Icon icon="mdi:replay" aria-hidden="true" />
                                </IconButton>
                              </Tooltip>
                            )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={manualDeployOpen}
        onClose={handleCloseManualDeploy}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { height: '90vh', maxHeight: '90vh' } }}
      >
        <DeployWizard
          cluster={cluster}
          namespace={namespace}
          initialApplicationName={editingDeployment?.name}
          initialContainerConfig={editingContainerConfig}
          onClose={handleCloseManualDeploy}
        />
      </Dialog>

      {pipelineDeployRepo && azureContext && (
        <PipelineDeployDialog
          open
          onClose={() => setPipelineDeployRepo(null)}
          repo={pipelineDeployRepo}
          cluster={cluster}
          namespace={namespace}
          resourceGroup={azureContext.resourceGroup}
        />
      )}
    </Card>
  );
}
