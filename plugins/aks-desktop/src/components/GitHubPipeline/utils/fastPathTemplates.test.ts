import { describe, expect, it } from 'vitest';
import { generateDeployWorkflow } from './fastPathTemplates';

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
