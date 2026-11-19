// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';
import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import preRestAgent from '../__fixtures__/pre-rest-agent.txt?raw';

const { mockCreateOrUpdateFile } = vi.hoisted(() => ({
  mockCreateOrUpdateFile: vi.fn(),
}));
vi.mock('../../../utils/github/github-api', () => ({
  createOrUpdateFile: mockCreateOrUpdateFile,
}));
import { createContainerConfig, createValidConfig } from '../__fixtures__/pipelineConfig';
import { KUBELOGIN_VERSION } from '../constants';
import type { PipelineConfig } from '../types';
import { generateAcrBuildSteps } from './acrBuildSteps';
import { ACR_BUILD_SCRIPT_PATH, getAcrBuildFiles } from './acrTasks/acrTaskRunner';
import {
  generateAgentConfig,
  generateBranchName,
  isAgentConfigCurrent,
  isSetupWorkflowCurrent,
  pushAgentConfigFiles,
  sanitizeAppNameForBranch,
  SETUP_WORKFLOW_CONTENT,
  upgradeAgentConfig,
  upgradeSetupWorkflow,
  validatePipelineConfig,
} from './agentTemplates';

const validConfig = createValidConfig();

describe('agentTemplates', () => {
  describe('SETUP_WORKFLOW_CONTENT', () => {
    it('should contain valid YAML with copilot-setup-steps job', () => {
      expect(SETUP_WORKFLOW_CONTENT).toContain('name: Copilot Setup Steps');
      expect(SETUP_WORKFLOW_CONTENT).toContain('copilot-setup-steps:');
      expect(SETUP_WORKFLOW_CONTENT).toContain('actions/checkout@v4');
      expect(SETUP_WORKFLOW_CONTENT).toContain('containerization-assist-mcp');
    });
  });

  describe('generateAgentConfig', () => {
    it('should include AKS deployment configuration', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('Cluster: my-cluster');
      expect(result).toContain('Resource Group: my-rg');
      expect(result).toContain('Namespace: production');
      expect(result).toContain('Service Type: LoadBalancer');
      // Sensitive values should NOT be hardcoded — referenced as GitHub secrets
      expect(result).not.toContain('tenant-123');
      expect(result).not.toContain('identity-456');
      expect(result).not.toContain('sub-789');
      expect(result).toContain('AZURE_CLIENT_ID');
      expect(result).toContain('AZURE_TENANT_ID');
      expect(result).toContain('AZURE_SUBSCRIPTION_ID');
    });

    it('should include MCP tool references', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('containerization-assist-mcp/analyze-repo');
      expect(result).toContain('containerization-assist-mcp/generate-dockerfile');
      expect(result).toContain('containerization-assist-mcp/generate-k8s-manifests');
    });

    it('should include naming conventions with app name', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('my-app');
      expect(result).toContain('[AKS Desktop] Add deployment pipeline for my-app');
    });

    it('should include deployment annotation instructions', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('aks-project/deployed-by: pipeline');
      expect(result).toContain('aks-project/pipeline-repo: testuser/my-repo');
      expect(result).toContain('Deployment Annotations (mandatory)');
    });

    it('should include pipeline-run-url and pipeline-workflow annotation instructions in workflow requirements', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('aks-project/pipeline-run-url=');
      expect(result).toContain('aks-project/pipeline-workflow=${{ github.workflow }}');
      expect(result).toContain('kubectl annotate deployment --all');
    });

    it('should include GitHub Actions workflow requirements with workflow_dispatch inputs', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('azure/login@v2');
      expect(result).toContain('azure/aks-set-context@v4');
      expect(result).toContain('azure/use-kubelogin@v1');
      expect(result).toContain('kubelogin convert-kubeconfig -l workloadidentity');
      expect(result).toContain('workflow_dispatch');
      expect(result).toContain('cluster-name');
      expect(result).toContain('resource-group');
      expect(result).toContain('namespace');
      expect(result).toContain('${{ inputs.cluster-name }}');
      expect(result).toContain('${{ inputs.resource-group }}');
      expect(result).toContain('${{ inputs.namespace }}');
      // Subscription ID comes from secrets, not workflow inputs
      expect(result).toContain('secrets.AZURE_SUBSCRIPTION_ID');
      expect(result).not.toContain('Trigger on push to main');
    });

    it('should instruct agent to pin kubelogin version instead of skip-cache', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain(`kubelogin-version: '${KUBELOGIN_VERSION}'`);
      expect(result).not.toContain('skip-cache: true');
    });

    it('should instruct agent to include actions: read permission', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('actions: read');
    });

    it('should instruct agent to split workflow into two jobs', () => {
      const result = generateAgentConfig({
        ...validConfig,
        acrLoginServer: 'myregistry.azurecr.io',
      });
      expect(result).toContain('buildImage');
      expect(result).toContain('needs: [buildImage]');
    });

    describe('ACR Tasks REST instructions', () => {
      const registryResourceId =
        '/subscriptions/registry-sub/resourceGroups/registry-rg/providers/Microsoft.ContainerRegistry/registries/myregistry';
      const acrConfig = createValidConfig({
        acrLoginServer: 'myregistry.azurecr.io',
        acrResourceId: registryResourceId,
      });
      const operations = ['listBuildSourceUploadUrl', 'scheduleRun', 'listLogSasUrl'];

      it('does not tell the agent to recreate an az acr build workflow', () => {
        const result = generateAgentConfig(acrConfig);

        expect(result.match(/\baz\s+acr\s+build\b/)).toBeNull();
      });

      it.each([
        { description: 'with a login server', acrLoginServer: 'myregistry.azurecr.io' },
        {
          description: 'with a Domain Name Label host',
          acrLoginServer: 'myregistry-abc123.azurecr.io',
        },
      ])('describes the complete ACR build API sequence $description', ({ acrLoginServer }) => {
        const result = generateAgentConfig({ ...acrConfig, acrLoginServer });

        expect(operations.filter(operation => result.includes(operation))).toEqual(operations);
        expect(result).toMatch(/\/runs\//);
        expect(result).toMatch(/\/cancel\b/);
      });

      it('rejects ID-only deployment instructions without guessing the registry host', () => {
        expect(() => generateAgentConfig({ ...acrConfig, acrLoginServer: undefined })).toThrow(
          'actual ACR login server'
        );
        expect(validatePipelineConfig({ ...acrConfig, acrLoginServer: undefined })).toMatchObject({
          isValid: false,
          errors: expect.arrayContaining([expect.stringContaining('actual ACR login server')]),
        });
      });

      it('pins a Tasks-supported API version rather than the registry-management version', () => {
        const result = generateAgentConfig(acrConfig);

        expect(result).toContain('2019-04-01');
      });

      it('references the registry ARM ID secret instead of exposing registry scope in the prompt', () => {
        const result = generateAgentConfig(acrConfig);

        expect(result).toContain('${{ secrets.AZURE_ACR_RESOURCE_ID }}');
        expect(result).not.toContain(registryResourceId);
        expect(result).not.toContain('registry-sub');
        expect(result).toContain('${{ secrets.AZURE_SUBSCRIPTION_ID }}');
        expect(result).toContain('myregistry.azurecr.io/my-app:${{ github.sha }}');
      });

      it('does not add ACR-specific build instructions when no registry is configured', () => {
        const result = generateAgentConfig(validConfig);

        expect(operations.filter(operation => result.includes(operation))).toEqual([]);
        expect(result).not.toContain('AZURE_ACR_RESOURCE_ID');
      });

      it('embeds the shared step YAML, including JSON arguments and cancellation semantics', () => {
        const buildArguments = { MODE: 'production', MESSAGE: 'space "quotes" $value' };
        const result = generateAgentConfig({
          ...acrConfig,
          appName: 'My_App',
          buildArguments,
        });
        const expectedSteps = YAML.stringify(
          {
            steps: generateAcrBuildSteps({
              acrName: '${{ secrets.AZURE_ACR_NAME }}',
              acrResourceId: '${{ secrets.AZURE_ACR_RESOURCE_ID }}',
              containerName: 'my-app',
              dockerfilePath: './Dockerfile',
              buildContextPath: '.',
              buildArguments,
            }),
          },
          { lineWidth: 0 }
        )
          .trimEnd()
          .split('\n')
          .map(line => `  ${line}`)
          .join('\n');

        expect(result).toContain(expectedSteps);
        expect(result).toContain(ACR_BUILD_SCRIPT_PATH);
        expect(result).toContain('SIGINT/SIGTERM');
        expect(result).toContain('Missing state is a no-op');
        expect(result).not.toContain('def main(');
        expect(result).toContain('myregistry.azurecr.io/my-app:${{ github.sha }}');
      });

      it('keeps legacy login-server-only configurations supported', () => {
        const result = generateAgentConfig({ ...acrConfig, acrResourceId: undefined });

        expect(result).toContain('ARM discovery');
        expect(result).not.toContain('${{ secrets.AZURE_ACR_RESOURCE_ID }}');
        expect(validatePipelineConfig({ ...acrConfig, acrResourceId: undefined }).isValid).toBe(
          true
        );
      });
    });

    it('caps build retries to bound trajectory size', () => {
      const result = generateAgentConfig(validConfig);
      // The unbounded "Repeat until successful" instruction must be gone.
      expect(result).not.toMatch(/Repeat until successful/i);
      // Replaced with an explicit cap so failed builds do not balloon trajectory tokens.
      expect(result).toMatch(/retry up to \*\*2 more times\*\*/i);
      expect(result).toMatch(/3 total attempts/i);
    });

    it('instructs agent to summarize large tool outputs instead of echoing them', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toMatch(/Do not echo large tool outputs/i);
    });

    it('updates the checklist per step, not per tool call', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toMatch(/once per numbered step/i);
      // The old per-tool-call instruction must be gone.
      expect(result).not.toMatch(/After \*\*each\*\* tool call/i);
    });

    it('should include optional fields when provided', () => {
      const config: PipelineConfig = {
        ...validConfig,
        ingressEnabled: true,
        ingressHost: 'myapp.example.com',
        imageReference: 'myregistry.azurecr.io/myapp:latest',
        port: 8080,
      };
      const result = generateAgentConfig(config);
      expect(result).toContain('Ingress: enabled');
      expect(result).toContain('Ingress Host: myapp.example.com');
      expect(result).toContain('Image Reference: myregistry.azurecr.io/myapp:latest');
      expect(result).toContain('Port: 8080');
    });

    it('should omit optional fields when not provided', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).not.toContain('Ingress:');
      expect(result).not.toContain('Ingress Host:');
      expect(result).not.toContain('Image Reference:');
      expect(result).not.toContain('Port:');
    });

    it('should include container configuration when provided', () => {
      const cc = createContainerConfig({
        useCustomServicePort: true,
        enableStartupProbe: false,
        envVars: [
          { key: 'NODE_ENV', value: 'production', isSecret: false },
          { key: '', value: '', isSecret: false },
        ],
      });
      const config: PipelineConfig = { ...validConfig, containerConfig: cc };
      const result = generateAgentConfig(config);

      expect(result).toContain('Container Image: nginx:1.25');
      expect(result).toContain('Target Port: 8080');
      expect(result).toContain('Service Port: 80');
      expect(result).toContain('Replicas: 3');
      expect(result).toContain('CPU Request: 200m');
      expect(result).toContain('Memory Limit: 1Gi');
      expect(result).toContain('Environment Variables (values stored as GitHub secrets)');
      expect(result).toContain('NODE_ENV');
      expect(result).toContain('secrets.APP_ENV_NODE_ENV');
      expect(result).toContain('Liveness Probe: enabled (path: /health)');
      expect(result).toContain('Readiness Probe: enabled (path: /ready)');
      expect(result).toContain('Startup Probe: disabled');
      expect(result).toContain('HPA: enabled (min: 2, max: 10, target CPU: 80%)');
      expect(result).toContain('Run As Non-Root: true');
      expect(result).toContain('Allow Privilege Escalation: false');
      expect(result).toContain('Pod Anti-Affinity: enabled');
    });
  });

  describe('generateBranchName', () => {
    beforeEach(() => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should include sanitized app name and timestamp', () => {
      const result = generateBranchName('my-app');
      expect(result).toBe('aks-project/setup-my-app-1700000000000');
    });

    it('should start with aks-project/setup-', () => {
      const result = generateBranchName('test');
      expect(result).toMatch(/^aks-project\/setup-test-\d+$/);
    });

    it('should sanitize spaces and special characters', () => {
      const result = generateBranchName('My App!@#$');
      expect(result).toBe('aks-project/setup-my-app-1700000000000');
    });

    it('should collapse consecutive hyphens', () => {
      const result = generateBranchName('my---app');
      expect(result).toBe('aks-project/setup-my-app-1700000000000');
    });

    it('should fallback to "app" for empty or all-special-char names', () => {
      const result = generateBranchName('!!!');
      expect(result).toBe('aks-project/setup-app-1700000000000');
    });
  });

  describe('sanitizeAppNameForBranch', () => {
    it('passes through clean names', () => {
      expect(sanitizeAppNameForBranch('my-app')).toBe('my-app');
    });

    it('lowercases and replaces special chars with dashes', () => {
      expect(sanitizeAppNameForBranch('My App!@#$')).toBe('my-app');
    });

    it('rejects path-traversal attempts by collapsing them to safe slugs', () => {
      expect(sanitizeAppNameForBranch('../evil')).toBe('evil');
      expect(sanitizeAppNameForBranch('foo/../bar')).toBe('foo-bar');
    });

    it('collapses consecutive dashes', () => {
      expect(sanitizeAppNameForBranch('my---app')).toBe('my-app');
    });

    it('falls back to "app" for empty input', () => {
      expect(sanitizeAppNameForBranch('!!!')).toBe('app');
      expect(sanitizeAppNameForBranch('')).toBe('app');
    });
  });

  describe('pushAgentConfigFiles', () => {
    const mockOctokit = new Octokit();
    const mockGetContent = vi.fn();
    beforeEach(() => {
      vi.spyOn(mockOctokit.repos, 'getContent').mockImplementation(mockGetContent);
      mockCreateOrUpdateFile.mockClear();
      mockCreateOrUpdateFile.mockResolvedValue(undefined);
      mockGetContent.mockReset();
      mockGetContent.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    });
    it('should push both agent config files to the branch', async () => {
      await pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'my-branch', validConfig);
      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2);
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'owner',
        'repo',
        '.github/workflows/copilot-setup-steps.yml',
        SETUP_WORKFLOW_CONTENT,
        'Add Copilot setup workflow',
        'my-branch',
        undefined
      );
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'owner',
        'repo',
        '.github/agents/containerization.agent.md',
        expect.stringContaining('containerize-and-deploy'),
        expect.stringContaining(validConfig.appName),
        'my-branch',
        undefined
      );
    });
    it.each([
      { acrLoginServer: 'myregistry.azurecr.io' },
      {
        acrLoginServer: 'myregistry-abc123.azurecr.io',
        acrResourceId:
          '/subscriptions/registry-sub/resourceGroups/registry-rg/providers/Microsoft.ContainerRegistry/registries/myregistry',
      },
    ])('publishes the exact runtime bundle for registry config %o', async registry => {
      await pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'my-branch', {
        ...validConfig,
        ...registry,
      });

      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(
        2 + Object.keys(getAcrBuildFiles()).length
      );
      for (const [path, content] of Object.entries(getAcrBuildFiles())) {
        expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
          mockOctokit,
          'owner',
          'repo',
          path,
          content,
          expect.any(String),
          'my-branch',
          undefined
        );
      }
    });

    it('can switch from a merged plain fast path to agent setup with an inherited runtime bundle', async () => {
      const runtime = getAcrBuildFiles();
      mockGetContent.mockImplementation(async ({ path }) => {
        if (!(path in runtime)) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { data: { type: 'file', sha: `existing:${path}` } };
      });
      mockCreateOrUpdateFile.mockImplementation(async (...args: unknown[]) => {
        if (Object.keys(runtime).includes(String(args[3])) && args[7] !== `existing:${args[3]}`) {
          throw new Error('Existing runtime requires its current file SHA');
        }
      });

      await expect(
        pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'agent-branch', {
          ...validConfig,
          acrLoginServer: 'myregistry.azurecr.io',
        })
      ).resolves.toBeUndefined();

      for (const [path, content] of Object.entries(runtime)) {
        expect(mockGetContent).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          path,
          ref: 'agent-branch',
        });
        expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
          mockOctokit,
          'owner',
          'repo',
          path,
          content,
          expect.any(String),
          'agent-branch',
          `existing:${path}`
        );
      }
    });

    it('serializes setup and runtime writes to the same branch', async () => {
      let active = false;
      const completed: string[] = [];
      mockCreateOrUpdateFile.mockImplementation(async (...args) => {
        expect(active).toBe(false);
        active = true;
        await new Promise(resolve => setTimeout(resolve, 1));
        completed.push(args[3]);
        active = false;
      });
      await pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'branch', {
        ...validConfig,
        acrLoginServer: 'myregistry.azurecr.io',
      });
      expect(completed).toEqual([
        '.github/workflows/copilot-setup-steps.yml',
        '.github/agents/containerization.agent.md',
        ...Object.keys(getAcrBuildFiles()),
      ]);
    });

    it('should propagate errors from createOrUpdateFile', async () => {
      mockCreateOrUpdateFile.mockRejectedValueOnce(new Error('push failed'));
      await expect(
        pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'my-branch', validConfig)
      ).rejects.toThrow('push failed');
      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(1);
    });

    it('updates managed files using target-branch SHAs without writing the existing setup workflow', async () => {
      const oldAgent = `${generateAgentConfig(
        validConfig
      )}\n- Repository-specific policy: keep tests.\n`;
      mockGetContent.mockImplementation(async ({ path }) => ({
        data: {
          type: 'file',
          sha: `target:${path}`,
          encoding: 'base64',
          content: Buffer.from(path.endsWith('.md') ? oldAgent : SETUP_WORKFLOW_CONTENT).toString(
            'base64'
          ),
        },
      }));
      await pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'upgrade-branch', validConfig);
      for (const call of mockCreateOrUpdateFile.mock.calls) {
        expect(call[6]).toBe('upgrade-branch');
        expect(call[7]).toBe(`target:${call[3]}`);
      }
      expect(
        mockCreateOrUpdateFile.mock.calls.find(call => call[3].endsWith('.md'))?.[4]
      ).toContain('Repository-specific policy: keep tests.');
      expect(mockCreateOrUpdateFile.mock.calls.some(call => call[3].endsWith('.yml'))).toBe(false);
    });

    it('does not blindly overwrite setup files on a lookup failure', async () => {
      mockGetContent.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
      await expect(
        pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'upgrade-branch', validConfig)
      ).rejects.toThrow('Forbidden');
      expect(mockCreateOrUpdateFile).not.toHaveBeenCalled();
    });

    it.each(['workflow', 'agent'])(
      'fails before any file writes when the existing %s requires manual migration',
      async incompatible => {
        mockGetContent.mockImplementation(async ({ path }) => ({
          data: {
            type: 'file',
            sha: `existing:${path}`,
            encoding: 'base64',
            content: Buffer.from(
              path.endsWith('.md')
                ? incompatible === 'agent'
                  ? '# Repository-owned agent\n'
                  : generateAgentConfig(validConfig)
                : incompatible === 'workflow'
                ? 'jobs:\n  copilot-setup-steps:\n    steps: null\n'
                : SETUP_WORKFLOW_CONTENT
            ).toString('base64'),
          },
        }));
        await expect(
          pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'upgrade-branch', validConfig)
        ).rejects.toThrow('manual migration');
        expect(mockCreateOrUpdateFile).not.toHaveBeenCalled();
      }
    );

    it('preserves a customized workflow without requesting a write', async () => {
      const parsed = YAML.parse(SETUP_WORKFLOW_CONTENT);
      parsed.permissions = { contents: 'read', 'pull-requests': 'write' };
      const job = parsed.jobs['copilot-setup-steps'];
      job.services = { redis: { image: 'redis:7' } };
      job.steps.push({
        uses: 'actions/setup-java@v4',
        with: { 'java-version': '21', distribution: 'temurin' },
      });
      const custom = YAML.stringify(parsed);
      mockGetContent.mockImplementation(async ({ path }) => ({
        data: {
          type: 'file',
          sha: `existing:${path}`,
          encoding: 'base64',
          content: Buffer.from(
            path.endsWith('.md') ? generateAgentConfig(validConfig) : custom
          ).toString('base64'),
        },
      }));
      await pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'upgrade-branch', validConfig);
      expect(mockCreateOrUpdateFile.mock.calls.some(call => call[3].endsWith('.yml'))).toBe(false);
    });
  });

  describe('upgradeAgentConfig', () => {
    const config = createValidConfig({ acrLoginServer: 'myregistry.azurecr.io' });

    it('upgrades the exact previous-release CLI template while retaining repository guidance', () => {
      expect(preRestAgent).toContain('az acr build --registry');
      expect(isAgentConfigCurrent(preRestAgent, config)).toBe(false);
      const suffix = '\n## Repository guidance\nRun our integration tests.\n';
      expect(upgradeAgentConfig(preRestAgent + suffix, config)).toBe(
        generateAgentConfig(config) + suffix
      );
      expect(upgradeAgentConfig(upgradeAgentConfig(preRestAgent, config), config)).toBe(
        generateAgentConfig(config)
      );
    });

    it('does not adopt a customized previous-release CLI template by guessing ownership', () => {
      const customized = preRestAgent.replace('--image my-app:', '--image repository-owned:');
      expect(isAgentConfigCurrent(customized, config)).toBe(false);
      expect(() => upgradeAgentConfig(customized, config)).toThrow('manual migration');
    });

    it('requires manual migration for outdated custom legacy files, without guessing ownership', () => {
      const old = [
        '---\nname: containerize-and-deploy\n---',
        '## GitHub Actions Workflow Requirements',
        '- Custom workflow instruction: run unit tests first.',
        '- Build/push image via ACR Tasks: `az acr build --registry old .`',
        '## Naming Conventions',
        '- Keep our naming convention.',
      ].join('\n');
      expect(() => upgradeAgentConfig(old, config)).toThrow('manual migration');
    });

    it('updates only the explicitly managed block on later upgrades', () => {
      const old = `${generateAgentConfig(config)}\n## Custom guidance\nKeep this.\n`;
      const updated = upgradeAgentConfig(old, { ...config, appName: 'updated-app' });
      expect(updated).toContain('myregistry.azurecr.io/updated-app:');
      expect(updated).toContain('## Custom guidance\nKeep this.');
      expect(updated).toContain(
        'PR title: "[AKS Desktop] Add deployment pipeline for updated-app"'
      );
      expect(upgradeAgentConfig(updated, { ...config, appName: 'updated-app' })).toBe(updated);
    });

    it('refuses unrecognized conflicting custom CLI instructions and incomplete markers', () => {
      expect(() => upgradeAgentConfig('Use `az acr build --registry custom .`', config)).toThrow(
        'manual migration'
      );
      expect(() => upgradeAgentConfig('<!-- aks-desktop:acr-build:start -->', config)).toThrow(
        'manual migration'
      );
    });
  });

  it('does not silently replace customized unmarked runtime instruction blocks', () => {
    const config = createValidConfig({ acrLoginServer: 'myregistry.azurecr.io' });
    const customized = generateAgentConfig(config)
      .replace(/<!-- aks-desktop:deployment:v1:(?:start|end) -->\n/g, '')
      .replace(/<!-- Generated deployment contract:[^\n]*\n/g, '')
      .replace('- Deploy image', '- Custom instruction: retain this.\n- Deploy image');
    expect(() => upgradeAgentConfig(customized, config)).toThrow('manual migration');
  });

  describe('generated setup ownership', () => {
    const configA = createValidConfig({
      acrLoginServer: 'registrya.azurecr.io',
      acrResourceId:
        '/subscriptions/a/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/registrya',
      clusterName: 'cluster-a',
      resourceGroup: 'group-a',
      namespace: 'namespace-a',
      appName: 'app-a',
      containerConfig: createContainerConfig({
        enableWorkloadIdentity: true,
        workloadIdentityClientId: 'old-workload-client',
        envVars: [{ key: 'OLD_KEY', value: 'private-value', isSecret: true }],
      }),
    });
    const configB = createValidConfig({
      acrLoginServer: 'registryb.azurecr.io',
      clusterName: 'cluster-b',
      resourceGroup: 'group-b',
      namespace: 'namespace-b',
      appName: 'app-b',
      serviceType: 'ClusterIP',
    });
    const guidance =
      '\n## Repository guidance\nUse our test runner and preserve our conventions.\n';
    const withoutOwnership = (content: string) =>
      content
        .replace(/<!-- aks-desktop:deployment:v1:(?:start|end) -->\n/g, '')
        .replace(/<!-- Generated deployment contract:[^\n]*\n/g, '');

    it('updates all generated targets, defaults, validation and optional secrets together', () => {
      const original = generateAgentConfig(configA) + guidance;
      expect(isAgentConfigCurrent(original, configB)).toBe(false);
      const upgraded = upgradeAgentConfig(original, configB);
      expect(upgraded).toBe(generateAgentConfig(configB) + guidance);
      for (const obsolete of [
        'cluster-a',
        'group-a',
        'namespace-a',
        'app-a',
        'registrya',
        'OLD_KEY',
        'old-workload-client',
        '${{ secrets.AZURE_ACR_RESOURCE_ID }}',
      ]) {
        expect(upgraded).not.toContain(obsolete);
      }
      expect(isAgentConfigCurrent(upgraded, configB)).toBe(true);
      expect(upgradeAgentConfig(upgraded, configB)).toBe(upgraded);
    });

    it('removes all owned ACR instructions when the registry is deselected', () => {
      const plain = createValidConfig();
      const original = generateAgentConfig(configA) + guidance;
      expect(isAgentConfigCurrent(original, plain)).toBe(false);
      const upgraded = upgradeAgentConfig(original, plain);
      expect(upgraded).toBe(generateAgentConfig(plain) + guidance);
      expect(upgraded).not.toContain('AZURE_ACR_');
      expect(upgraded).not.toContain(ACR_BUILD_SCRIPT_PATH);
      expect(isAgentConfigCurrent(upgraded, plain)).toBe(true);
    });

    it('adopts only an exact current legacy generated prefix, retaining custom guidance', () => {
      const legacy = withoutOwnership(generateAgentConfig(configB));
      expect(isAgentConfigCurrent(legacy + guidance, configB)).toBe(true);
      expect(upgradeAgentConfig(legacy + guidance, configB)).toBe(
        generateAgentConfig(configB) + guidance
      );
      expect(() => upgradeAgentConfig(legacy + guidance, configA)).toThrow('manual migration');
    });

    it.each([
      '# Unknown agent\n',
      '<!-- aks-desktop:deployment:v2:start -->',
      '<!-- aks-desktop:deployment:v1:start -->',
    ])('fails closed for unrecognized ownership: %s', content => {
      expect(isAgentConfigCurrent(content, configB)).toBe(false);
      expect(() => upgradeAgentConfig(content, configB)).toThrow('manual migration');
    });

    it.each([
      (content: string) => content.replace('<!-- aks-desktop:deployment:v1:end -->', ''),
      (content: string) => content + '\n<!-- aks-desktop:deployment:v1:end -->',
      (content: string) =>
        content.replace('## Role', '<!-- aks-desktop:deployment:v1:start -->\n## Role'),
      (content: string) =>
        content.replace('## Role', '<!-- aks-desktop:acr-build:start -->\n## Role'),
    ])('rejects malformed, nested or duplicate ownership before migration', mutate => {
      const existing = mutate(generateAgentConfig(configB));
      expect(isAgentConfigCurrent(existing, configB)).toBe(false);
      expect(() => upgradeAgentConfig(existing, configB)).toThrow('manual migration');
    });

    it('does not accept stale unmanaged ACR instructions after the owned block', () => {
      const existing =
        generateAgentConfig(createValidConfig()) +
        '\n<!-- aks-desktop:acr-build:start -->\nUse secrets.AZURE_ACR_NAME\n<!-- aks-desktop:acr-build:end -->';
      expect(isAgentConfigCurrent(existing, createValidConfig())).toBe(false);
      expect(() => upgradeAgentConfig(existing, createValidConfig())).toThrow('manual migration');
    });
  });

  describe('setup workflow compatibility', () => {
    it.each([
      (workflow: any) => {
        delete workflow.on;
      },
      (workflow: any) => {
        workflow.on = [];
      },
      (workflow: any) => {
        workflow.on = {};
      },
      (workflow: any) => {
        delete workflow.jobs['copilot-setup-steps']['runs-on'];
      },
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps']['runs-on'] = [];
      },
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps']['runs-on'] = { group: '' };
      },
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps'].steps = [{ run: '' }];
      },
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps'].steps = [{ run: 'echo test', uses: '' }];
      },
    ])(
      'requires executable workflow/job structure without substituting a stock workflow',
      mutate => {
        const workflow = YAML.parse(SETUP_WORKFLOW_CONTENT);
        mutate(workflow);
        const content = YAML.stringify(workflow);
        expect(isSetupWorkflowCurrent(content)).toBe(false);
        expect(() => upgradeSetupWorkflow(content)).toThrow('manual migration');
      }
    );

    it.each([
      { on: 'workflow_dispatch', runner: 'custom-runner' },
      { on: ['push', 'workflow_dispatch'], runner: ['self-hosted', 'linux'] },
      {
        on: { workflow_dispatch: { inputs: { version: { type: 'string' } } } },
        runner: { group: 'custom', labels: ['linux'] },
      },
    ])('preserves valid custom trigger and runner forms (%o)', input => {
      const workflow = YAML.parse(SETUP_WORKFLOW_CONTENT);
      workflow.on = input.on;
      workflow.jobs['copilot-setup-steps']['runs-on'] = input.runner;
      const content = YAML.stringify(workflow);
      expect(isSetupWorkflowCurrent(content)).toBe(true);
      expect(upgradeSetupWorkflow(content)).toBe(content);
    });

    const customWorkflow = () => {
      const parsed = YAML.parse(SETUP_WORKFLOW_CONTENT);
      parsed.permissions = { contents: 'read', packages: 'read', 'pull-requests': 'write' };
      const job = parsed.jobs['copilot-setup-steps'];
      job.services = { postgres: { image: 'postgres:16', env: { POSTGRES_PASSWORD: 'test' } } };
      job.steps.splice(2, 0, {
        name: 'Set up Java',
        uses: 'actions/setup-java@v4',
        with: { distribution: 'temurin', 'java-version': '21' },
      });
      return YAML.stringify(parsed);
    };

    it('preserves custom toolchain, services and permissions byte-for-byte and idempotently', () => {
      const custom = customWorkflow();
      expect(isSetupWorkflowCurrent(custom)).toBe(true);
      expect(upgradeSetupWorkflow(custom)).toBe(custom);
      expect(upgradeSetupWorkflow(upgradeSetupWorkflow(custom))).toBe(custom);
    });

    it.each([
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps'].steps[1].with['node-version'] = '18';
      },
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps'].env = { CUSTOM_TOOL_VERSION: '3.2' };
      },
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps']['runs-on'] = ['self-hosted', 'linux'];
      },
      (workflow: any) => {
        workflow.jobs.verify = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo verify' }] };
      },
      (workflow: any) => {
        workflow.jobs['copilot-setup-steps'].steps[1]['continue-on-error'] = true;
      },
      (workflow: any) => {
        workflow.on.push = {};
      },
    ])('does not impose stock setup requirements on repository-owned customizations', mutate => {
      const parsed = YAML.parse(customWorkflow());
      mutate(parsed);
      const custom = YAML.stringify(parsed);
      expect(isSetupWorkflowCurrent(custom)).toBe(true);
      expect(upgradeSetupWorkflow(custom)).toBe(custom);
    });

    it('preserves a wholly repository-authored setup without inserting stock installation steps', () => {
      const custom = `name: Repository setup
on: workflow_dispatch
permissions: { contents: read }
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    container: node:24
    steps:
      - run: ./scripts/setup-agent.sh
`;
      expect(isSetupWorkflowCurrent(custom)).toBe(true);
      expect(upgradeSetupWorkflow(custom)).toBe(custom);
    });

    it('rejects malformed or duplicate YAML keys', () => {
      for (const workflow of ['jobs: [', SETUP_WORKFLOW_CONTENT + '\njobs: {}\n']) {
        expect(isSetupWorkflowCurrent(workflow)).toBe(false);
        expect(() => upgradeSetupWorkflow(workflow)).toThrow('manual migration');
      }
    });
  });

  describe('validatePipelineConfig', () => {
    it('should pass for a valid config', () => {
      const result = validatePipelineConfig(validConfig);
      expect(result).toEqual({ isValid: true, errors: [] });
    });

    it('should fail when required fields are empty', () => {
      const config: PipelineConfig = {
        ...validConfig,
        clusterName: '',
        namespace: '',
        appName: '',
      };
      const result = validatePipelineConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Cluster name is required');
      expect(result.errors).toContain('Namespace is required');
      expect(result.errors).toContain('App name is required');
    });

    it('should fail for invalid namespace format', () => {
      const config: PipelineConfig = { ...validConfig, namespace: 'INVALID_NS!' };
      const result = validatePipelineConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('Namespace must contain only');
    });

    it('should fail when repo owner or name is missing', () => {
      const config: PipelineConfig = {
        ...validConfig,
        repo: { owner: '', repo: '', defaultBranch: 'main' },
      };
      const result = validatePipelineConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Repository owner and name are required');
    });

    it('should never throw', () => {
      const config: PipelineConfig = {
        tenantId: '',
        identityId: '',
        subscriptionId: '',
        clusterName: '',
        resourceGroup: '',
        namespace: '',
        appName: '',
        serviceType: 'ClusterIP',
        repo: { owner: '', repo: '', defaultBranch: '' },
      };
      expect(() => validatePipelineConfig(config)).not.toThrow();
      const result = validatePipelineConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
