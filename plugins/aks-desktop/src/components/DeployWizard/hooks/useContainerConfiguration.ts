// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';

export interface ContainerConfig {
  containerStep: number;
  appName: string;
  containerImage: string;
  replicas: number;
  targetPort: number;
  servicePort: number;
  useCustomServicePort: boolean;
  serviceType: 'ClusterIP' | 'LoadBalancer';
  enableResources: boolean;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  envVars: Array<{ key: string; value: string }>;
  enableLivenessProbe: boolean;
  enableReadinessProbe: boolean;
  enableStartupProbe: boolean;
  showProbeConfigs: boolean;
  livenessPath: string;
  readinessPath: string;
  startupPath: string;
  livenessInitialDelay: number;
  livenessPeriod: number;
  livenessTimeout: number;
  livenessFailure: number;
  livenessSuccess: number;
  readinessInitialDelay: number;
  readinessPeriod: number;
  readinessTimeout: number;
  readinessFailure: number;
  readinessSuccess: number;
  startupInitialDelay: number;
  startupPeriod: number;
  startupTimeout: number;
  startupFailure: number;
  startupSuccess: number;
  enableHpa: boolean;
  hpaMinReplicas: number;
  hpaMaxReplicas: number;
  hpaTargetCpu: number;
  runAsNonRoot: boolean;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;
  enablePodAntiAffinity: boolean;
  enableTopologySpreadConstraints: boolean;
  containerPreviewYaml: string;
}

export function useContainerConfiguration(
  initialApplicationName?: string,
  initialConfig?: Partial<ContainerConfig>
) {
  const [config, setConfig] = useState<ContainerConfig>(() => {
    const defaults: ContainerConfig = {
      containerStep: 0,
      appName: initialApplicationName || '',
      containerImage: '',
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
    };

    if (!initialConfig) return defaults;

    const overrides = Object.fromEntries(
      Object.entries(initialConfig).filter(
        ([key, value]) =>
          value !== undefined &&
          key !== 'containerStep' &&
          key !== 'containerPreviewYaml' &&
          key !== 'showProbeConfigs'
      )
    );

    return { ...defaults, ...overrides };
  });

  useEffect(() => {
    if (!config.useCustomServicePort) {
      setConfig(c => ({ ...c, servicePort: c.targetPort }));
    }
  }, [config.targetPort, config.useCustomServicePort]);

  return { config, setConfig };
}
