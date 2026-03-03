// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { WizardStep } from '../hooks/useDeployWizard';
import DeployWizardPure, { DeployWizardPureProps } from './DeployWizardPure';

const noOp = () => {};
const noOpAsync = async () => {};

const containerConfigStub = {
  config: {
    containerStep: 0,
    appName: '',
    containerImage: '',
    replicas: 1,
    targetPort: 80,
    servicePort: 80,
    useCustomServicePort: false,
    serviceType: 'ClusterIP' as const,
    enableResources: true,
    cpuRequest: '100m',
    cpuLimit: '500m',
    memoryRequest: '128Mi',
    memoryLimit: '512Mi',
    envVars: [{ key: '', value: '' }],
    enableLivenessProbe: true,
    enableReadinessProbe: true,
    enableStartupProbe: true,
    showProbeConfigs: false,
    livenessPath: '/',
    readinessPath: '/',
    startupPath: '/',
    livenessInitialDelay: 10,
    livenessPeriod: 10,
    livenessTimeout: 1,
    livenessFailure: 3,
    livenessSuccess: 1,
    readinessInitialDelay: 5,
    readinessPeriod: 10,
    readinessTimeout: 1,
    readinessFailure: 3,
    readinessSuccess: 1,
    startupInitialDelay: 0,
    startupPeriod: 10,
    startupTimeout: 1,
    startupFailure: 30,
    startupSuccess: 1,
    enableHpa: false,
    hpaMinReplicas: 1,
    hpaMaxReplicas: 5,
    hpaTargetCpu: 70,
    runAsNonRoot: false,
    readOnlyRootFilesystem: false,
    allowPrivilegeEscalation: false,
    enablePodAntiAffinity: true,
    enableTopologySpreadConstraints: true,
    containerPreviewYaml: '',
  },
  setConfig: noOp as any,
};

const baseArgs: DeployWizardPureProps = {
  activeStep: WizardStep.SOURCE,
  sourceType: null,
  setSourceType: noOp as any,
  yamlEditorValue: '',
  setYamlEditorValue: noOp as any,
  yamlError: null,
  setYamlError: noOp as any,
  deploying: false,
  deployResult: null,
  deployMessage: '',
  userPreviewYaml: '',
  containerConfig: containerConfigStub,
  namespace: 'default',
  handleNext: noOp,
  handleBack: noOp,
  handleStepClick: noOp,
  handleDeploy: noOpAsync,
  isStepValid: () => true,
  onClose: noOp,
  stepContent: <div>Step content</div>,
};

export default {
  title: 'DeployWizard/DeployWizardPure',
  component: DeployWizardPure,
  decorators: [
    (Story: any) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
} as Meta;

const Template: StoryFn<DeployWizardPureProps> = args => <DeployWizardPure {...args} />;

export const SourceStep = Template.bind({});
SourceStep.args = {
  ...baseArgs,
  activeStep: WizardStep.SOURCE,
  sourceType: null,
  stepContent: <div>Source step content</div>,
};

export const SourceStepYamlSelected = Template.bind({});
SourceStepYamlSelected.args = {
  ...baseArgs,
  activeStep: WizardStep.SOURCE,
  sourceType: 'yaml',
  stepContent: <div>Source step — YAML selected</div>,
};

export const DeployStepSuccess = Template.bind({});
DeployStepSuccess.args = {
  ...baseArgs,
  activeStep: WizardStep.DEPLOY,
  sourceType: 'yaml',
  deployResult: 'success',
  deployMessage: 'Applied 1 resource successfully.',
  userPreviewYaml: '',
  stepContent: <div>Deploy step content</div>,
};

export const DeployStepError = Template.bind({});
DeployStepError.args = {
  ...baseArgs,
  activeStep: WizardStep.DEPLOY,
  sourceType: 'yaml',
  deployResult: 'error',
  deployMessage:
    'Failed to apply Deployment/web-frontend in namespace production: ImagePullBackOff — back-off pulling image "registry.example.com/web-frontend:v2.3.1": unauthorized',
  userPreviewYaml: '',
  stepContent: <div>Deploy step content</div>,
};

/** Deploy button in the loading / in-flight state (`deploying: true`, no result yet). */
export const DeployStepDeploying = Template.bind({});
DeployStepDeploying.args = {
  ...baseArgs,
  activeStep: WizardStep.DEPLOY,
  sourceType: 'yaml',
  deploying: true,
  deployResult: null,
  deployMessage: '',
  userPreviewYaml: '',
  stepContent: <div>Deploy step content</div>,
};

/** Container source type selected on the source step. */
export const ContainerSourceSelected = Template.bind({});
ContainerSourceSelected.args = {
  ...baseArgs,
  activeStep: WizardStep.SOURCE,
  sourceType: 'container',
  stepContent: <div>Source step — Container selected</div>,
};

/** "Next" button disabled because the current step is invalid. */
export const NextButtonDisabled = Template.bind({});
NextButtonDisabled.args = {
  ...baseArgs,
  activeStep: WizardStep.SOURCE,
  isStepValid: () => false,
  stepContent: <div>Source step — no source selected</div>,
};
