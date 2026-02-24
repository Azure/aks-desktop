// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Card, Chip, Grid, Typography } from '@mui/material';
import React from 'react';
import type { FormData } from '../../CreateAKSProject/types';
import { formatCpuValue, formatMemoryValue } from '../../CreateAKSProject/validators';
import type { DiscoveredNamespace } from '../hooks/useNamespaceDiscovery';

export interface FromNamespaceReviewStepProps {
  formData: FormData;
  selectedNamespace: DiscoveredNamespace;
}

export const FromNamespaceReviewStep: React.FC<FromNamespaceReviewStepProps> = ({
  formData,
  selectedNamespace,
}) => {
  const { t } = useTranslation();
  const isImportOnly = selectedNamespace.category === 'needs-import';

  const sectionTitleSx = { color: 'text.primary' };
  const sectionDescriptionSx = { mb: 2, color: 'text.secondary' };

  return (
    <Box>
      <Typography variant="h5" component="h2" gutterBottom sx={sectionTitleSx}>
        {t('Review Configuration')}
      </Typography>
      <Typography variant="body2" sx={sectionDescriptionSx}>
        {isImportOnly
          ? t('Review the namespace to import as a project')
          : t('Review the configuration before converting this namespace into a project')}
      </Typography>

      <Grid container spacing={3}>
        {/* Namespace / Project Basics */}
        <Grid item xs={12}>
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" component="h3" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:project" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {t('Namespace Details')}
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Namespace / Project Name')}:
                </Typography>
                <Typography variant="body1">{selectedNamespace.name}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Cluster')}:
                </Typography>
                <Typography variant="body1">{selectedNamespace.clusterName}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Resource Group')}:
                </Typography>
                <Typography variant="body1">{selectedNamespace.resourceGroup}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Subscription')}:
                </Typography>
                <Typography variant="body1" sx={{ fontSize: '0.85rem' }}>
                  {selectedNamespace.subscriptionId}
                </Typography>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        {/* Labels to Apply */}
        <Grid item xs={12}>
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" component="h3" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:label-multiple" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {isImportOnly ? t('Existing Project Labels') : t('Labels to Apply')}
            </Typography>
            {isImportOnly ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('This namespace already has project labels. It will be imported locally.')}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t(
                  'The following labels will be applied to convert this namespace into a project:'
                )}
              </Typography>
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip
                label={`headlamp.dev/project-id=${selectedNamespace.name}`}
                size="small"
                variant="outlined"
                color="primary"
              />
              <Chip
                label="headlamp.dev/project-managed-by=aks-desktop"
                size="small"
                variant="outlined"
                color="primary"
              />
              <Chip
                label={`aks-desktop/project-subscription=${selectedNamespace.subscriptionId}`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={`aks-desktop/project-resource-group=${selectedNamespace.resourceGroup}`}
                size="small"
                variant="outlined"
              />
            </Box>
          </Card>
        </Grid>

        {/* Networking and Compute Quota Side by Side */}
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ p: 2, mb: 2, height: '200px' }}>
            <Typography variant="h6" component="h3" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:network" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {t('Networking Policies')}
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  {t('Ingress Policy')}:
                </Typography>
                <Typography variant="body1">{formData.ingress}</Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  {t('Egress Policy')}:
                </Typography>
                <Typography variant="body1">{formData.egress}</Typography>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ p: 2, mb: 2, height: '200px' }}>
            <Typography variant="h6" component="h3" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:cpu-64-bit" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {t('Compute Quota')}
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Box
                  sx={theme => ({
                    p: 1,
                    // @ts-ignore todo: fix palette type so background.muted is recognized
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
                    {t('CPU')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('Requests')}:
                  </Typography>
                  <Typography variant="body1">{formatCpuValue(formData.cpuRequest)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('Limits')}:
                  </Typography>
                  <Typography variant="body1">{formatCpuValue(formData.cpuLimit)}</Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Box
                  sx={theme => ({
                    p: 1,
                    // @ts-ignore todo: fix palette type so background.muted is recognized
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
                    {t('Memory')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('Requests')}:
                  </Typography>
                  <Typography variant="body1">
                    {formatMemoryValue(formData.memoryRequest)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('Limits')}:
                  </Typography>
                  <Typography variant="body1">{formatMemoryValue(formData.memoryLimit)}</Typography>
                </Box>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        {/* Access Section */}
        <Grid item xs={12}>
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" component="h3" gutterBottom sx={sectionTitleSx}>
              <Icon icon="mdi:account-group" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {t('Access Control ({{count}} assignee)', {
                count: formData.userAssignments.length,
              })}
            </Typography>
            {formData.userAssignments.length === 0 ||
            (formData.userAssignments.length === 1 &&
              formData.userAssignments[0].email.trim() === '') ? (
              <Typography variant="body2" color="text.secondary">
                {t('No users to assign')}
              </Typography>
            ) : (
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
                      // @ts-ignore todo: fix palette type so background.muted is recognized
                      backgroundColor: theme.palette.background.muted,
                      borderRadius: 1,
                      border: `1px solid ${theme.palette.divider}`,
                    })}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                      {`${t('Assignee')} ${idx + 1}`}:
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 1 }}>
                      {assignment.email || t('Not specified')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                      {t('Role')}:
                    </Typography>
                    <Typography variant="body1">{assignment.role}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
