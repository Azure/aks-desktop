// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';

export interface ContainerConfig {
  // Step navigation
  containerStep: number;

  // Basics
  appName: string;
  containerImage: string;
  replicas: number;

  // Networking
  targetPort: number;
  servicePort: number;
  useCustomServicePort: boolean;
  serviceType: 'ClusterIP' | 'LoadBalancer';

  // Resources
  enableResources: boolean;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;

  // Environment variables
  envVars: Array<{ key: string; value: string }>;

  // Health probes
  enableLivenessProbe: boolean;
  enableReadinessProbe: boolean;
  enableStartupProbe: boolean;
  showProbeConfigs: boolean;
  livenessPath: string;
  readinessPath: string;
  startupPath: string;

  // Liveness probe timings
  livenessInitialDelay: number;
  livenessPeriod: number;
  livenessTimeout: number;
  livenessFailure: number;
  livenessSuccess: number;

  // Readiness probe timings
  readinessInitialDelay: number;
  readinessPeriod: number;
  readinessTimeout: number;
  readinessFailure: number;
  readinessSuccess: number;

  // Startup probe timings
  startupInitialDelay: number;
  startupPeriod: number;
  startupTimeout: number;
  startupFailure: number;
  startupSuccess: number;

  // HPA
  enableHpa: boolean;
  hpaMinReplicas: number;
  hpaMaxReplicas: number;
  hpaTargetCpu: number;

  // Security context
  runAsNonRoot: boolean;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;

  // Affinity
  enablePodAntiAffinity: boolean;
  enableTopologySpreadConstraints: boolean;

  // Preview
  containerPreviewYaml: string;
}

export function useContainerConfiguration(initialApplicationName?: string) {
  const [config, setConfig] = useState<ContainerConfig>(() => ({
    // Step navigation
    containerStep: 0,

    // Basics
    appName: initialApplicationName || '',
    containerImage: '',
    replicas: 1,

    // Networking
    targetPort: 80,
    servicePort: 80,
    useCustomServicePort: false,
    serviceType: 'ClusterIP',

    // Resources
    enableResources: true,
    cpuRequest: '100m',
    cpuLimit: '500m',
    memoryRequest: '128Mi',
    memoryLimit: '512Mi',

    // Environment variables
    envVars: [{ key: '', value: '' }],

    // Health probes
    enableLivenessProbe: true,
    enableReadinessProbe: true,
    enableStartupProbe: true,
    showProbeConfigs: false,
    livenessPath: '/',
    readinessPath: '/',
    startupPath: '/',

    // Liveness probe timings
    livenessInitialDelay: 10,
    livenessPeriod: 10,
    livenessTimeout: 1,
    livenessFailure: 3,
    livenessSuccess: 1,

    // Readiness probe timings
    readinessInitialDelay: 5,
    readinessPeriod: 10,
    readinessTimeout: 1,
    readinessFailure: 3,
    readinessSuccess: 1,

    // Startup probe timings
    startupInitialDelay: 0,
    startupPeriod: 10,
    startupTimeout: 1,
    startupFailure: 30,
    startupSuccess: 1,

    // HPA
    enableHpa: false,
    hpaMinReplicas: 1,
    hpaMaxReplicas: 5,
    hpaTargetCpu: 70,

    // Security context
    runAsNonRoot: false,
    readOnlyRootFilesystem: false,
    allowPrivilegeEscalation: false,

    // Affinity
    enablePodAntiAffinity: true,
    enableTopologySpreadConstraints: true,

    // Preview
    containerPreviewYaml: '',
  }));

  // Sync servicePort with targetPort when custom service port is disabled
  useEffect(() => {
    if (!config.useCustomServicePort) {
      setConfig(c => ({ ...c, servicePort: c.targetPort }));
    }
  }, [config.targetPort, config.useCustomServicePort]);

  return { config, setConfig };
}
