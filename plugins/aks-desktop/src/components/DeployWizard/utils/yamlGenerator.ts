// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import YAML from 'yaml';
import { normalizeK8sName } from '../../../utils/kubernetes/k8sNames';
import { getServiceAccountName } from '../../../utils/kubernetes/serviceAccountNames';
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

/** Helper to create a YAML Scalar with explicit double-quoting. */
function quoted(value: string): YAML.Scalar {
  const s = new YAML.Scalar(value);
  s.type = YAML.Scalar.QUOTE_DOUBLE;
  return s;
}

/**
 * Generates Kubernetes YAML for a container deployment
 * @param config - Configuration object containing all deployment settings
 * @returns Multi-document YAML string containing optional Secret, optional ServiceAccount,
 * Deployment, Service, and optionally HPA
 */
export function generateYamlForContainer(config: ContainerDeploymentConfig): string {
  const ns = config.namespace || 'default';
  const name = config.appName || 'app';
  const image = config.containerImage || 'nginx:latest';

  const activeEnvVars = config.envVars.filter(e => e.key.trim().length > 0);
  const plainEnvVars = activeEnvVars.filter(e => !e.isSecret);
  const secretEnvVars = activeEnvVars.filter(e => e.isSecret);
  const secretName = normalizeK8sName(`${name}-env-secrets`);

  // Pod-level WI config (label + serviceAccountName) should be preserved even without
  // client ID — edit flows may not have it since it lives on the ServiceAccount annotation.
  // The ServiceAccount manifest (below) is only emitted when client ID is available.
  const wiPodConfigEnabled = !!config.enableWorkloadIdentity;
  const wiFullEnabled = config.enableWorkloadIdentity && config.workloadIdentityClientId;
  const saName = config.workloadIdentityServiceAccount || getServiceAccountName(name);

  // --- Build env entries ---
  const envEntries: object[] = [
    ...plainEnvVars.map(e => ({
      name: e.key,
      value: quoted(e.value),
    })),
    ...secretEnvVars.map(e => ({
      name: e.key,
      valueFrom: {
        secretKeyRef: {
          name: secretName,
          key: quoted(e.key),
        },
      },
    })),
  ];

  // --- Build probe objects ---
  function buildProbe(
    type: 'liveness' | 'readiness' | 'startup',
    path: string | undefined
  ): object {
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

    return {
      httpGet: {
        path: path || '/',
        port: config.targetPort,
      },
      initialDelaySeconds: initialDelay,
      periodSeconds: period,
      timeoutSeconds: timeout,
      failureThreshold: failure,
      successThreshold: success,
    };
  }

  // --- Build container object ---
  const container: Record<string, unknown> = {
    name,
    image,
    ports: [{ containerPort: config.targetPort }],
  };

  if (config.enableLivenessProbe) {
    container.livenessProbe = buildProbe('liveness', config.livenessPath);
  }
  if (config.enableReadinessProbe) {
    container.readinessProbe = buildProbe('readiness', config.readinessPath);
  }
  if (config.enableStartupProbe) {
    container.startupProbe = buildProbe('startup', config.startupPath);
  }

  if (config.enableResources) {
    container.resources = {
      requests: {
        cpu: config.cpuRequest || '100m',
        memory: config.memoryRequest || '128Mi',
      },
      limits: {
        cpu: config.cpuLimit || '500m',
        memory: config.memoryLimit || '512Mi',
      },
    };
  }

  if (envEntries.length > 0) {
    container.env = envEntries;
  }

  // Always include securityContext since we're setting allowPrivilegeEscalation explicitly
  const securityContext: Record<string, boolean> = {};
  if (config.runAsNonRoot) securityContext.runAsNonRoot = true;
  if (config.readOnlyRootFilesystem) securityContext.readOnlyRootFilesystem = true;
  securityContext.allowPrivilegeEscalation = config.allowPrivilegeEscalation;
  container.securityContext = securityContext;

  // --- Build pod template labels ---
  const podLabels: Record<string, unknown> = { app: name };
  if (wiPodConfigEnabled) {
    podLabels['azure.workload.identity/use'] = quoted('true');
  }

  // --- Build pod spec ---
  const podSpec: Record<string, unknown> = {};

  if (config.enablePodAntiAffinity) {
    podSpec.affinity = {
      podAntiAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 100,
            podAffinityTerm: {
              topologyKey: 'kubernetes.io/hostname',
              labelSelector: {
                matchLabels: { app: name },
              },
            },
          },
        ],
      },
    };
  }

  if (config.enableTopologySpreadConstraints) {
    podSpec.topologySpreadConstraints = [
      {
        maxSkew: 1,
        topologyKey: 'kubernetes.io/hostname',
        whenUnsatisfiable: 'ScheduleAnyway',
        labelSelector: {
          matchLabels: { app: name },
        },
      },
    ];
  }

  if (wiPodConfigEnabled) {
    podSpec.serviceAccountName = saName;
  }

  podSpec.containers = [container];

  // --- Build Deployment ---
  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      namespace: ns,
      annotations: {
        'aks-project/deployed-by': 'manual',
      },
    },
    spec: {
      replicas: config.replicas,
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: podLabels,
        },
        spec: podSpec,
      },
    },
  };

  // --- Build Service ---
  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name,
      namespace: ns,
    },
    spec: {
      type: config.serviceType,
      selector: { app: name },
      ports: [
        {
          port: config.servicePort,
          targetPort: config.targetPort,
        },
      ],
    },
  };

  // --- Build HPA ---
  const hpa = config.enableHpa
    ? {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: {
          name,
          namespace: ns,
        },
        spec: {
          scaleTargetRef: {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            name,
          },
          minReplicas: config.hpaMinReplicas ?? 1,
          maxReplicas: config.hpaMaxReplicas ?? 5,
          metrics: [
            {
              type: 'Resource',
              resource: {
                name: 'cpu',
                target: {
                  type: 'Utilization',
                  averageUtilization: config.hpaTargetCpu ?? 70,
                },
              },
            },
          ],
        },
      }
    : null;

  // --- Assemble sections ---
  const stringify = (obj: object) => YAML.stringify(obj).trim();
  const sections: string[] = [];

  // Emit a Secret manifest whenever there are any secret env vars, ensuring every
  // secretKeyRef in the Deployment has a matching key in the Secret. For edit flows
  // where values can't be read back, blank values are emitted as empty strings so the
  // Secret still contains the key (avoiding broken references).
  if (secretEnvVars.length > 0) {
    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: secretName,
        namespace: ns,
      },
      type: 'Opaque',
      stringData: {} as Record<string, string>,
    };
    const doc = new YAML.Document(secret);
    // Replace the stringData node with a YAMLMap that has double-quoted keys and values
    const sdMap = new YAML.YAMLMap();
    for (const e of secretEnvVars) {
      sdMap.add(new YAML.Pair(quoted(e.key), quoted(e.value)));
    }
    doc.setIn(['stringData'], sdMap);
    sections.push(`# Secret\n${doc.toString().trim()}`);
  }

  if (wiFullEnabled) {
    const serviceAccount = {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: {
        name: saName,
        namespace: ns,
        annotations: {
          'azure.workload.identity/client-id': quoted(config.workloadIdentityClientId),
        },
      },
    };
    sections.push(`# ServiceAccount\n${stringify(serviceAccount)}`);
  }

  sections.push(`# Deployment\n${stringify(deployment)}`, `# Service\n${stringify(service)}`);
  if (hpa) sections.push(`# HPA\n${stringify(hpa)}`);
  return sections.join('\n---\n');
}
