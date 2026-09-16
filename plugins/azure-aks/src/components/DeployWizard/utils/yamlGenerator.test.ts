// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { ContainerDeploymentConfig, generateYamlForContainer } from './yamlGenerator';

function makeConfig(overrides?: Partial<ContainerDeploymentConfig>): ContainerDeploymentConfig {
  return {
    appName: 'test-app',
    containerImage: 'nginx:latest',
    replicas: 1,
    targetPort: 80,
    servicePort: 80,
    serviceType: 'ClusterIP',
    enableResources: false,
    cpuRequest: '100m',
    cpuLimit: '500m',
    memoryRequest: '128Mi',
    memoryLimit: '512Mi',
    envVars: [],
    enableLivenessProbe: false,
    enableReadinessProbe: false,
    enableStartupProbe: false,
    livenessPath: '/',
    livenessInitialDelay: 10,
    livenessPeriod: 10,
    livenessTimeout: 1,
    livenessFailure: 3,
    livenessSuccess: 1,
    readinessPath: '/',
    readinessInitialDelay: 5,
    readinessPeriod: 10,
    readinessTimeout: 1,
    readinessFailure: 3,
    readinessSuccess: 1,
    startupPath: '/',
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
    enablePodAntiAffinity: false,
    enableTopologySpreadConstraints: false,
    namespace: 'test-ns',
    ...overrides,
  };
}

