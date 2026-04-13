import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { createContainerConfig } from '../__fixtures__/pipelineConfig';
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
  it('should produce parseable workflow YAML with two jobs', () => {
    const output = generateDeployWorkflow(baseConfig);
    const parsed = YAML.parse(output);

    expect(parsed.name).toBe('Deploy to AKS');
    expect(Object.keys(parsed.jobs)).toContain('buildImage');
    expect(Object.keys(parsed.jobs)).toContain('deploy');
    expect(parsed.jobs.deploy.needs).toContain('buildImage');
  });

  it('should use pinned kubelogin version', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).toContain("kubelogin-version: 'v0.1.6'");
    expect(output).not.toContain('skip-cache');
  });

  it('should include actions: read permission', () => {
    const output = generateDeployWorkflow(baseConfig);
    const parsed = YAML.parse(output);
    expect(parsed.jobs.deploy.permissions.actions).toBe('read');
  });

  it('should use Azure/k8s-deploy@v5 for deployment', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).toContain('Azure/k8s-deploy@v5');
    expect(output).not.toContain('kubectl apply');
  });

  it('should include explicit Dockerfile path and build context', () => {
    const output = generateDeployWorkflow({
      ...baseConfig,
      dockerfilePath: './src/web/Dockerfile',
      buildContextPath: './src/web',
    });
    const parsed = YAML.parse(output);
    expect(parsed.env.DOCKER_FILE).toBe('./src/web/Dockerfile');
    expect(parsed.env.BUILD_CONTEXT_PATH).toBe('./src/web');
  });

  it('should set continue-on-error on annotation steps', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).toContain('continue-on-error: true');
  });

  it('should use use-kubelogin: true in aks-set-context', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).toContain("use-kubelogin: 'true'");
  });

  it('should parameterize all config values', () => {
    const output = generateDeployWorkflow(baseConfig);
    const parsed = YAML.parse(output);
    expect(parsed.env.AZURE_CONTAINER_REGISTRY).toBe('acrprod');
    expect(parsed.env.CONTAINER_NAME).toBe('contoso-air');
    expect(parsed.env.CLUSTER_NAME).toBe('aks-prod');
    expect(parsed.env.CLUSTER_RESOURCE_GROUP).toBe('rg-prod');
    expect(parsed.env.NAMESPACE).toBe('demo');
  });

  it('should trigger on push to default branch and workflow_dispatch', () => {
    const output = generateDeployWorkflow(baseConfig);
    const parsed = YAML.parse(output);
    expect(parsed.on.push.branches).toContain('main');
    expect(parsed.on.workflow_dispatch).toBeDefined();
  });

  it('should not include ACR_RESOURCE_GROUP env var', () => {
    const output = generateDeployWorkflow(baseConfig);
    const parsed = YAML.parse(output);
    expect(parsed.env.ACR_RESOURCE_GROUP).toBeUndefined();
  });

  it('should not pass -g flag to az acr build', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).not.toContain('-g ');
  });

  it('should escape config values with special characters', () => {
    const output = generateDeployWorkflow({
      ...baseConfig,
      appName: 'my:app#1',
      namespace: 'ns-with-special',
    });
    const parsed = YAML.parse(output);
    expect(parsed.env.CONTAINER_NAME).toBe('my-app-1');
    expect(parsed.env.NAMESPACE).toBe('ns-with-special');
  });

  it('should preserve GitHub Actions expressions (${{ }}) verbatim', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).toContain('${{ env.CLUSTER_NAME }}');
    expect(output).toContain('${{ github.sha }}');
    expect(output).toContain('${{ secrets.AZURE_CLIENT_ID }}');
  });

  it('should include concurrency block to cancel in-progress runs', () => {
    const output = generateDeployWorkflow(baseConfig);
    const parsed = YAML.parse(output);
    expect(parsed.concurrency.group).toContain('github.workflow');
    expect(parsed.concurrency['cancel-in-progress']).toBe(true);
  });

  it('should annotate specific deployment, not all deployments in namespace', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).toContain('deployment "${{ env.CONTAINER_NAME }}"');
    expect(output).not.toContain('deployment --all');
  });

  it('should normalize appName to DNS-1123 for CONTAINER_NAME', () => {
    const output = generateDeployWorkflow({ ...baseConfig, appName: 'My_App_v2' });
    const parsed = YAML.parse(output);
    expect(parsed.env.CONTAINER_NAME).toBe('my-app-v2');
  });

  it('should quote pipeline-repo annotation value in namespace annotate step', () => {
    const output = generateDeployWorkflow(baseConfig);
    expect(output).toContain('"aks-project/pipeline-repo=${{ github.repository }}"');
  });
});

const baseManifestConfig = {
  appName: 'contoso-air',
  namespace: 'demo',
  acrName: 'acrprod',
  repo: { owner: 'pauldotyu', name: 'contoso-air' },
};

const baseContainerConfig = createContainerConfig({
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
});

