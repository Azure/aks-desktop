// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
// @ts-ignore todo: LogsViewer is not importing
import { LogsViewer } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { type KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { Box, Card, MenuItem, TextField, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import React, { useEffect, useMemo, useState } from 'react';

interface LogsTabProps {
  projectResources: KubeObject[];
}

const LogsTab = ({ projectResources }: LogsTabProps) => {
  const { t } = useTranslation();
  const deployments = useMemo(
    () => projectResources.filter(it => it.kind === 'Deployment'),
    [projectResources]
  );
  const [deploymentId, setDeploymentId] = useState<string>('');
  // Deferred flag: starts false so the live region mounts with empty text,
  // then flips to true after the first paint so the text change is announced.
  const [liveReady, setLiveReady] = useState(false);
  useEffect(() => {
    setLiveReady(true);
  }, []);

  if (!deploymentId && deployments.length > 0) {
    setDeploymentId(deployments[0].jsonData.metadata.uid as string);
  }

  const selectedDeployment = useMemo(
    () => deployments.find(it => it.jsonData.metadata.uid === deploymentId),
    [deployments, deploymentId]
  );

  return (
    <>
      {/* Always-mounted live region for empty-state announcement */}
      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        {liveReady && deployments.length === 0 ? t('No Deployments Found') : ''}
      </Box>

      {!deployments.length ? (
        <Card sx={{ p: 4, textAlign: 'center', mt: 2 }}>
          <Box
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            sx={{ color: 'text.secondary' }}
          >
            <Icon
              icon="mdi:chart-box-outline"
              style={{ marginBottom: 16, fontSize: 64, color: 'currentColor' }}
            />
            <Typography variant="h6" color="textSecondary" gutterBottom>
              {t('No Deployments Found')}
            </Typography>
            <Typography color="textSecondary" variant="body2">
              {t('There are no deployments in this project namespace yet.')}
            </Typography>
            <Typography color="textSecondary" variant="body2">
              {t('Deploy an application to view logs.')}
            </Typography>
          </Box>
        </Card>
      ) : (
        <>
          {deployments.length > 1 && (
            <Box sx={{ p: 2, px: 1 }}>
              <TextField
                select
                size="small"
                variant="outlined"
                onChange={e => setDeploymentId(e.target.value)}
                value={deploymentId}
                label={t('Deployment')}
              >
                {deployments.map(d => (
                  <MenuItem key={d.jsonData.metadata.uid} value={d.jsonData.metadata.uid}>
                    {d.jsonData.metadata.name}
                  </MenuItem>
                ))}
              </TextField>
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