describe('generateYamlForContainer', () => {
  it('generates a basic Deployment and Service with correct name, namespace, image, and ports', () => {
    const yaml = generateYamlForContainer(makeConfig());

    expect(yaml).toContain('kind: Deployment');
    expect(yaml).toContain('kind: Service');
    expect(yaml).toContain('name: test-app');
    expect(yaml).toContain('namespace: test-ns');
    expect(yaml).toContain('image: nginx:latest');
    expect(yaml).toContain('containerPort: 80');
    expect(yaml).toContain('port: 80');
    expect(yaml).toContain('targetPort: 80');
    expect(yaml).toContain('type: ClusterIP');
  });

  it('generates secretKeyRef and a Secret manifest for secret env vars with values', () => {
    const yaml = generateYamlForContainer(
      makeConfig({
        envVars: [{ key: 'DB_PASS', value: 'secret123', isSecret: true }],
      })
    );

    expect(yaml).toContain('secretKeyRef');
    expect(yaml).toContain('name: test-app-env-secrets');
    expect(yaml).toContain('key: "DB_PASS"');
    expect(yaml).toContain('kind: Secret');
    expect(yaml).toContain('stringData');
    expect(yaml).toContain('"DB_PASS": "secret123"');
  });

  it('generates secretKeyRef and Secret manifest with empty value when secret env var has blank value (edit flow)', () => {
    const yaml = generateYamlForContainer(
      makeConfig({
        envVars: [{ key: 'DB_PASS', value: '', isSecret: true }],
      })
    );

    expect(yaml).toContain('secretKeyRef');
    expect(yaml).toContain('name: test-app-env-secrets');
    expect(yaml).toContain('kind: Secret');
    expect(yaml).toContain('stringData');
    // Empty value is preserved so the Secret key exists (avoids broken secretKeyRef)
    expect(yaml).toContain('"DB_PASS": ""');
  });

  it('generates both plain value and secretKeyRef entries for mixed env vars', () => {
    const yaml = generateYamlForContainer(
      makeConfig({
        envVars: [
          { key: 'APP_ENV', value: 'production', isSecret: false },
          { key: 'DB_PASS', value: 'secret123', isSecret: true },
        ],
      })
    );

    expect(yaml).toContain('name: APP_ENV');
    expect(yaml).toContain('value: "production"');
    expect(yaml).toContain('name: DB_PASS');
    expect(yaml).toContain('secretKeyRef');
  });

  it('generates workload identity config with ServiceAccount manifest when clientId is provided', () => {
    const yaml = generateYamlForContainer(
      makeConfig({
        enableWorkloadIdentity: true,
        workloadIdentityClientId: 'test-client-id',
        workloadIdentityServiceAccount: 'my-sa',
      })
    );

    expect(yaml).toContain('azure.workload.identity/use: "true"');
    expect(yaml).toContain('serviceAccountName: my-sa');
    expect(yaml).toContain('kind: ServiceAccount');
    expect(yaml).toContain('name: my-sa');
    expect(yaml).toContain('azure.workload.identity/client-id: "test-client-id"');
  });

  it('generates workload identity pod config but no ServiceAccount manifest when clientId is empty (edit flow)', () => {
    const yaml = generateYamlForContainer(
      makeConfig({
        enableWorkloadIdentity: true,
        workloadIdentityClientId: '',
        workloadIdentityServiceAccount: 'my-sa',
      })
    );

    expect(yaml).toContain('azure.workload.identity/use: "true"');
    expect(yaml).toContain('serviceAccountName: my-sa');
    expect(yaml).not.toContain('kind: ServiceAccount');
  });

  it('generates an HPA manifest when enableHpa is true', () => {
    const yaml = generateYamlForContainer(
      makeConfig({
        enableHpa: true,
        hpaMinReplicas: 2,
        hpaMaxReplicas: 10,
        hpaTargetCpu: 80,
      })
    );

    expect(yaml).toContain('kind: HorizontalPodAutoscaler');
    expect(yaml).toContain('minReplicas: 2');
    expect(yaml).toContain('maxReplicas: 10');
    expect(yaml).toContain('averageUtilization: 80');
    expect(yaml).toContain('name: test-app');
    expect(yaml).toContain('namespace: test-ns');
  });

  it('outputs documents in correct order: Secret, ServiceAccount, Deployment, Service, HPA', () => {
    const yaml = generateYamlForContainer(
      makeConfig({
        envVars: [{ key: 'DB_PASS', value: 'secret123', isSecret: true }],
        enableWorkloadIdentity: true,
        workloadIdentityClientId: 'test-client-id',
        workloadIdentityServiceAccount: 'my-sa',
        enableHpa: true,
      })
    );

    const secretIndex = yaml.indexOf('# Secret\n');
    const saIndex = yaml.indexOf('# ServiceAccount\n');
    const deploymentIndex = yaml.indexOf('# Deployment\n');
    const serviceIndex = yaml.indexOf('# Service\n');
    const hpaIndex = yaml.indexOf('# HPA\n');

    expect(secretIndex).toBeGreaterThanOrEqual(0);
    expect(saIndex).toBeGreaterThanOrEqual(0);
    expect(deploymentIndex).toBeGreaterThanOrEqual(0);
    expect(serviceIndex).toBeGreaterThanOrEqual(0);
    expect(hpaIndex).toBeGreaterThanOrEqual(0);

    expect(secretIndex).toBeLessThan(saIndex);
    expect(saIndex).toBeLessThan(deploymentIndex);
    expect(deploymentIndex).toBeLessThan(serviceIndex);
    expect(serviceIndex).toBeLessThan(hpaIndex);
  });

  it('normalizes secretName to DNS-1123 when appName is long', () => {
    const longName = 'a'.repeat(60);
    const yaml = generateYamlForContainer(
      makeConfig({
        appName: longName,
        envVars: [{ key: 'SECRET_KEY', value: 'val', isSecret: true }],
      })
    );

    // `aaa...aaa-env-secrets` (72 chars) should be truncated to 63 chars
    expect(yaml).toContain('kind: Secret');
    // The Secret metadata name should be at most 63 chars (truncated)
    const secretSection = yaml.slice(yaml.indexOf('kind: Secret'));
    const nameMatch = secretSection.match(/^\s+name:\s+(.+)$/m);
    expect(nameMatch).not.toBeNull();
    const secretName = nameMatch![1];
    expect(secretName.length).toBeLessThanOrEqual(63);
    expect(secretName).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  });
});