describe('generateDeploymentManifest', () => {
  it('should produce parseable YAML with correct structure', () => {
    const output = generateDeploymentManifest(baseManifestConfig, baseContainerConfig);
    const parsed = YAML.parse(output);

    expect(parsed.apiVersion).toBe('apps/v1');
    expect(parsed.kind).toBe('Deployment');
    expect(parsed.metadata.name).toBe('contoso-air');
    expect(parsed.metadata.namespace).toBe('demo');
    expect(parsed.spec.replicas).toBe(1);
    expect(parsed.spec.template.spec.containers).toHaveLength(1);
    expect(parsed.spec.template.spec.containers[0].ports).toEqual([{ containerPort: 3000 }]);
  });

  it('should include pipeline annotations', () => {
    const output = generateDeploymentManifest(baseManifestConfig, baseContainerConfig);
    const parsed = YAML.parse(output);
    expect(parsed.metadata.annotations['aks-project/deployed-by']).toBe('pipeline');
    expect(parsed.metadata.annotations['aks-project/pipeline-repo']).toBe('pauldotyu/contoso-air');
  });

  it('should include resource limits when enabled', () => {
    const output = generateDeploymentManifest(baseManifestConfig, baseContainerConfig);
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];
    expect(container.resources.requests.cpu).toBe('100m');
    expect(container.resources.requests.memory).toBe('128Mi');
    expect(container.resources.limits.cpu).toBe('500m');
    expect(container.resources.limits.memory).toBe('512Mi');
  });

  it('should include liveness probe when enabled', () => {
    const output = generateDeploymentManifest(baseManifestConfig, baseContainerConfig);
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];

    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.httpGet.path).toBe('/');
    expect(container.livenessProbe.httpGet.port).toBe(3000);
    expect(container.livenessProbe.initialDelaySeconds).toBe(15);
    expect(container.livenessProbe.periodSeconds).toBe(20);
    expect(container.readinessProbe).toBeUndefined();
    expect(container.startupProbe).toBeUndefined();
  });

  it('should omit resources when not enabled', () => {
    const output = generateDeploymentManifest(baseManifestConfig, {
      ...baseContainerConfig,
      enableResources: false,
    });
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];
    expect(container.resources).toBeUndefined();
  });

  it('should include security context when configured', () => {
    const output = generateDeploymentManifest(baseManifestConfig, {
      ...baseContainerConfig,
      allowPrivilegeEscalation: false,
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
    });
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];
    expect(container.securityContext.allowPrivilegeEscalation).toBe(false);
    expect(container.securityContext.runAsNonRoot).toBe(true);
    expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
  });

  it('should omit allowPrivilegeEscalation from security context when true', () => {
    // When the user sets allowPrivilegeEscalation: true, we do NOT write it to the manifest
    // (we never emit `allowPrivilegeEscalation: true`; the field is omitted and K8s defaults apply).
    const output = generateDeploymentManifest(baseManifestConfig, {
      ...baseContainerConfig,
      allowPrivilegeEscalation: true,
    });
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];
    expect(container.securityContext.allowPrivilegeEscalation).toBeUndefined();
  });

  it('should normalize appName to DNS-1123 for K8s resource names', () => {
    const output = generateDeploymentManifest(
      { ...baseManifestConfig, appName: 'My_App_v2' },
      baseContainerConfig
    );
    const parsed = YAML.parse(output);
    expect(parsed.metadata.name).toBe('my-app-v2');
    expect(parsed.spec.selector.matchLabels.app).toBe('my-app-v2');
    expect(parsed.spec.template.spec.containers[0].name).toBe('my-app-v2');
  });

  it('should include anti-affinity when enabled', () => {
    const output = generateDeploymentManifest(baseManifestConfig, {
      ...baseContainerConfig,
      enablePodAntiAffinity: true,
    });
    const parsed = YAML.parse(output);
    const affinity = parsed.spec.template.spec.affinity;
    expect(affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution).toHaveLength(
      1
    );
    expect(affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight).toBe(
      100
    );
  });

  it('should include topology spread constraints when enabled', () => {
    const output = generateDeploymentManifest(baseManifestConfig, {
      ...baseContainerConfig,
      enableTopologySpreadConstraints: true,
    });
    const parsed = YAML.parse(output);
    const constraints = parsed.spec.template.spec.topologySpreadConstraints;
    expect(constraints).toHaveLength(1);
    expect(constraints[0].maxSkew).toBe(1);
    expect(constraints[0].whenUnsatisfiable).toBe('ScheduleAnyway');
  });
});

describe('generateServiceManifest', () => {
  it('should produce parseable YAML with correct structure', () => {
    const output = generateServiceManifest(baseManifestConfig, baseContainerConfig);
    const parsed = YAML.parse(output);

    expect(parsed.apiVersion).toBe('v1');
    expect(parsed.kind).toBe('Service');
    expect(parsed.metadata.name).toBe('contoso-air');
    expect(parsed.metadata.namespace).toBe('demo');
    expect(parsed.spec.type).toBe('ClusterIP');
    expect(parsed.spec.ports).toHaveLength(1);
    expect(parsed.spec.ports[0].port).toBe(80);
    expect(parsed.spec.ports[0].targetPort).toBe(3000);
    expect(parsed.spec.ports[0].protocol).toBe('TCP');
    expect(parsed.spec.selector.app).toBe('contoso-air');
  });

  it('should support LoadBalancer service type', () => {
    const output = generateServiceManifest(baseManifestConfig, {
      ...baseContainerConfig,
      serviceType: 'LoadBalancer',
    });
    const parsed = YAML.parse(output);
    expect(parsed.spec.type).toBe('LoadBalancer');
  });

  it('should use targetPort when custom service port is disabled', () => {
    const output = generateServiceManifest(baseManifestConfig, {
      ...baseContainerConfig,
      useCustomServicePort: false,
    });
    const parsed = YAML.parse(output);
    expect(parsed.spec.ports[0].port).toBe(3000);
    expect(parsed.spec.ports[0].targetPort).toBe(3000);
  });
});
