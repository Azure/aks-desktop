// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Divider, Link, Stack, Typography } from '@mui/material';
import React from 'react';
import { issueLabels, type Scope } from '../../types/upgradeInsights';
import { formatTime, safeDocumentationUrl } from './domain';

export default function InsightScopeDetails({ name, result }: { name: string; result: Scope }) {
  const { t } = useTranslation();
  const issues = result.evaluation?.detectedIssues ?? [];
  const window = result.context?.nextMaintenanceWindow;
  return (
    <Stack spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Typography variant="h6">
        {' '}
        {['Control plane', 'Unnamed pool'].includes(name) ? t(name) : name}
      </Typography>
      <Typography>
        {t('Evaluation: {{status}}', { status: result.evaluation?.status ?? t('Not evaluated') })}
      </Typography>
      <Typography>
        {t('Evaluated at: {{time}}', {
          time: formatTime(result.evaluation?.evaluatedAt) ?? t('Not available'),
        })}
      </Typography>
      <Typography>
        {t('Source Kubernetes version: {{version}}', {
          version: result.currentKubernetesVersion ?? t('Unknown'),
        })}
      </Typography>
      {result.kubernetesVersionSupportStatus && (
        <Typography>
          {t('Version support: {{status}}', { status: result.kubernetesVersionSupportStatus })}
        </Typography>
      )}
      {result.kubernetesVersionEndOfSupportDate && (
        <Typography>
          {t('End of support: {{time}}', {
            time: formatTime(result.kubernetesVersionEndOfSupportDate) ?? t('Not available'),
          })}
        </Typography>
      )}
      {result.context?.currentUpgradeStrategy && (
        <Typography>
          {t('Upgrade strategy: {{strategy}}', { strategy: result.context.currentUpgradeStrategy })}
        </Typography>
      )}
      {result.context?.lastSuccessfulUpgradeTime && (
        <Typography>
          {t('Last successful upgrade: {{time}}', {
            time: formatTime(result.context.lastSuccessfulUpgradeTime) ?? t('Not available'),
          })}
        </Typography>
      )}
      {window && (
        <Typography>
          {t('Next maintenance window: {{start}} – {{end}} ({{source}})', {
            start: formatTime(window.startTime) ?? t('Not available'),
            end: formatTime(window.endTime) ?? t('Not available'),
            source: window.maintenanceConfigurationName ?? window.source ?? t('Unknown'),
          })}
        </Typography>
      )}
      {!result.evaluation && (
        <Alert severity="warning">{t('This scope has not been evaluated.')}</Alert>
      )}
      {result.evaluation && !issues.length && (
        <Typography>
          {t(
            'No issues reported in this stored scope. See the evaluation status and freshness before drawing conclusions.'
          )}
        </Typography>
      )}
      {issues.map((issue, index) => (
        <Box key={index}>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle1">
            {t(issueLabels[issue.issueType ?? ''] ?? issue.issueType ?? 'Unknown issue')}
          </Typography>
          <Typography>
            {t('Severity: {{severity}}', { severity: issue.severity ?? t('Unknown') })}
          </Typography>
          <Typography>{issue.message ?? t('No issue description provided.')}</Typography>
          {!!issue.impactedResources?.length && (
            <Typography variant="subtitle2">{t('Impacted resources')}</Typography>
          )}
          {issue.impactedResources?.map((resource, resourceIndex) => (
            <Typography key={resourceIndex} sx={{ overflowWrap: 'anywhere' }}>
              {[resource.kind, resource.namespace, resource.name, resource.resourceId]
                .filter(Boolean)
                .join(' / ')}
            </Typography>
          ))}
          {!!issue.recommendedActions?.length && (
            <Typography variant="subtitle2">
              {t('Recommended actions — informational only')}
            </Typography>
          )}
          {issue.recommendedActions?.map((action, actionIndex) => {
            const href = safeDocumentationUrl(action.documentationLink);
            return (
              <Box key={actionIndex} sx={{ my: 1 }}>
                <Typography>{action.title}</Typography>
                <Typography>{action.details}</Typography>
                {href ? (
                  <Link href={href} target="_blank" rel="noopener noreferrer">
                    {t('Open remediation documentation')}
                  </Link>
                ) : action.documentationLink ? (
                  <Typography>
                    {t('Documentation link is not on the allowed HTTPS documentation hosts.')}
                  </Typography>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ))}
    </Stack>
  );
}
