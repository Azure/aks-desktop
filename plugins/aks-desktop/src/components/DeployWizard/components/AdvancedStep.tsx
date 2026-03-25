// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { CONTAINER_STEPS, type ContainerConfig } from '../hooks/useContainerConfiguration';
import { ContainerConfigProp, LabelWithInfo } from './configureContainerUtils';

interface AdvancedStepProps {
  containerConfig: ContainerConfigProp;
}

function SwitchWithDescription({
  checked,
  onChange,
  label,
  infoText,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  infoText: string;
  description: string;
}) {
  return (
    <>
      <FormControlLabel
        control={<Switch checked={checked} onChange={e => onChange(e.target.checked)} />}
        label={<LabelWithInfo label={label} infoText={infoText} />}
      />
      <Typography variant="caption" color="text.secondary" sx={{ ml: 5, display: 'block', mt: -1 }}>
        {description}
      </Typography>
    </>
  );
}

export default function AdvancedStep({ containerConfig }: AdvancedStepProps) {
  const { t } = useTranslation();
  const set = <K extends keyof ContainerConfig>(key: K) => {
    return (val: ContainerConfig[K]) => containerConfig.setConfig(c => ({ ...c, [key]: val }));
  };

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('Configure security context settings for the container.')}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SwitchWithDescription
          checked={containerConfig.config.runAsNonRoot}
          onChange={set('runAsNonRoot')}
          label={t('Run as non root user')}
          infoText={t(
            'Ensures the container runs as a non-root user (UID != 0) for better security. This prevents privilege escalation attacks.'
          )}
          description={t('Ensures the container runs as a non-root user for better security.')}
        />
        <SwitchWithDescription
          checked={containerConfig.config.readOnlyRootFilesystem}
          onChange={set('readOnlyRootFilesystem')}
          label={t('Read only root filesystem')}
          infoText={t(
            "Mounts the container's root filesystem as read-only to prevent write operations. This enhances security by preventing malicious code from modifying system files."
          )}
          description={t(
            "Mounts the container's root filesystem as read-only to prevent write operations."
          )}
        />
        <SwitchWithDescription
          checked={containerConfig.config.allowPrivilegeEscalation}
          onChange={set('allowPrivilegeEscalation')}
          label={t('Allow privilege escalation')}
          infoText={t(
            'Controls whether a process can gain more privileges than its parent process. Disabling this (recommended) prevents privilege escalation attacks.'
          )}
          description={t(
            'Controls whether a process can gain more privileges than its parent process.'
          )}
        />
        <SwitchWithDescription
          checked={containerConfig.config.enablePodAntiAffinity}
          onChange={set('enablePodAntiAffinity')}
          label={t('Enable pod anti-affinity')}
          infoText={t(
            'Prefer scheduling pods on different nodes to improve availability and fault tolerance. This helps ensure pods are distributed across the cluster.'
          )}
          description={t(
            'Prefer scheduling pods on different nodes to improve availability and fault tolerance.'
          )}
        />
        <SwitchWithDescription
          checked={containerConfig.config.enableTopologySpreadConstraints}
          onChange={set('enableTopologySpreadConstraints')}
          label={t('Enable topology spread constraints')}
          infoText={t(
            'Distributes pods evenly across nodes, zones, or other topology domains to improve workload distribution and availability.'
          )}
          description={t('Distributes pods evenly across nodes to improve workload distribution.')}
        />
      </Box>
      <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          onClick={() =>
            containerConfig.setConfig(c => ({
              ...c,
              containerStep: CONTAINER_STEPS.WORKLOAD_IDENTITY,
            }))
          }
        >
          {t('Back')}
        </Button>
      </Box>
    </>
  );
}
