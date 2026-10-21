import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { createContainerConfig } from '../__fixtures__/pipelineConfig';
import { generateAcrBuildSteps } from './acrBuildSteps';
import { ACR_BUILD_SCRIPT_PATH } from './acrTasks/acrTaskRunner';
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
    expect(output).toContain('Azure/k8s-deploy@c8cfec839dc09896b3b8cc40cd13d04792680771'); // v5.1.0
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

  it('should include concurrency block that queues rather than cancels in-progress runs', () => {
    const output = generateDeployWorkflow(baseConfig);
    const parsed = YAML.parse(output);
    expect(parsed.concurrency.group).toContain('github.workflow');
    expect(parsed.concurrency['cancel-in-progress']).toBe(false);
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

  it('should throw when appName contains no alphanumeric characters', () => {
    expect(() => generateDeployWorkflow({ ...baseConfig, appName: '???' })).toThrow(
      /no alphanumeric characters/
    );
  });

  it('should throw when appName is empty string', () => {
    expect(() => generateDeployWorkflow({ ...baseConfig, appName: '' })).toThrow(
      /no alphanumeric characters/
    );
  });

  it('should throw when appName contains only special characters', () => {
    expect(() => generateDeployWorkflow({ ...baseConfig, appName: '___###' })).toThrow(
      /no alphanumeric characters/
    );
  });

  describe('ACR Tasks REST build contract', () => {
    const registryResourceId =
      '/subscriptions/registry-sub/resourceGroups/registry-rg/providers/Microsoft.ContainerRegistry/registries/acrprod';
    const config = {
      ...baseConfig,
      acrResourceId: registryResourceId,
      dockerfilePath: './services/api/Dockerfile',
      buildContextPath: './services/api',
    };

    it('does not execute az acr build in the generated workflow', () => {
      const output = generateDeployWorkflow(config);

      expect(output.match(/\baz\s+acr\s+build\b/)).toBeNull();
    });

    it('passes the selected registry ARM ID without assuming the cluster resource group', () => {
      const workflow = YAML.parse(generateDeployWorkflow(config));
      const buildEnv = { ...workflow.env, ...workflow.jobs.buildImage.env };

      expect(buildEnv.AZURE_ACR_RESOURCE_ID).toBe(registryResourceId);
      expect(workflow.env.CLUSTER_RESOURCE_GROUP).toBe('rg-prod');
      expect(workflow.env.DOCKER_FILE).toBe('./services/api/Dockerfile');
      expect(workflow.env.BUILD_CONTEXT_PATH).toBe('./services/api');
    });

    it('preserves OIDC authentication and commit-SHA image deployment', () => {
      const workflow = YAML.parse(generateDeployWorkflow(config));

      expect(workflow.jobs.buildImage.permissions).toEqual({
        contents: 'read',
        'id-token': 'write',
      });
      expect(workflow.jobs.buildImage.steps).toContainEqual(
        expect.objectContaining({
          uses: expect.stringMatching(/^azure\/login@/),
          with: {
            'client-id': '${{ secrets.AZURE_CLIENT_ID }}',
            'tenant-id': '${{ secrets.AZURE_TENANT_ID }}',
            'subscription-id': '${{ secrets.AZURE_SUBSCRIPTION_ID }}',
          },
        })
      );
      expect(workflow.jobs.deploy.steps).toContainEqual(
        expect.objectContaining({
          uses: expect.stringMatching(/^Azure\/k8s-deploy@/),
          with: expect.objectContaining({
            images:
              '${{ env.AZURE_CONTAINER_REGISTRY }}.azurecr.io/${{ env.CONTAINER_NAME }}:${{ github.sha }}\n',
          }),
        })
      );
    });

    it('keeps deployment gated on a successful build', () => {
      const workflow = YAML.parse(generateDeployWorkflow(config));

      expect(workflow.jobs.deploy.needs).toEqual(['buildImage']);
      expect(workflow.jobs.deploy.if).toBeUndefined();
      expect(workflow.jobs.buildImage['continue-on-error']).not.toBe(true);
      expect(workflow.jobs.buildImage.steps).not.toContainEqual(
        expect.objectContaining({ 'continue-on-error': true })
      );
    });

    it('uses shared Python build and always-run cancellation steps without swallowing errors', () => {
      const buildArguments = { MODE: 'production', MESSAGE: 'space "quotes" $value' };
      const workflow = YAML.parse(generateDeployWorkflow({ ...config, buildArguments }));
      const [build, cleanup] = workflow.jobs.buildImage.steps.slice(-2);

      expect([build, cleanup]).toEqual(
        generateAcrBuildSteps({
          acrName: config.acrName,
          acrResourceId: registryResourceId,
          containerName: config.appName,
          dockerfilePath: config.dockerfilePath,
          buildContextPath: config.buildContextPath,
          buildArguments,
        })
      );
      expect(build.id).toBe('acr_build');
      expect(build.run).toBe(`exec python3 ${ACR_BUILD_SCRIPT_PATH}\n`);
      expect(JSON.parse(build.env.BUILD_ARGUMENTS)).toEqual(buildArguments);
      expect(cleanup.if).toBe("always() && steps.acr_build.outcome != 'success'");
      expect(cleanup.run).toBe(`exec python3 ${ACR_BUILD_SCRIPT_PATH} --cancel\n`);
      expect(cleanup['continue-on-error']).toBeUndefined();
    });

    it('allows legacy registry-name metadata and empty build arguments', () => {
      const workflow = YAML.parse(generateDeployWorkflow(baseConfig));
      const build = workflow.jobs.buildImage.steps.find(
        (step: { id?: string }) => step.id === 'acr_build'
      );

      expect(build.env.AZURE_ACR_RESOURCE_ID).toBe('');
      expect(build.env.AZURE_CONTAINER_REGISTRY).toBe('acrprod');
      expect(build.env.AZURE_SUBSCRIPTION_ID).toBe('${{ secrets.AZURE_SUBSCRIPTION_ID }}');
      expect(build.env.BUILD_ARGUMENTS).toBe('{}');
    });

    it('pins actual action refs without embedding version comments in ref strings', () => {
      const workflow = YAML.parse(generateDeployWorkflow(config));
      for (const job of Object.values(workflow.jobs) as { steps: { uses?: string }[] }[]) {
        for (const step of job.steps.filter(step => step.uses)) {
          expect(step.uses).toMatch(/^[\w/-]+@[a-f0-9]{40}$/);
        }
      }
    });

    it('snapshots the actual generated build workflow', () => {
      expect(generateDeployWorkflow(config)).toMatchSnapshot();
    });
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

  it('should omit successThreshold for liveness probe (K8s requires it to be 1, the default)', () => {
    const output = generateDeploymentManifest(
      baseManifestConfig,
      createContainerConfig({
        ...baseContainerConfig,
        enableLivenessProbe: true,
        livenessSuccess: 5, // user set > 1, but K8s forbids this for liveness
      })
    );
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];
    // successThreshold is omitted (K8s defaults to 1); emitting > 1 would be rejected by the API
    expect(container.livenessProbe.successThreshold).toBeUndefined();
  });

  it('should omit successThreshold for startup probe (K8s requires it to be 1, the default)', () => {
    const output = generateDeploymentManifest(
      baseManifestConfig,
      createContainerConfig({
        ...baseContainerConfig,
        enableStartupProbe: true,
        startupSuccess: 3,
      })
    );
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];
    expect(container.startupProbe.successThreshold).toBeUndefined();
  });

  it('should emit successThreshold for readiness probe when > 1', () => {
    const output = generateDeploymentManifest(
      baseManifestConfig,
      createContainerConfig({
        ...baseContainerConfig,
        enableReadinessProbe: true,
        readinessSuccess: 2,
      })
    );
    const parsed = YAML.parse(output);
    const container = parsed.spec.template.spec.containers[0];
    expect(container.readinessProbe.successThreshold).toBe(2);
  });

  it('should throw when appName contains no alphanumeric characters', () => {
    expect(() =>
      generateDeploymentManifest({ ...baseManifestConfig, appName: '???' }, baseContainerConfig)
    ).toThrow(/no alphanumeric characters/);
  });

  it('should throw when appName is empty string', () => {
    expect(() =>
      generateDeploymentManifest({ ...baseManifestConfig, appName: '' }, baseContainerConfig)
    ).toThrow(/no alphanumeric characters/);
  });

  it('should throw when appName contains only special characters', () => {
    expect(() =>
      generateDeploymentManifest({ ...baseManifestConfig, appName: '___###' }, baseContainerConfig)
    ).toThrow(/no alphanumeric characters/);
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

  it('should throw when appName contains no alphanumeric characters', () => {
    expect(() =>
      generateServiceManifest({ ...baseManifestConfig, appName: '???' }, baseContainerConfig)
    ).toThrow(/no alphanumeric characters/);
  });

  it('should throw when appName is empty string', () => {
    expect(() =>
      generateServiceManifest({ ...baseManifestConfig, appName: '' }, baseContainerConfig)
    ).toThrow(/no alphanumeric characters/);
  });

  it('should throw when appName contains only special characters', () => {
    expect(() =>
      generateServiceManifest({ ...baseManifestConfig, appName: '___###' }, baseContainerConfig)
    ).toThrow(/no alphanumeric characters/);
  });
});
