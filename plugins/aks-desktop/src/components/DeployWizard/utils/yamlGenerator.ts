// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ContainerConfig } from '../hooks/useContainerConfiguration';

/**
 * Configuration for generating Kubernetes YAML from container settings.
 * Based on ContainerConfig but omits UI-only fields and adds namespace.
 */
export type ContainerDeploymentConfig = Omit<
  ContainerConfig,
  'containerStep' | 'showProbeConfigs' | 'containerPreviewYaml' | 'useCustomServicePort'
> & {
  namespace?: string;
};

/**
 * Type with only the fields needed for YAML generation from ContainerConfigurationState
 */
export type ContainerConfigForYaml = Omit<ContainerDeploymentConfig, 'namespace'> & {
  namespace?: string;
};

/**
 * Escapes a string for inclusion inside a YAML double-quoted scalar.
 * Handles backslashes first, then quotes and basic control characters.
 */
function escapeYamlDoubleQuoted(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Generates Kubernetes YAML for a container deployment
 * @param config - Configuration object containing all deployment settings
 * @returns Multi-document YAML string containing Deployment, Service, and optionally HPA
 */
export function generateYamlForContainer(config: ContainerConfigForYaml): string {
  const ns = config.namespace || 'default';
  const name = config.appName || 'app';
  const image = config.containerImage || 'nginx:latest';

  const envSection = config.envVars
    .filter(e => e.key.trim().length > 0)
    .map(
      e =>
        `            - name: ${e.key}
              value: "${escapeYamlDoubleQuoted(e.value)}"`
    )
    .join('\n');

  const resources = config.enableResources
    ? `\n          resources:\n            requests:\n              cpu: ${
        config.cpuRequest || '100m'
      }\n              memory: ${
        config.memoryRequest || '128Mi'
      }\n            limits:\n              cpu: ${
        config.cpuLimit || '500m'
      }\n              memory: ${config.memoryLimit || '512Mi'}`
    : '';

  const envYaml = envSection ? `\n          env:\n${envSection}` : '';

  const probeBlock = (
    type: 'liveness' | 'readiness' | 'startup',
    path: string | undefined,
    targetPort: number
  ) => {
    const initialDelay =
      type === 'liveness'
        ? config.livenessInitialDelay ?? 10
        : type === 'readiness'
        ? config.readinessInitialDelay ?? 5
        : config.startupInitialDelay ?? 0;
    const period =
      type === 'liveness'
        ? config.livenessPeriod ?? 10
        : type === 'readiness'
        ? config.readinessPeriod ?? 10
        : config.startupPeriod ?? 10;
    const timeout =
      type === 'liveness'
        ? config.livenessTimeout ?? 1
        : type === 'readiness'
        ? config.readinessTimeout ?? 1
        : config.startupTimeout ?? 1;
    const failure =
      type === 'liveness'
        ? config.livenessFailure ?? 3
        : type === 'readiness'
        ? config.readinessFailure ?? 3
        : config.startupFailure ?? 30;
    const success =
      type === 'liveness'
        ? config.livenessSuccess ?? 1
        : type === 'readiness'
        ? config.readinessSuccess ?? 1
        : config.startupSuccess ?? 1;

    return `          ${type}Probe:
            httpGet:
              path: ${path || '/'}
              port: ${targetPort}
            initialDelaySeconds: ${initialDelay}
            periodSeconds: ${period}
            timeoutSeconds: ${timeout}
            failureThreshold: ${failure}
            successThreshold: ${success}`;
  };

  const probeParts = [];
  if (config.enableLivenessProbe)
    probeParts.push(probeBlock('liveness', config.livenessPath, config.targetPort));
  if (config.enableReadinessProbe)
    probeParts.push(probeBlock('readiness', config.readinessPath, config.targetPort));
  if (config.enableStartupProbe)
    probeParts.push(probeBlock('startup', config.startupPath, config.targetPort));
  const probesSection = probeParts.length ? `\n${probeParts.join('\n')}` : '';

  const securityContextParts = [];
  if (config.runAsNonRoot) securityContextParts.push('            runAsNonRoot: true');
  if (config.readOnlyRootFilesystem)
    securityContextParts.push('            readOnlyRootFilesystem: true');
  // Always include allowPrivilegeEscalation (defaults to true in Kubernetes, so we set it explicitly)
  securityContextParts.push(
    `            allowPrivilegeEscalation: ${config.allowPrivilegeEscalation}`
  );
  // Always include securityContext since we're setting allowPrivilegeEscalation explicitly
  const securityContextYaml = `\n          securityContext:\n${securityContextParts.join('\n')}`;

  const affinityYaml = config.enablePodAntiAffinity
    ? `\n      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              topologyKey: kubernetes.io/hostname
              labelSelector:
                matchLabels:
                  app: ${name}`
    : '';

  const topologySpreadConstraintsYaml = config.enableTopologySpreadConstraints
    ? `\n      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: ${name}`
    : '';

  const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  replicas: ${config.replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:${affinityYaml}${topologySpreadConstraintsYaml}
      containers:
        - name: ${name}
          image: ${image}
          ports:
            - containerPort: ${config.targetPort}${probesSection}${resources}${envYaml}${securityContextYaml}`;

  const service = `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  type: ${config.serviceType}
  selector:
    app: ${name}
  ports:
    - port: ${config.servicePort}
      targetPort: ${config.targetPort}`;

  const hpa = config.enableHpa
    ? `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${name}
  namespace: ${ns}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${name}
  minReplicas: ${config.hpaMinReplicas ?? 1}
  maxReplicas: ${config.hpaMaxReplicas ?? 5}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: ${config.hpaTargetCpu ?? 70}`
    : '';

  const sections = [`# Deployment\n${deployment}`, `# Service\n${service}`];
  if (hpa) sections.push(`# HPA\n${hpa}`);
  return sections.join('\n---\n');
}
