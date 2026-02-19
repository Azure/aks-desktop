// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React, { useState } from 'react';
import type { GitHubRepo } from '../../../types/github';
import DeployWizard from '../../DeployWizard/DeployWizard';
import { useClusterDeployStatus } from '../hooks/useClusterDeployStatus';
import { PipelineDeployDialog } from './PipelineDeployDialog';

interface ClusterDeployCardProps {
  cluster: string;
  namespace: string;
  azureContext: { subscriptionId: string; resourceGroup: string; tenantId: string } | null;
  pipelineRepo: GitHubRepo | null;
  pipelineEnabled: boolean;
}

export const ClusterDeployCard: React.FC<ClusterDeployCardProps> = ({
  cluster,
  namespace,
  azureContext,
  pipelineRepo,
  pipelineEnabled,
}) => {
  const { deployments, services, loading, error } = useClusterDeployStatus(
    cluster,
    namespace,
    true
  );
  const [manualDeployOpen, setManualDeployOpen] = useState(false);
  const [pipelineDeployOpen, setPipelineDeployOpen] = useState(false);

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:kubernetes" style={{ fontSize: 24 }} />
            <Typography variant="h6">{cluster}</Typography>
            <Chip label={namespace} size="small" variant="outlined" />
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Icon icon="mdi:cloud-upload" />}
              onClick={() => setManualDeployOpen(true)}
              sx={{ textTransform: 'none' }}
            >
              Manual Deploy
            </Button>
            {pipelineEnabled && pipelineRepo && (
              <Button
                variant="contained"
                size="small"
                startIcon={<Icon icon="mdi:rocket-launch" />}
                onClick={() => setPipelineDeployOpen(true)}
                sx={{ textTransform: 'none' }}
              >
                Deploy via Pipeline
              </Button>
            )}
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
                No deployments found in this namespace.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Deployment</TableCell>
                    <TableCell align="center">Replicas</TableCell>
                    <TableCell align="center">Ready</TableCell>
                    <TableCell align="center">Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deployments.map(d => (
                    <TableRow key={d.name}>
                      <TableCell>{d.name}</TableCell>
                      <TableCell align="center">{d.replicas}</TableCell>
                      <TableCell align="center">
                        {d.readyReplicas}/{d.replicas}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={
                            d.availableReplicas >= d.replicas && d.replicas > 0
                              ? 'Healthy'
                              : d.replicas === 0
                              ? 'Scaled down'
                              : 'Degraded'
                          }
                          size="small"
                          color={
                            d.availableReplicas >= d.replicas && d.replicas > 0
                              ? 'success'
                              : d.replicas === 0
                              ? 'default'
                              : 'warning'
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {services.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Services
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Cluster IP</TableCell>
                      <TableCell>External IP</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {services.map(s => (
                      <TableRow key={s.name}>
                        <TableCell>{s.name}</TableCell>
                        <TableCell>{s.type}</TableCell>
                        <TableCell>{s.clusterIP}</TableCell>
                        <TableCell>{s.externalIP ?? '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </>
        )}
      </CardContent>

      {/* Manual Deploy Dialog */}
      <Dialog
        open={manualDeployOpen}
        onClose={() => setManualDeployOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { height: '90vh', maxHeight: '90vh' } }}
      >
        <DeployWizard
          cluster={cluster}
          namespace={namespace}
          onClose={() => setManualDeployOpen(false)}
        />
      </Dialog>

      {/* Pipeline Deploy Dialog */}
      {pipelineRepo && azureContext && (
        <PipelineDeployDialog
          open={pipelineDeployOpen}
          onClose={() => setPipelineDeployOpen(false)}
          repo={pipelineRepo}
          cluster={cluster}
          namespace={namespace}
          resourceGroup={azureContext.resourceGroup}
          subscriptionId={azureContext.subscriptionId}
        />
      )}
    </Card>
  );
};
