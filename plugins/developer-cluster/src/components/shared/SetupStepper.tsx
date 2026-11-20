// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// The Setup frame. Its header has a link back to Overview, the title with a `Preview` tag and three
// steps, where Review and the running Create share the third. A registered cluster is managed on
// Overview, so every step except Create's outcome goes there once the refresh reports one; a reload
// after Create therefore lands on Overview.

import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, Chip, Stack, Step, StepLabel, Stepper, Typography } from '@mui/material';
import { ReactNode } from 'react';
import { Link, Redirect } from 'react-router-dom';
import { SetupStep } from '../../common/gates';
import { PLUGIN_ROUTES } from '../../contract/routes';
import { WorkflowState } from '../../workflow/store';
import { Translate } from './failureText';

function stepperIndex(step: SetupStep): number {
  switch (step) {
    case 'environment':
      return 0;
    case 'configure':
      return 1;
    case 'review':
    case 'create':
      return 2;
  }
}

function stepLabels(t: Translate): string[] {
  return [
    String(t('Environment')),
    String(t('Cluster configuration')),
    String(t('Review and create')),
  ];
}

export function SetupStepper({ active }: { readonly active: SetupStep }) {
  const { t } = useTranslation();
  return (
    <Stepper activeStep={stepperIndex(active)}>
      {stepLabels(t).map((label, index) => (
        // Keyed by position: `t()` returns '' until the plugin's translations load.
        <Step key={index}>
          <StepLabel>{label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}

interface SetupFrameProps {
  readonly step: SetupStep;
  readonly state: WorkflowState;
  readonly children: ReactNode;
}

export function SetupFrame({ step, state, children }: SetupFrameProps) {
  const { t } = useTranslation();
  if (step !== 'create' && state.target !== null) {
    return <Redirect to={PLUGIN_ROUTES.overview} />;
  }
  return (
    <Box sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
      <Stack spacing={3}>
        <Box>
          <Button
            component={Link}
            to={PLUGIN_ROUTES.overview}
            size="small"
            startIcon={<Icon icon="mdi:arrow-left" />}
            sx={{ px: 0 }}
          >
            {t('Back to Developer Cluster')}
          </Button>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h4" component="h1">
              {t('Set up Developer Cluster')}
            </Typography>
            <Chip label={String(t('Preview'))} size="small" sx={{ borderRadius: 1 }} />
          </Stack>
        </Box>
        <SetupStepper active={step} />
        {children}
      </Stack>
    </Box>
  );
}
