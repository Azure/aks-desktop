// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Meta, StoryFn } from '@storybook/react';
import React from 'react';
import type { ContainerConfig } from '../hooks/useContainerConfiguration';
import HealthchecksStep from './HealthchecksStep';

const baseConfig: ContainerConfig = {
  containerStep: 2,
  appName: 'test-app',
  containerImage: 'nginx:latest',
  replicas: 1,
  targetPort: 80,
  servicePort: 80,
  useCustomServicePort: false,
  serviceType: 'ClusterIP',
  enableResources: true,
  cpuRequest: '100m',
  cpuLimit: '500m',
  memoryRequest: '128Mi',
  memoryLimit: '512Mi',
  envVars: [{ key: '', value: '', isSecret: false }],
  enableLivenessProbe: true,
  enableReadinessProbe: true,
  enableStartupProbe: true,
  showProbeConfigs: false,
  livenessPath: '/healthz',
  readinessPath: '/ready',
  startupPath: '/startup',
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
  enableWorkloadIdentity: false,
  workloadIdentityClientId: '',
  workloadIdentityServiceAccount: '',
  enablePodAntiAffinity: true,
  enableTopologySpreadConstraints: true,
  containerPreviewYaml: '',
};

interface HealthchecksStoryArgs {
  initialConfig: Partial<ContainerConfig>;
}

export default {
  title: 'DeployWizard/HealthchecksStep',
  component: HealthchecksStep,
} as Meta;

const Template: StoryFn<HealthchecksStoryArgs> = args => {
  const [config, setConfig] = React.useState<ContainerConfig>({
    ...baseConfig,
    ...args.initialConfig,
  });

  return <HealthchecksStep containerConfig={{ config, setConfig }} />;
};

/** Default state with probe detail fields hidden. */
export const DefaultCollapsed = Template.bind({});
DefaultCollapsed.args = {
  initialConfig: {},
};

/** All probe detail fields expanded with Kubernetes-valid defaults. */
export const ExpandedDefaults = Template.bind({});
ExpandedDefaults.args = {
  initialConfig: {
    showProbeConfigs: true,
  },
};

/**
 * Stale liveness/startup success values are shown as fixed `1`, while readiness remains configurable.
 */
export const SuccessThresholdConstraints = Template.bind({});
SuccessThresholdConstraints.args = {
  initialConfig: {
    showProbeConfigs: true,
    livenessSuccess: 5,
    readinessSuccess: 3,
    startupSuccess: 4,
  },
};
