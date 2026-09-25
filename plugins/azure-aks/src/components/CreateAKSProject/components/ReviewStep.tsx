// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Card, Grid, Typography } from '@mui/material';
import React from 'react';
import type { ReviewStepProps } from '../types';
import { formatCpuValue, formatMemoryValue } from '../validators';

/**
 * Review step component for displaying configuration summary
 */
export const ReviewStep: React.FC<ReviewStepProps> = ({ formData, subscriptions, clusters }) => {
  const { t } = useTranslation();
  const selectedSubscription = subscriptions.find(sub => sub.id === formData.subscription);
  const selectedCluster = clusters.find(c => c.name === formData.cluster);

  const sectionTitleSx = { color: 'text.primary' };
  const sectionDescriptionSx = { mb: 2, color: 'text.secondary' };

  return (
    <Box>
      <Typography variant="h5" component="h2" gutterBottom sx={sectionTitleSx}>
        {t('Review Project Configuration')}
      </Typography>
      <Typography variant="body2" sx={sectionDescriptionSx}>
        {t('Please review all the settings before creating your AKS project')}
      </Typography>

      <Grid container spacing={3}>
        {/* Basics Section */}
        <Grid item xs={12}>
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" component="h3" gutterBottom sx={sectionTitleSx}>
              {/* aria-hidden: decorative section icon — the adjacent heading text already
                  conveys the section name to screen readers.
                  MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */}
              <Icon
                icon="mdi:project"
                aria-hidden="true"
                style={{ marginRight: 8, verticalAlign: 'middle' }}
              />
              {t('Project Basics')}
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Project Name')}:
                </Typography>
                <Typography variant="body1">{formData.projectName}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Subscription')}:
                </Typography>
                <Typography variant="body1">{selectedSubscription?.name || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Cluster')}:
                </Typography>
                <Typography variant="body1">
                  {selectedCluster
                    ? `${selectedCluster.name} (${selectedCluster.location}, ${selectedCluster.version})`
                    : formData.cluster || 'N/A'}
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="body2" color="text.secondary">
                  {t('Description')}:
                </Typography>
                <Typography variant="body1">
                  {formData.description || t('No description provided')}
                </Typography>
              </Grid>
            </Grid>
          </Card>
        </Grid>

        {/* Networking and Compute Quota Side by Side */}
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ p: 2, mb: 2, height: '200px' }}>
            <Typography variant="h6" component="h3" gutterBottom sx={sectionTitleSx}>
              {/* aria-hidden: decorative section icon — see comment on "Project Basics" above.
                  MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */}
              <Icon
                icon="mdi:network"
                aria-hidden="true"
                style={{ marginRight: 8, verticalAlign: 'middle' }}
              />
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
              {/* aria-hidden: decorative section icon — see comment on "Project Basics" above.
                  MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */}
              <Icon
                icon="mdi:cpu-64-bit"
                aria-hidden="true"
                style={{ marginRight: 8, verticalAlign: 'middle' }}
              />
              {t('Compute Quota')}
            </Typography>
            <Grid container spacing={2}>
              {/* CPU Section */}
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
                    {/* aria-hidden: decorative inline icon — see comment on "Project Basics" above.
                        MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */}
                    <Icon
                      icon="mdi:cpu-64-bit"
                      aria-hidden="true"
                      style={{ marginRight: 4, fontSize: 16 }}
                    />
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

              {/* Memory Section */}
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
                    {/* aria-hidden: decorative inline icon — see comment on "Project Basics" above.
                        MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */}
                    <Icon
                      icon="mdi:memory"
                      aria-hidden="true"
                      style={{ marginRight: 4, fontSize: 16 }}
                    />
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

        {/* Access Section with Scroll */}
        <Grid item xs={12}>
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography
              id="aksd-review-access-heading"
              variant="h6"
              component="h3"
              gutterBottom
              sx={sectionTitleSx}
            >
              {/* aria-hidden: decorative section icon — see comment on "Project Basics" above.
                  MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */}
              <Icon
                icon="mdi:account-group"
                aria-hidden="true"
                style={{ marginRight: 8, verticalAlign: 'middle' }}
              />
              {t('Access Control ({{count}} assignee)', {
                count: formData.userAssignments.length,
              })}
            </Typography>
            {/* tabIndex={0} satisfies the scrollable-region-focusable axe rule (WCAG 2.1.1):
                keyboard users must be able to reach scrollable regions that may contain
                content not visible in the viewport.
                role="region" + aria-labelledby give this container an accessible name so AT
                announces it as a named landmark (e.g. "Access Control (2 assignee), region")
                instead of an unnamed group.  aria-labelledby is preferred over aria-label
                because it reuses the existing heading text, keeping the announced name
                consistent with what sighted users see.
                MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/region_role
                Deque: https://dequeuniversity.com/rules/axe/4.11/scrollable-region-focusable */}
            <Box
              tabIndex={0}
              role="region"
              aria-labelledby="aksd-review-access-heading"
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
                    {assignment.displayName
                      ? `${assignment.displayName} (${assignment.objectId})`
                      : assignment.objectId || t('Not specified')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    {t('Role')}:
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
