// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { extractContainerConfigFromDeployment } from './extractContainerConfig';

const fullDeployment = {
  metadata: { name: 'my-app', namespace: 'production' },
  spec: {
    replicas: 3,
    template: {
      spec: {
        containers: [
          {
            name: 'my-app',
            image: 'myregistry.azurecr.io/my-app:1.0',
            ports: [{ containerPort: 8080 }],
            env: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'PORT', value: '8080' },
            ],
            resources: {
              requests: { cpu: '200m', memory: '256Mi' },
              limits: { cpu: '1', memory: '1Gi' },
            },
            livenessProbe: {
              httpGet: { path: '/healthz', port: 8080 },
              initialDelaySeconds: 15,
              periodSeconds: 20,
              timeoutSeconds: 3,
              failureThreshold: 5,
              successThreshold: 1,
            },
            readinessProbe: {
              httpGet: { path: '/ready', port: 8080 },
              initialDelaySeconds: 5,
              periodSeconds: 10,
              timeoutSeconds: 2,
              failureThreshold: 3,
              successThreshold: 1,
            },
            startupProbe: {
              httpGet: { path: '/startup', port: 8080 },
              initialDelaySeconds: 0,
              periodSeconds: 5,
              timeoutSeconds: 1,
              failureThreshold: 30,
              successThreshold: 1,
            },
            securityContext: {
              runAsNonRoot: true,
              readOnlyRootFilesystem: true,
              allowPrivilegeEscalation: false,
            },
          },
        ],
        affinity: {
          podAntiAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 100 }],
          },
        },
        topologySpreadConstraints: [{ maxSkew: 1 }],
      },
    },
  },
};

const fullService = {
  spec: {
    type: 'LoadBalancer',
    ports: [{ port: 80, targetPort: 8080 }],
  },
};

describe('extractContainerConfigFromDeployment', () => {
  it('should extract all fields from a full deployment + service', () => {
    const result = extractContainerConfigFromDeployment(fullDeployment, fullService);

    expect(result.appName).toBe('my-app');
    expect(result.containerImage).toBe('myregistry.azurecr.io/my-app:1.0');
    expect(result.replicas).toBe(3);
    expect(result.targetPort).toBe(8080);

    expect(result.envVars).toEqual([
      { key: 'NODE_ENV', value: 'production' },
      { key: 'PORT', value: '8080' },
    ]);

    expect(result.enableResources).toBe(true);
    expect(result.cpuRequest).toBe('200m');
    expect(result.cpuLimit).toBe('1');
    expect(result.memoryRequest).toBe('256Mi');
    expect(result.memoryLimit).toBe('1Gi');

    expect(result.enableLivenessProbe).toBe(true);
    expect(result.livenessPath).toBe('/healthz');
    expect(result.livenessInitialDelay).toBe(15);
    expect(result.livenessPeriod).toBe(20);
    expect(result.livenessTimeout).toBe(3);
    expect(result.livenessFailure).toBe(5);

    expect(result.enableReadinessProbe).toBe(true);
    expect(result.readinessPath).toBe('/ready');

    expect(result.enableStartupProbe).toBe(true);
    expect(result.startupPath).toBe('/startup');

    expect(result.runAsNonRoot).toBe(true);
    expect(result.readOnlyRootFilesystem).toBe(true);
    expect(result.allowPrivilegeEscalation).toBe(false);

    expect(result.enablePodAntiAffinity).toBe(true);
    expect(result.enableTopologySpreadConstraints).toBe(true);

    expect(result.serviceType).toBe('LoadBalancer');
    expect(result.servicePort).toBe(80);
    expect(result.useCustomServicePort).toBe(true);
  });

  it('should return minimal config for deployment with no containers', () => {
    const deployment = {
      metadata: { name: 'empty-app' },
      spec: { template: { spec: {} } },
    };
    const result = extractContainerConfigFromDeployment(deployment);
    expect(result.appName).toBe('empty-app');
    expect(result.containerImage).toBeUndefined();
  });

  it('should handle deployment with no probes', () => {
    const deployment = {
      metadata: { name: 'no-probes' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [
              {
                name: 'app',
                image: 'nginx:latest',
                ports: [{ containerPort: 80 }],
              },
            ],
          },
        },
      },
    };
    const result = extractContainerConfigFromDeployment(deployment);
    // No probes configured = enable flags should be false (nothing to extract)
    expect(result.enableLivenessProbe).toBe(false);
    expect(result.enableReadinessProbe).toBe(false);
    expect(result.enableStartupProbe).toBe(false);
  });

  it('should handle non-HTTP probes by disabling them', () => {
    const deployment = {
      metadata: { name: 'tcp-probe' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [
              {
                name: 'app',
                image: 'nginx:latest',
                ports: [{ containerPort: 80 }],
                livenessProbe: {
                  tcpSocket: { port: 80 },
                  initialDelaySeconds: 10,
                },
              },
            ],
          },
        },
      },
    };
    const result = extractContainerConfigFromDeployment(deployment);
    // TCP probe present but no httpGet -> probe exists but can't be represented
    expect(result.enableLivenessProbe).toBe(false);
  });

  it('should handle deployment with no resources', () => {
    const deployment = {
      metadata: { name: 'no-resources' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [
              {
                name: 'app',
                image: 'nginx:latest',
                ports: [{ containerPort: 80 }],
              },
            ],
          },
        },
      },
    };
    const result = extractContainerConfigFromDeployment(deployment);
    expect(result.enableResources).toBe(false);
  });

  it('should handle service with same port as target (no custom port)', () => {
    const deployment = {
      metadata: { name: 'app' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [{ name: 'app', image: 'nginx', ports: [{ containerPort: 80 }] }],
          },
        },
      },
    };
    const service = {
      spec: {
        type: 'ClusterIP',
        ports: [{ port: 80, targetPort: 80 }],
      },
    };
    const result = extractContainerConfigFromDeployment(deployment, service);
    expect(result.serviceType).toBe('ClusterIP');
    expect(result.servicePort).toBe(80);
    expect(result.useCustomServicePort).toBe(false);
  });

  it('should handle null/undefined deployment gracefully', () => {
    const result = extractContainerConfigFromDeployment(null);
    expect(result.appName).toBe('');
  });

  it('extracts config from the first container only', () => {
    const deployment = {
      metadata: { name: 'multi-container' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [
              { image: 'first:v1', ports: [{ containerPort: 8080 }] },
              { image: 'second:v1', ports: [{ containerPort: 9090 }] },
            ],
          },
        },
      },
    };
    const result = extractContainerConfigFromDeployment(deployment);
    expect(result.containerImage).toBe('first:v1');
    expect(result.targetPort).toBe(8080);
  });
});
