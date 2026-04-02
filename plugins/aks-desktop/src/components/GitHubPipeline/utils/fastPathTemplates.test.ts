import { describe, expect, it } from 'vitest';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import {
  generateDeploymentManifest,
  generateDeployWorkflow,
  generateServiceManifest,
} from './fastPathTemplates';

const baseConfig = {
  appName: 'contoso-air',
  clusterName: 'aks-prod',
  resourceGroup: 'rg-prod',
  namespace: 'demo',
  acrName: 'acrprod',
  dockerfilePath: './Dockerfile',
  buildContextPath: '.',
  defaultBranch: 'main',
};

describe('generateDeployWorkflow', () => {
  it('should generate a valid workflow YAML with two jobs', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain('name: Deploy to AKS');
    expect(yaml).toContain('buildImage:');
    expect(yaml).toContain('deploy:');
    expect(yaml).toContain('needs: [buildImage]');
  });

  it('should use pinned kubelogin version', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain("kubelogin-version: 'v0.1.6'");
    expect(yaml).not.toContain('skip-cache');
  });

  it('should include actions: read permission', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain('actions: read');
  });

  it('should use Azure/k8s-deploy@v5 for deployment', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain('Azure/k8s-deploy@v5');
    expect(yaml).not.toContain('kubectl apply');
  });

  it('should include explicit Dockerfile path and build context', () => {
    const yaml = generateDeployWorkflow({
      ...baseConfig,
      dockerfilePath: './src/web/Dockerfile',
      buildContextPath: './src/web',
    });
    expect(yaml).toContain('DOCKER_FILE: ./src/web/Dockerfile');
    expect(yaml).toContain('BUILD_CONTEXT_PATH: ./src/web');
  });

  it('should set continue-on-error on annotation steps', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain('continue-on-error: true');
  });

  it('should use use-kubelogin: true in aks-set-context', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain("use-kubelogin: 'true'");
  });

  it('should parameterize all config values', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain('AZURE_CONTAINER_REGISTRY: acrprod');
    expect(yaml).toContain('CONTAINER_NAME: contoso-air');
    expect(yaml).toContain('CLUSTER_NAME: aks-prod');
    expect(yaml).toContain('CLUSTER_RESOURCE_GROUP: rg-prod');
    expect(yaml).toContain('NAMESPACE: demo');
  });

  it('should trigger on push to default branch and workflow_dispatch', () => {
    const yaml = generateDeployWorkflow(baseConfig);
    expect(yaml).toContain('branches: [main]');
    expect(yaml).toContain('workflow_dispatch');
  });
});

const baseManifestConfig = {
  appName: 'contoso-air',
  namespace: 'demo',
  acrName: 'acrprod',
  repoOwner: 'pauldotyu',
  repoName: 'contoso-air',
};

const baseContainerConfig: Partial<ContainerConfig> = {
  replicas: 1,
  targetPort: 3000,
  servicePort: 80,
  useCustomServicePort: true,
  serviceType: 'ClusterIP',
  enableResources: true,
  cpuRequest: '100m',
  cpuLimit: '500m',
  memoryRequest: '128Mi',
  memoryLimit: '512Mi',
  enableLivenessProbe: true,
  livenessPath: '/',
  livenessInitialDelay: 15,
  livenessPeriod: 20,
  livenessTimeout: 5,
  livenessFailure: 3,
  livenessSuccess: 1,
  enableReadinessProbe: false,
  enableStartupProbe: false,
  allowPrivilegeEscalation: false,
  runAsNonRoot: false,
  readOnlyRootFilesystem: false,
  enablePodAntiAffinity: false,
  enableTopologySpreadConstraints: false,
};

describe('generateDeploymentManifest', () => {
  it('should generate a valid deployment YAML', () => {
    const yaml = generateDeploymentManifest(
      baseManifestConfig,
      baseContainerConfig as ContainerConfig
    );
    expect(yaml).toContain('kind: Deployment');
    expect(yaml).toContain('name: contoso-air');
    expect(yaml).toContain('namespace: demo');
    expect(yaml).toContain('containerPort: 3000');
    expect(yaml).toContain('replicas: 1');
  });

  it('should include pipeline annotations', () => {
    const yaml = generateDeploymentManifest(
      baseManifestConfig,
      baseContainerConfig as ContainerConfig
    );
    expect(yaml).toContain('aks-project/deployed-by: pipeline');
    expect(yaml).toContain('aks-project/pipeline-repo: pauldotyu/contoso-air');
  });

  it('should include resource limits when enabled', () => {
    const yaml = generateDeploymentManifest(
      baseManifestConfig,
      baseContainerConfig as ContainerConfig
    );
    expect(yaml).toContain('cpu: 100m');
    expect(yaml).toContain('memory: 128Mi');
  });

  it('should include liveness probe when enabled', () => {
    const yaml = generateDeploymentManifest(
      baseManifestConfig,
      baseContainerConfig as ContainerConfig
    );
    expect(yaml).toContain('livenessProbe:');
    expect(yaml).toContain('path: /');
    expect(yaml).not.toContain('readinessProbe:');
    expect(yaml).not.toContain('startupProbe:');
  });

  it('should omit resources when not enabled', () => {
    const yaml = generateDeploymentManifest(baseManifestConfig, {
      ...baseContainerConfig,
      enableResources: false,
    } as ContainerConfig);
    expect(yaml).not.toContain('resources:');
  });
});

describe('generateServiceManifest', () => {
  it('should generate a valid service YAML', () => {
    const yaml = generateServiceManifest(
      baseManifestConfig,
      baseContainerConfig as ContainerConfig
    );
    expect(yaml).toContain('kind: Service');
    expect(yaml).toContain('type: ClusterIP');
    expect(yaml).toContain('port: 80');
    expect(yaml).toContain('targetPort: 3000');
  });
});
