// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import type { PipelineConfig } from '../types';

export function createValidConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    tenantId: 'tenant-123',
    identityId: 'identity-456',
    subscriptionId: 'sub-789',
    clusterName: 'my-cluster',
    resourceGroup: 'my-rg',
    namespace: 'production',
    appName: 'my-app',
    serviceType: 'LoadBalancer',
    repo: { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' },
    ...overrides,
  };
}

export function createContainerConfig(overrides?: Partial<ContainerConfig>): ContainerConfig {
  return {
    containerStep: 0,
    appName: 'my-app',
    containerImage: 'nginx:1.25',
    replicas: 3,
    targetPort: 8080,
    servicePort: 80,
    useCustomServicePort: false,
    serviceType: 'LoadBalancer',
    enableResources: true,
    cpuRequest: '200m',
    cpuLimit: '1',
    memoryRequest: '256Mi',
    memoryLimit: '1Gi',
    envVars: [{ key: 'NODE_ENV', value: 'production' }],
    enableLivenessProbe: true,
    enableReadinessProbe: true,
    enableStartupProbe: true,
    showProbeConfigs: false,
    livenessPath: '/health',
    readinessPath: '/ready',
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
    enableHpa: true,
    hpaMinReplicas: 2,
    hpaMaxReplicas: 10,
    hpaTargetCpu: 80,
    runAsNonRoot: true,
    readOnlyRootFilesystem: false,
    allowPrivilegeEscalation: false,
    enablePodAntiAffinity: true,
    enableTopologySpreadConstraints: true,
    containerPreviewYaml: '',
    ...overrides,
  };
}
