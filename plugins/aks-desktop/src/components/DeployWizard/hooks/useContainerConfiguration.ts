// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect, useState } from 'react';

/**
 * Flat configuration state for the container deployment wizard.
 * Organized by section: UI state, Basic, Networking, Resources,
 * Environment variables, Health probes, HPA, Security,
 * Workload Identity, and Scheduling.
 */
export interface ContainerConfig {
  // -- UI state --
  containerStep: number;
  showProbeConfigs: boolean;
  containerPreviewYaml: string;

  // -- Basic --
  appName: string;
  containerImage: string;
  replicas: number;

  // -- Networking --
  targetPort: number;
  servicePort: number;
  useCustomServicePort: boolean;
  serviceType: 'ClusterIP' | 'LoadBalancer';

  // -- Resources --
  enableResources: boolean;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;

  // -- Environment variables --
  envVars: Array<{ key: string; value: string; isSecret: boolean }>;

  // -- Health probes --
  enableLivenessProbe: boolean;
  enableReadinessProbe: boolean;
  enableStartupProbe: boolean;
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

  // -- HPA --
  enableHpa: boolean;
  hpaMinReplicas: number;
  hpaMaxReplicas: number;
  hpaTargetCpu: number;

  // -- Security --
  runAsNonRoot: boolean;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;

  // -- Workload Identity --
  /** Whether to enable Azure Workload Identity for this deployment. */
  enableWorkloadIdentity: boolean;
  /** The Azure AD client ID of the managed identity. */
  workloadIdentityClientId: string;
  /** The Kubernetes ServiceAccount name for workload identity binding. */
  workloadIdentityServiceAccount: string;

  // -- Scheduling --
  enablePodAntiAffinity: boolean;
  enableTopologySpreadConstraints: boolean;
}

/** Named indices for the container configuration stepper. */
export const CONTAINER_STEPS = {
  BASICS: 0,
  NETWORKING: 1,
  HEALTHCHECKS: 2,
  RESOURCES: 3,
  ENV_VARS: 4,
  HPA: 5,
  WORKLOAD_IDENTITY: 6,
  ADVANCED: 7,
} as const;

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
      envVars: [{ key: '', value: '', isSecret: false }],
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
      enableWorkloadIdentity: false,
      workloadIdentityClientId: '',
      workloadIdentityServiceAccount: '',
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
