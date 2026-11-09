// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { createContainerConfig, createValidConfig } from '../__fixtures__/pipelineConfig';
import type { PipelineConfig } from '../types';
import { generateDeployWorkflow } from './fastPathTemplates';

// Mock github-api module — vi.hoisted ensures mocks are available when vi.mock is hoisted
const {
  mockGetDefaultBranchSha,
  mockCreateBranch,
  mockCreateOrUpdateFile,
  mockCreatePullRequest,
  mockCreateCopilotAssignedIssue,
  mockSetRepoSecrets,
  mockDeleteBranch,
} = vi.hoisted(() => ({
  mockGetDefaultBranchSha: vi.fn(),
  mockCreateBranch: vi.fn(),
  mockCreateOrUpdateFile: vi.fn(),
  mockCreatePullRequest: vi.fn(),
  mockCreateCopilotAssignedIssue: vi.fn(),
  mockSetRepoSecrets: vi.fn(),
  mockDeleteBranch: vi.fn(),
}));

vi.mock('../../../utils/github/github-api', () => ({
  getDefaultBranchSha: mockGetDefaultBranchSha,
  createBranch: mockCreateBranch,
  createOrUpdateFile: mockCreateOrUpdateFile,
  createPullRequest: mockCreatePullRequest,
  createCopilotAssignedIssue: mockCreateCopilotAssignedIssue,
  setRepoSecrets: mockSetRepoSecrets,
  deleteBranch: mockDeleteBranch,
}));

const { mockPushAgentConfigFiles } = vi.hoisted(() => ({
  mockPushAgentConfigFiles: vi.fn(),
}));

vi.mock('./agentTemplates', async () => {
  const actual = await vi.importActual('./agentTemplates');
  return {
    ...actual,
    generateBranchName: vi.fn(() => 'aks-project/setup-my-app-1700000000000'),
    pushAgentConfigFiles: mockPushAgentConfigFiles,
  };
});

import {
  createPipelineSecrets,
  createSetupPR,
  toEnvSecretName,
  triggerCopilotAgent,
} from './pipelineOrchestration';

const validConfig = createValidConfig();

const mockOctokit = {} as unknown as Octokit;

