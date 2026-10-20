// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Step, StepButton, StepContent, Stepper, Typography } from '@mui/material';
import React from 'react';
import { CONTAINER_STEPS, type ContainerConfig } from '../hooks/useContainerConfiguration';
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
    /** Highest step reached so far; steps up to it stay navigable. */
    furthestStep: number;
  };
  /** When false, containerImage is not required to proceed past the Basics step. Default: true. */
  requireContainerImage?: boolean;
  azureContext?: DeployAzureContext;
  /** Error message from resolving the Azure context, if any. */
  azureContextError?: string;
  /** True while the Azure context is still being resolved. */
  azureContextLoading?: boolean;
  /** Target namespace for workload identity setup */
  namespace?: string;
}

export default function ConfigureContainer({
  containerConfig,
  requireContainerImage = true,
  azureContext,
  azureContextError,
  azureContextLoading,
  namespace,
}: ConfigureContainerProps) {
  const { config, setConfig, furthestStep } = containerConfig;
  const { t } = useTranslation();

  /** Returns a click handler that jumps the stepper to the given step. */
  const goToStep = (containerStep: number) => () => setConfig(c => ({ ...c, containerStep }));

  return (
    <>
      <Typography variant="h6" component="h2" gutterBottom>
        {t('Configure Container Deployment')}
      </Typography>
      <Stepper activeStep={config.containerStep} orientation="vertical">
        <Step>
          <StepButton onClick={goToStep(CONTAINER_STEPS.BASICS)}>{t('Basics')}</StepButton>
          <StepContent>
            <BasicsStep
              containerConfig={containerConfig}
              requireContainerImage={requireContainerImage}
            />
          </StepContent>
        </Step>

        <Step disabled={CONTAINER_STEPS.NETWORKING > furthestStep}>
          <StepButton onClick={goToStep(CONTAINER_STEPS.NETWORKING)}>{t('Networking')}</StepButton>
          <StepContent>
            <NetworkingStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step disabled={CONTAINER_STEPS.HEALTHCHECKS > furthestStep}>
          <StepButton onClick={goToStep(CONTAINER_STEPS.HEALTHCHECKS)}>
            {t('Healthchecks')}
          </StepButton>
          <StepContent>
            <HealthchecksStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step disabled={CONTAINER_STEPS.RESOURCES > furthestStep}>
          <StepButton onClick={goToStep(CONTAINER_STEPS.RESOURCES)}>
            {t('Resource Limits')}
          </StepButton>
          <StepContent>
            <ResourcesStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step disabled={CONTAINER_STEPS.ENV_VARS > furthestStep}>
          <StepButton onClick={goToStep(CONTAINER_STEPS.ENV_VARS)}>
            {t('Environment Variables')}
          </StepButton>
          <StepContent>
            <EnvVarsStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step disabled={CONTAINER_STEPS.HPA > furthestStep}>
          <StepButton onClick={goToStep(CONTAINER_STEPS.HPA)}>{'HPA'}</StepButton>
          <StepContent>
            <HpaStep containerConfig={containerConfig} />
          </StepContent>
        </Step>

        <Step disabled={CONTAINER_STEPS.WORKLOAD_IDENTITY > furthestStep}>
          <StepButton onClick={goToStep(CONTAINER_STEPS.WORKLOAD_IDENTITY)}>
            {t('Workload Identity')}
          </StepButton>
          <StepContent>
            <WorkloadIdentityStep
              containerConfig={containerConfig}
              azureContext={azureContext}
              azureContextError={azureContextError}
              azureContextLoading={azureContextLoading}
              namespace={namespace}
            />
          </StepContent>
        </Step>

        <Step disabled={CONTAINER_STEPS.ADVANCED > furthestStep}>
          <StepButton onClick={goToStep(CONTAINER_STEPS.ADVANCED)}>{t('Advanced')}</StepButton>
          <StepContent>
            <AdvancedStep containerConfig={containerConfig} />
          </StepContent>
        </Step>
      </Stepper>
    </>
  );
}
