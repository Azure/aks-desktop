// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { Box, Card, Grid, Typography } from '@mui/material';
import React from 'react';
import type { ReviewStepProps } from '../types';
import { formatCpuValue, formatMemoryValue } from '../validators';

/**
 * Review step component for displaying configuration summary
 */
export const ReviewStep: React.FC<ReviewStepProps> = ({ formData, subscriptions, clusters }) => {
  const selectedSubscription = subscriptions.find(sub => sub.id === formData.subscription);
  const selectedCluster = clusters.find(c => c.name === formData.cluster);

  const sectionTitleSx = { color: 'text.primary' };
  const sectionDescriptionSx = { mb: 2, color: 'text.secondary' };

  return (
    <Box>
      <Typography variant="h5" component="h2" gutterBottom sx={sectionTitleSx}>
        Review Project Configuration
      </Typography>
      <Typography variant="body2" sx={sectionDescriptionSx}>
        Please review all the settings before creating your AKS project
      </Typography>

      <Grid container spacing={3}>
        {/* Basics Section */}
        <Grid item xs={12}>
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:project" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Project Basics
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  Project Name:
                </Typography>
                <Typography variant="body1">{formData.projectName}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  Subscription:
                </Typography>
                <Typography variant="body1">{selectedSubscription?.name || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  Cluster:
                </Typography>
                <Typography variant="body1">
                  {selectedCluster
                    ? `${selectedCluster.name} (${selectedCluster.location}, ${selectedCluster.version})`
                    : formData.cluster || 'N/A'}
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  Description:
                </Typography>
                <Typography variant="body1">
                  {formData.description || 'No description provided'}
                </Typography>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        {/* Networking and Compute Quota Side by Side */}
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ p: 2, mb: 2, height: '200px' }}>
            <Typography variant="h6" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:network" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Networking Policies
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Ingress Policy:
                </Typography>
                <Typography variant="body1">{formData.ingress}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Egress Policy:
                </Typography>
                <Typography variant="body1">{formData.egress}</Typography>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ p: 2, mb: 2, height: '200px' }}>
            <Typography variant="h6" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:cpu-64-bit" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Compute Quota
            </Typography>
            <Grid container spacing={2}>
              {/* CPU Section */}
              <Grid item xs={12} md={6}>
                <Box
                  sx={theme => ({
                    p: 1,
                    backgroundColor: theme.palette.background.muted,
                    borderRadius: 1,
                    border: `1px solid ${theme.palette.divider}`,
                  })}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center' }}
                  >
                    <Icon icon="mdi:cpu-64-bit" style={{ marginRight: 4, fontSize: 16 }} />
                    CPU
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Requests:
                  </Typography>
                  <Typography variant="body1">{formatCpuValue(formData.cpuRequest)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Limits:
                  </Typography>
                  <Typography variant="body1">{formatCpuValue(formData.cpuLimit)}</Typography>
                </Box>
              </Grid>

              {/* Memory Section */}
              <Grid item xs={12} md={6}>
                <Box
                  sx={theme => ({
                    p: 1,
                    backgroundColor: theme.palette.background.muted,
                    borderRadius: 1,
                    border: `1px solid ${theme.palette.divider}`,
                  })}
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center' }}
                  >
                    <Icon icon="mdi:memory" style={{ marginRight: 4, fontSize: 16 }} />
                    Memory
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Requests:
                  </Typography>
                  <Typography variant="body1">
                    {formatMemoryValue(formData.memoryRequest)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Limits:
                  </Typography>
                  <Typography variant="body1">{formatMemoryValue(formData.memoryLimit)}</Typography>
                </Box>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        {/* Access Section with Scroll */}
        <Grid item xs={12}>
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:account-group" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Access Control ({formData.userAssignments.length} assignee
              {formData.userAssignments.length !== 1 ? 's' : ''})
            </Typography>
            <Box
              sx={{
                maxHeight: '200px',
                overflowY: 'auto',
                border: '1px solid #e0e0e0',
                borderRadius: 1,
                p: 1,
              }}
            >
              {formData.userAssignments.map((assignment, idx) => (
                <Box
                  key={idx}
                  sx={theme => ({
                    mb: 2,
                    p: 1,
                    backgroundColor: theme.palette.background.muted,
                    borderRadius: 1,
                    border: `1px solid ${theme.palette.divider}`,
                  })}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    Assignee {idx + 1}:
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 1 }}>
                    {assignment.email || 'Not specified'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    Role:
                  </Typography>
                  <Typography variant="body1">{assignment.role}</Typography>
                </Box>
              ))}
            </Box>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
