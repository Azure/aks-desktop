// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import React, { useEffect, useState } from 'react';
import { usePreviewFeatures } from '../../hooks/usePreviewFeatures';
import type { ProjectDefinition } from '../../types/project';
import { ClusterDeployCard } from './components/ClusterDeployCard';
import { usePipelineSettings } from './hooks/usePipelineSettings';

interface DeployTabProps {
  project: ProjectDefinition;
}

function DeployTab({ project }: DeployTabProps) {
  const { t } = useTranslation();
  const { githubPipelines } = usePreviewFeatures();
  const { settings } = usePipelineSettings();
  // Deferred flag: starts false so the live region mounts with empty text,
  // then flips to true after the first paint so the text change is announced.
  const [liveReady, setLiveReady] = useState(false);
  useEffect(() => {
    setLiveReady(true);
  }, []);

  if (!githubPipelines) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">
          {t('Enable GitHub Pipelines in Settings → Preview Features to use pipeline deployments.')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ my: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5">{t('Workloads')}</Typography>
      </Box>

      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {liveReady && project.clusters?.length === 0 ? t('No clusters in this project.') : ''}
      </Box>

      {project.clusters?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('No clusters in this project.')}
        </Typography>
      )}

      {project.clusters?.map((clusterName, idx) => {
        // Namespace array parallels clusters; fall back to the first namespace
        // when the arrays are different lengths (single-namespace projects).
        const ns = project.namespaces?.[idx] ?? project.namespaces?.[0] ?? '';
        return (
          <ClusterDeployCard
            key={clusterName}
            cluster={clusterName}
            namespace={ns}
            pipelineEnabled={settings.githubPipelineEnabled}
          />
        );
      })}
    </Box>
  );
}

export default DeployTab;