describe('pipelineOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushAgentConfigFiles.mockResolvedValue(undefined);
  });

  describe('createSetupPR', () => {
    it('should create branch, push files, and open PR', async () => {
      mockGetDefaultBranchSha.mockResolvedValue('abc123');
      mockCreateBranch.mockResolvedValue(undefined);
      mockCreateOrUpdateFile.mockResolvedValue(undefined);
      mockCreatePullRequest.mockResolvedValue({
        number: 42,
        url: 'https://github.com/testuser/my-repo/pull/42',
      });

      const result = await createSetupPR(mockOctokit, validConfig);

      expect(result).toEqual({
        url: 'https://github.com/testuser/my-repo/pull/42',
        number: 42,
        merged: false,
      });

      expect(mockGetDefaultBranchSha).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'main'
      );
      expect(mockCreateBranch).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'aks-project/setup-my-app-1700000000000',
        'abc123'
      );

      expect(mockPushAgentConfigFiles).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'aks-project/setup-my-app-1700000000000',
        validConfig
      );

      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        expect.stringContaining('my-app'),
        expect.stringContaining('Containerization Agent Setup'),
        'aks-project/setup-my-app-1700000000000',
        'main'
      );
    });

    it('should propagate errors from GitHub API', async () => {
      mockGetDefaultBranchSha.mockRejectedValue(new Error('Not Found'));

      await expect(createSetupPR(mockOctokit, validConfig)).rejects.toThrow('Not Found');
    });

    it('should attempt branch cleanup when PR creation fails', async () => {
      mockGetDefaultBranchSha.mockResolvedValue('abc123');
      mockCreateBranch.mockResolvedValue(undefined);
      mockCreateOrUpdateFile.mockResolvedValue(undefined);
      mockCreatePullRequest.mockRejectedValue(new Error('PR creation failed'));

      await expect(createSetupPR(mockOctokit, validConfig)).rejects.toThrow('PR creation failed');

      expect(mockDeleteBranch).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'aks-project/setup-my-app-1700000000000'
      );
    });
  });

  describe('triggerCopilotAgent', () => {
    it('should create issue then assign to copilot-swe-agent[bot]', async () => {
      mockCreateCopilotAssignedIssue.mockResolvedValue({
        number: 10,
        url: 'https://github.com/testuser/my-repo/issues/10',
      });

      const result = await triggerCopilotAgent(mockOctokit, validConfig);

      expect(result).toEqual({
        url: 'https://github.com/testuser/my-repo/issues/10',
        number: 10,
      });

      expect(mockCreateCopilotAssignedIssue).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'Generate AKS deployment pipeline',
        expect.stringContaining('```yaml'),
        'main'
      );

      const issueBody = mockCreateCopilotAssignedIssue.mock.calls[0][4] as string;
      expect(issueBody).toContain('cluster: "my-cluster"');
      expect(issueBody).toContain('namespace: "production"');
      expect(issueBody).toContain('appName: "my-app"');
      expect(issueBody).toContain('serviceType: "LoadBalancer"');
      // Sensitive values should NOT appear in issue body
      expect(issueBody).not.toContain('tenant-123');
      expect(issueBody).not.toContain('identity-456');
      expect(issueBody).not.toContain('sub-789');
      // Should reference secrets instead
      expect(issueBody).toContain('secrets.AZURE_CLIENT_ID');
      expect(issueBody).toContain('secrets.AZURE_TENANT_ID');
      expect(issueBody).toContain('secrets.AZURE_SUBSCRIPTION_ID');
    });

    it('should include optional fields in payload when provided', async () => {
      mockCreateCopilotAssignedIssue.mockResolvedValue({
        number: 11,
        url: 'https://example.com/issues/11',
      });

      const config: PipelineConfig = {
        ...validConfig,
        ingressEnabled: true,
        ingressHost: 'myapp.example.com',
        port: 8080,
      };
      await triggerCopilotAgent(mockOctokit, config);

      const issueBody = mockCreateCopilotAssignedIssue.mock.calls[0][4] as string;
      expect(issueBody).toContain('ingressEnabled: true');
      expect(issueBody).toContain('ingressHost: "myapp.example.com"');
      expect(issueBody).toContain('port: 8080');
    });

    it('should throw on invalid config', async () => {
      const config: PipelineConfig = { ...validConfig, clusterName: '', namespace: '' };

      await expect(triggerCopilotAgent(mockOctokit, config)).rejects.toThrow(
        'Invalid pipeline config'
      );
      expect(mockCreateCopilotAssignedIssue).not.toHaveBeenCalled();
    });

    it('should propagate errors from createCopilotAssignedIssue', async () => {
      mockCreateCopilotAssignedIssue.mockRejectedValue(new Error('Failed to create issue'));

      await expect(triggerCopilotAgent(mockOctokit, validConfig)).rejects.toThrow(
        'Failed to create issue'
      );
      expect(mockCreateCopilotAssignedIssue).toHaveBeenCalledTimes(1);
    });

    it('should include container configuration in issue body when provided', async () => {
      mockCreateCopilotAssignedIssue.mockResolvedValue({
        number: 12,
        url: 'https://example.com/issues/12',
      });

      const cc = createContainerConfig();
      const config: PipelineConfig = { ...validConfig, containerConfig: cc };
      await triggerCopilotAgent(mockOctokit, config);

      const issueBody = mockCreateCopilotAssignedIssue.mock.calls[0][4] as string;
      expect(issueBody).toContain('containerImage: "nginx:1.25"');
      expect(issueBody).toContain('replicas: 3');
      expect(issueBody).toContain('targetPort: 8080');
      expect(issueBody).toContain('cpuRequest: "200m"');
      expect(issueBody).toContain('memoryLimit: "1Gi"');
      expect(issueBody).toContain('key: "NODE_ENV"');
      expect(issueBody).toContain('secretRef: "APP_ENV_NODE_ENV"');
      expect(issueBody).not.toContain('value: "production"');
      expect(issueBody).toContain('livenessProbe:');
      expect(issueBody).toContain('path: "/health"');
      expect(issueBody).toContain('hpa:');
      expect(issueBody).toContain('minReplicas: 2');
      expect(issueBody).toContain('runAsNonRoot: true');
    });

    it('should escape YAML-breaking characters in config values', async () => {
      mockCreateCopilotAssignedIssue.mockResolvedValue({
        number: 20,
        url: 'https://github.com/testuser/my-repo/issues/20',
      });

      // Use values that pass validation but contain YAML injection attempts.
      // namespace has strict regex validation, so we only inject in other fields.
      const maliciousConfig = createValidConfig({
        appName: 'my-app"\nmalicious: true',
        clusterName: 'cluster\ninjection: yes',
        resourceGroup: 'rg"\nevil: true',
      });

      await triggerCopilotAgent(mockOctokit, maliciousConfig);

      const issueBody = mockCreateCopilotAssignedIssue.mock.calls[0][4] as string;
      // Verify that newlines within YAML values are escaped
      expect(issueBody).toContain('appName: "my-app\\"\\nmalicious: true"');
      expect(issueBody).toContain('cluster: "cluster\\ninjection: yes"');
      expect(issueBody).toContain('resourceGroup: "rg\\"\\nevil: true"');
    });
  });

  describe('toEnvSecretName', () => {
    it('should prefix with APP_ENV_ for normal keys', () => {
      expect(toEnvSecretName('NODE_ENV')).toBe('APP_ENV_NODE_ENV');
    });

    it('should convert lowercase to uppercase', () => {
      expect(toEnvSecretName('api_key')).toBe('APP_ENV_API_KEY');
    });

    it('should replace special characters with underscores', () => {
      expect(toEnvSecretName('my-var.name')).toBe('APP_ENV_MY_VAR_NAME');
    });

    it('should trim leading and trailing spaces', () => {
      expect(toEnvSecretName('  FOO  ')).toBe('APP_ENV_FOO');
    });

    it('should handle empty string', () => {
      expect(toEnvSecretName('')).toBe('APP_ENV_');
    });
  });

  describe('createPipelineSecrets', () => {
    it.each(['deterministic', 'agent'])(
      'ignores a retained registry A ID after switching to name-only registry B (%s)',
      async generationPath => {
        const retainedSecrets: Record<string, string> = {};
        mockSetRepoSecrets.mockImplementation(
          async (
            _client: Octokit,
            _owner: string,
            _repo: string,
            secrets: Record<string, string>
          ) => {
            Object.assign(retainedSecrets, secrets);
          }
        );
        const registryAId =
          '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.ContainerRegistry/registries/registrya';
        await createPipelineSecrets(
          mockOctokit,
          createValidConfig({
            acrLoginServer: 'registrya.azurecr.io',
            acrResourceId: registryAId,
          })
        );
        const next = createValidConfig({
          acrLoginServer: 'registryb.azurecr.io',
          acrResourceId: undefined,
        });
        await createPipelineSecrets(mockOctokit, next);
        expect(retainedSecrets.AZURE_ACR_RESOURCE_ID).toBe(registryAId);
        expect(retainedSecrets.AZURE_ACR_NAME).toBe('registryb');

        let steps: { env: Record<string, string> }[];
        if (generationPath === 'deterministic') {
          const workflow = YAML.parse(
            generateDeployWorkflow({
              appName: next.appName,
              clusterName: next.clusterName,
              resourceGroup: next.resourceGroup,
              namespace: next.namespace,
              acrName: retainedSecrets.AZURE_ACR_NAME,
              acrResourceId: next.acrResourceId,
              dockerfilePath: 'Dockerfile',
              buildContextPath: '.',
              defaultBranch: next.repo.defaultBranch,
            })
          );
          expect(workflow.env.AZURE_ACR_RESOURCE_ID).toBe('');
          steps = workflow.jobs.buildImage.steps.filter((step: { env?: unknown }) => step.env);
        } else {
          const { generateAgentConfig } = await import('./agentTemplates');
          const instructions = generateAgentConfig(next);
          const match = instructions.match(/```yaml\n([\s\S]*?)```/);
          expect(match).not.toBeNull();
          steps = YAML.parse(match![1]).steps;
        }
        for (const step of steps) {
          expect(step.env.AZURE_ACR_RESOURCE_ID).toBe('');
          const name =
            step.env.AZURE_CONTAINER_REGISTRY === '${{ secrets.AZURE_ACR_NAME }}'
              ? retainedSecrets.AZURE_ACR_NAME
              : step.env.AZURE_CONTAINER_REGISTRY;
          expect(name).toBe('registryb');
        }
      }
    );

    it('should pass Azure credentials as secrets', async () => {
      mockSetRepoSecrets.mockResolvedValue(undefined);

      await createPipelineSecrets(mockOctokit, validConfig);

      expect(mockSetRepoSecrets).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        expect.objectContaining({
          AZURE_CLIENT_ID: 'identity-456',
          AZURE_TENANT_ID: 'tenant-123',
          AZURE_SUBSCRIPTION_ID: 'sub-789',
        })
      );
    });

    it('should include env var secrets with generated names', async () => {
      mockSetRepoSecrets.mockResolvedValue(undefined);

      const cc = createContainerConfig({
        envVars: [
          { key: 'NODE_ENV', value: 'production', isSecret: false },
          { key: 'API_KEY', value: 'secret-key', isSecret: false },
        ],
      });
      const config: PipelineConfig = { ...validConfig, containerConfig: cc };

      await createPipelineSecrets(mockOctokit, config);

      const secrets = mockSetRepoSecrets.mock.calls[0][3] as Record<string, string>;
      expect(secrets.APP_ENV_NODE_ENV).toBe('production');
      expect(secrets.APP_ENV_API_KEY).toBe('secret-key');
    });

    it('should filter out env vars with empty keys', async () => {
      mockSetRepoSecrets.mockResolvedValue(undefined);

      const cc = createContainerConfig({
        envVars: [
          { key: '', value: 'should-be-skipped', isSecret: false },
          { key: '   ', value: 'also-skipped', isSecret: false },
          { key: 'VALID', value: 'included', isSecret: false },
        ],
      });
      const config: PipelineConfig = { ...validConfig, containerConfig: cc };

      await createPipelineSecrets(mockOctokit, config);

      const secrets = mockSetRepoSecrets.mock.calls[0][3] as Record<string, string>;
      expect(secrets.APP_ENV_VALID).toBe('included');
      expect(Object.keys(secrets)).not.toContain('APP_ENV_');
    });

    it('should propagate errors from setRepoSecrets', async () => {
      mockSetRepoSecrets.mockRejectedValue(new Error('API failure'));

      await expect(createPipelineSecrets(mockOctokit, validConfig)).rejects.toThrow('API failure');
    });

    describe('ACR name derivation', () => {
      it('passes the registry ARM ID as a secret without replacing the login subscription', async () => {
        mockSetRepoSecrets.mockResolvedValue(undefined);
        const acrResourceId =
          '/subscriptions/registry-sub/resourceGroups/registry-rg/providers/Microsoft.ContainerRegistry/registries/myacr';
        const config = createValidConfig({
          subscriptionId: 'cluster-sub',
          resourceGroup: 'cluster-rg',
          acrResourceId,
        });

        await createPipelineSecrets(mockOctokit, config);

        expect(mockSetRepoSecrets).toHaveBeenCalledWith(
          mockOctokit,
          'testuser',
          'my-repo',
          expect.objectContaining({
            AZURE_ACR_NAME: 'myacr',
            AZURE_ACR_RESOURCE_ID: acrResourceId,
            AZURE_SUBSCRIPTION_ID: 'cluster-sub',
          })
        );
      });

      it('should derive AZURE_ACR_NAME from acrLoginServer', async () => {
        mockSetRepoSecrets.mockResolvedValue(undefined);

        const config: PipelineConfig = { ...validConfig, acrLoginServer: 'myregistry.azurecr.io' };
        await createPipelineSecrets(mockOctokit, config);

        const secrets = mockSetRepoSecrets.mock.calls[0][3] as Record<string, string>;
        expect(secrets.AZURE_ACR_NAME).toBe('myregistry');
      });

      it('should derive AZURE_ACR_NAME from acrResourceId', async () => {
        mockSetRepoSecrets.mockResolvedValue(undefined);

        const config: PipelineConfig = {
          ...validConfig,
          acrResourceId:
            '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.ContainerRegistry/registries/myacr',
        };
        await createPipelineSecrets(mockOctokit, config);

        const secrets = mockSetRepoSecrets.mock.calls[0][3] as Record<string, string>;
        expect(secrets.AZURE_ACR_NAME).toBe('myacr');
      });

      it('should throw when acrLoginServer produces empty first segment', async () => {
        const config: PipelineConfig = { ...validConfig, acrLoginServer: '.azurecr.io' };

        await expect(createPipelineSecrets(mockOctokit, config)).rejects.toThrow(
          'Could not derive ACR name from login server'
        );
        expect(mockSetRepoSecrets).not.toHaveBeenCalled();
      });

      it('should throw when acrResourceId has no registries segment', async () => {
        const config: PipelineConfig = {
          ...validConfig,
          acrResourceId:
            '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.ContainerRegistry',
        };

        await expect(createPipelineSecrets(mockOctokit, config)).rejects.toThrow(
          'Could not derive ACR name from resource ID'
        );
        expect(mockSetRepoSecrets).not.toHaveBeenCalled();
      });

      it('should not set AZURE_ACR_NAME when neither ACR field is provided', async () => {
        mockSetRepoSecrets.mockResolvedValue(undefined);

        await createPipelineSecrets(mockOctokit, validConfig);

        const secrets = mockSetRepoSecrets.mock.calls[0][3] as Record<string, string>;
        expect(Object.keys(secrets)).not.toContain('AZURE_ACR_NAME');
      });
    });
  });
});
