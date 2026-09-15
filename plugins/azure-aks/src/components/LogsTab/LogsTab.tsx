// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
// @ts-ignore todo: LogsViewer is not importing
import { LogsViewer } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { type KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import React from 'react';
import { DeploymentSelector } from '../shared/DeploymentSelector';
import { EmptyStateCard } from '../shared/EmptyStateCard';
import { useLogsTab } from './hooks/useLogsTab';

/**
 * Props for the {@link LogsTab} component.
 */
interface LogsTabProps {
  /** All Kubernetes resources for the project; Deployments are filtered from this list. */
  projectResources: KubeObject[];
}

/**
 * Displays live logs for a deployment in the project namespace.
 *
 * Shows an empty state when no deployments exist. When multiple deployments are present,
 * renders a selector so the user can switch between them. Uses a visually-hidden live
 * region to announce the empty state to screen readers.
 *
 * @param props.projectResources - All project resources; Deployments are extracted internally.
 */
const LogsTab = ({ projectResources }: LogsTabProps) => {
  const { t } = useTranslation();
  const {
    deployments,
    selectedDeployment,
    selectedDeploymentName,
    liveReady,
    setSelectedDeploymentName,
  } = useLogsTab(projectResources);

  return (
    <>
      {/* Always-mounted live region for empty-state announcement */}
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {liveReady && deployments.length === 0 ? t('No Deployments Found') : ''}
      </Box>

      {!deployments.length ? (
        <Box sx={{ mt: 2 }}>
          <EmptyStateCard
            message={t('No Deployments Found')}
            subMessages={[
              t('There are no deployments in this project namespace yet.'),
              t('Deploy an application to view logs.'),
            ]}
          />
        </Box>
      ) : (
        <>
          {deployments.length > 1 && (
            <Box sx={{ p: 2, px: 1 }}>
              <DeploymentSelector
                selectedDeployment={selectedDeploymentName}
                deployments={deployments.map(d => ({ name: d.jsonData.metadata.name as string }))}
                onDeploymentChange={setSelectedDeploymentName}
                suppressLiveRegion
              />
            </Box>
          )}
          {selectedDeployment && (
            <LogsViewer item={selectedDeployment} key={selectedDeployment.jsonData.metadata.uid} />
          )}
        </>
      )}
    </>
  );
};

export default LogsTab;
