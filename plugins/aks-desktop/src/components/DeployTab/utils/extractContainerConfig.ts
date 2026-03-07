// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';

interface KubeContainer {
  image?: string;
  ports?: Array<{ containerPort?: number }>;
  env?: Array<{ name?: string; value?: string }>;
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  securityContext?: {
    runAsNonRoot?: boolean;
    readOnlyRootFilesystem?: boolean;
    allowPrivilegeEscalation?: boolean;
  };
  livenessProbe?: KubeProbe;
  readinessProbe?: KubeProbe;
  startupProbe?: KubeProbe;
}

interface KubeProbe {
  httpGet?: { path?: string };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
}

interface KubeDeploymentInput {
  metadata?: { name?: string };
  spec?: {
    replicas?: number;
    template?: {
      spec?: {
        containers?: KubeContainer[];
        securityContext?: { runAsNonRoot?: boolean };
        affinity?: { podAntiAffinity?: unknown };
        topologySpreadConstraints?: unknown[];
      };
    };
  };
}

interface KubeServiceInput {
  spec?: {
    type?: string;
    ports?: Array<{ port?: number }>;
  };
}

/**
 * Extracts a partial ContainerConfig from a live K8s Deployment (and optional
 * Service) resource so the DeployWizard can be pre-populated for editing.
 *
 * Only HTTP GET probes are extracted — exec / TCP probes are ignored and the
 * corresponding enable flag is set to false.
 */
export function extractContainerConfigFromDeployment(
  deployment: KubeDeploymentInput | null | undefined,
  service?: KubeServiceInput
): Partial<ContainerConfig> {
  const meta = deployment?.metadata ?? {};
  const spec = deployment?.spec ?? {};
  const templateSpec = spec?.template?.spec ?? {};
  const container = templateSpec?.containers?.[0];

  if (!container) {
    return { appName: meta.name ?? '' };
  }

  const result: Partial<ContainerConfig> = {
    appName: meta.name ?? '',
    containerImage: container.image ?? '',
    replicas: spec.replicas ?? 1,
    targetPort: container.ports?.[0]?.containerPort ?? 80,
  };

  if (Array.isArray(container.env) && container.env.length > 0) {
    result.envVars = container.env
      .filter(e => e.name)
      .map(e => ({ key: e.name!, value: e.value ?? '' }));
  }

  const resources = container.resources;
  if (resources && (resources.requests || resources.limits)) {
    result.enableResources = true;
    result.cpuRequest = resources.requests?.cpu ?? '100m';
    result.cpuLimit = resources.limits?.cpu ?? '500m';
    result.memoryRequest = resources.requests?.memory ?? '128Mi';
    result.memoryLimit = resources.limits?.memory ?? '512Mi';
  } else {
    result.enableResources = false;
  }

  Object.assign(result, extractProbe(container.livenessProbe, 'liveness'));
  Object.assign(result, extractProbe(container.readinessProbe, 'readiness'));
  Object.assign(result, extractProbe(container.startupProbe, 'startup'));

  const secCtx = container.securityContext;
  if (secCtx) {
    result.runAsNonRoot = secCtx.runAsNonRoot ?? false;
    result.readOnlyRootFilesystem = secCtx.readOnlyRootFilesystem ?? false;
    result.allowPrivilegeEscalation = secCtx.allowPrivilegeEscalation ?? false;
  }

  // runAsNonRoot can also be set at the pod level
  const podSecCtx = templateSpec.securityContext;
  if (podSecCtx?.runAsNonRoot && !secCtx?.runAsNonRoot) {
    result.runAsNonRoot = true;
  }

  result.enablePodAntiAffinity = !!templateSpec.affinity?.podAntiAffinity;
  result.enableTopologySpreadConstraints =
    Array.isArray(templateSpec.topologySpreadConstraints) &&
    templateSpec.topologySpreadConstraints.length > 0;

  if (service) {
    const svcSpec = service?.spec ?? {};
    result.serviceType = svcSpec.type === 'LoadBalancer' ? 'LoadBalancer' : 'ClusterIP';
    const svcPort = svcSpec.ports?.[0]?.port;
    if (svcPort !== undefined && svcPort !== null) {
      result.servicePort = svcPort;
      result.useCustomServicePort = svcPort !== result.targetPort;
    }
  }

  return result;
}

function extractProbe(
  probe: KubeProbe | undefined,
  type: 'liveness' | 'readiness' | 'startup'
): Partial<ContainerConfig> {
  const result: Partial<ContainerConfig> = {};
  if (type === 'liveness') {
    if (!probe || !probe.httpGet) {
      result.enableLivenessProbe = false;
      result.livenessPath = '/';
      result.livenessInitialDelay = 0;
      result.livenessPeriod = 10;
      result.livenessTimeout = 1;
      result.livenessFailure = 3;
      result.livenessSuccess = 1;
      return result;
    }
    result.enableLivenessProbe = true;
    result.livenessPath = probe.httpGet.path ?? '/';
    result.livenessInitialDelay = probe.initialDelaySeconds ?? 0;
    result.livenessPeriod = probe.periodSeconds ?? 10;
    result.livenessTimeout = probe.timeoutSeconds ?? 1;
    result.livenessFailure = probe.failureThreshold ?? 3;
    result.livenessSuccess = probe.successThreshold ?? 1;
  } else if (type === 'readiness') {
    if (!probe || !probe.httpGet) {
      result.enableReadinessProbe = false;
      result.readinessPath = '/';
      result.readinessInitialDelay = 0;
      result.readinessPeriod = 10;
      result.readinessTimeout = 1;
      result.readinessFailure = 3;
      result.readinessSuccess = 1;
      return result;
    }
    result.enableReadinessProbe = true;
    result.readinessPath = probe.httpGet.path ?? '/';
    result.readinessInitialDelay = probe.initialDelaySeconds ?? 0;
    result.readinessPeriod = probe.periodSeconds ?? 10;
    result.readinessTimeout = probe.timeoutSeconds ?? 1;
    result.readinessFailure = probe.failureThreshold ?? 3;
    result.readinessSuccess = probe.successThreshold ?? 1;
  } else {
    if (!probe || !probe.httpGet) {
      result.enableStartupProbe = false;
      result.startupPath = '/';
      result.startupInitialDelay = 0;
      result.startupPeriod = 10;
      result.startupTimeout = 1;
      result.startupFailure = 3;
      result.startupSuccess = 1;
      return result;
    }
    result.enableStartupProbe = true;
    result.startupPath = probe.httpGet.path ?? '/';
    result.startupInitialDelay = probe.initialDelaySeconds ?? 0;
    result.startupPeriod = probe.periodSeconds ?? 10;
    result.startupTimeout = probe.timeoutSeconds ?? 1;
    result.startupFailure = probe.failureThreshold ?? 3;
    result.startupSuccess = probe.successThreshold ?? 1;
  }
  return result;
}
