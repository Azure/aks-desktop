// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Step, StepContent, StepLabel, Stepper, Typography } from '@mui/material';
import React from 'react';
import { ContainerConfig } from '../hooks/useContainerConfiguration';
import AdvancedStep from './AdvancedStep';
import BasicsStep from './BasicsStep';
import type { DeployAzureContext } from './configureContainerUtils';
import EnvVarsStep from './EnvVarsStep';
import HealthchecksStep from './HealthchecksStep';
import HpaStep from './HpaStep';
import NetworkingStep from './NetworkingStep';
import ResourcesStep from './ResourcesStep';
import WorkloadIdentityStep from './WorkloadIdentityStep';

interface ConfigureContainerProps {
  containerConfig: {
    config: ContainerConfig;
    setConfig: React.Dispatch<React.SetStateAction<ContainerConfig>>;
  };
  /** When false, containerImage is not required to proceed past the Basics step. Default: true. */
  requireContainerImage?: boolean;
  /** Azure context needed for workload identity setup */
  azureContext?: DeployAzureContext;
  /** Target namespace for workload identity setup */
  namespace?: string;
}

export default function ConfigureContainer({
  containerConfig,
  requireContainerImage = true,
  azureContext,
  namespace,
}: ConfigureContainerProps) {
  const { t } = useTranslation();

  return (
    <>
      <Typography variant="h6" component="h2" gutterBottom>
        {t('Configure Container Deployment')}
      </Typography>
      <Stepper activeStep={containerConfig.config.containerStep} orientation="vertical">
        <Step>
          <StepLabel>{t('Basics')}</StepLabel>
          <StepContent>
            <BasicsStep
              containerConfig={containerConfig}
              requireContainerImage={requireContainerImage}
            />
          </StepContent>
        </Step>

        <Step>
          <StepLabel>{t('Networking')}</StepLabel>
          <StepContent>
            <NetworkingStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step>
          <StepLabel>{t('Healthchecks')}</StepLabel>
          <StepContent>
            <HealthchecksStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step>
          <StepLabel>{t('Resource Limits')}</StepLabel>
          <StepContent>
            <ResourcesStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step>
          <StepLabel>{t('Environment Variables')}</StepLabel>
          <StepContent>
            <EnvVarsStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step>
          <StepLabel>{'HPA'}</StepLabel>
          <StepContent>
            <HpaStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step>
          <StepLabel>{t('Workload Identity')}</StepLabel>
          <StepContent>
            <WorkloadIdentityStep
              containerConfig={containerConfig}
              azureContext={azureContext}
              namespace={namespace}
            />
          </StepContent>
        </Step>

        <Step>
          <StepLabel>{t('Advanced')}</StepLabel>
          <StepContent>
            <AdvancedStep containerConfig={containerConfig} />
          </StepContent>
        </Step>
      </Stepper>
    </>
  );
}
