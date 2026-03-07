// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainerConfig, createValidConfig } from '../__fixtures__/pipelineConfig';
import { AGENT_CONFIG_PATH, COPILOT_SETUP_STEPS_PATH } from '../constants';
import type { PipelineConfig } from '../types';

// Mock github-api module — vi.hoisted ensures mocks are available when vi.mock is hoisted
const {
  mockGetDefaultBranchSha,
  mockCreateBranch,
  mockCreateOrUpdateFile,
  mockCreatePullRequest,
  mockCreateIssue,
  mockAssignIssueToCopilot,
  mockSetRepoSecrets,
} = vi.hoisted(() => ({
  mockGetDefaultBranchSha: vi.fn(),
  mockCreateBranch: vi.fn(),
  mockCreateOrUpdateFile: vi.fn(),
  mockCreatePullRequest: vi.fn(),
  mockCreateIssue: vi.fn(),
  mockAssignIssueToCopilot: vi.fn(),
  mockSetRepoSecrets: vi.fn(),
}));

vi.mock('../../../utils/github/github-api', () => ({
  getDefaultBranchSha: mockGetDefaultBranchSha,
  createBranch: mockCreateBranch,
  createOrUpdateFile: mockCreateOrUpdateFile,
  createPullRequest: mockCreatePullRequest,
  createIssue: mockCreateIssue,
  assignIssueToCopilot: mockAssignIssueToCopilot,
  setRepoSecrets: mockSetRepoSecrets,
}));

vi.mock('./agentTemplates', async () => {
  const actual = await vi.importActual('./agentTemplates');
  return {
    ...actual,
    generateBranchName: vi.fn(() => 'aks-project/setup-my-app-1700000000000'),
  };
});

import {
  createPipelineSecrets,
  createSetupPR,
  toEnvSecretName,
  triggerCopilotAgent,
} from './pipelineOrchestration';

const validConfig = createValidConfig();

const mockRequest = vi.fn();
const mockOctokit = { request: mockRequest } as unknown as Octokit;

describe('pipelineOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      // Verify two files pushed (workflow + agent config)
      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2);
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        COPILOT_SETUP_STEPS_PATH,
        expect.any(String),
        expect.stringContaining('Copilot setup workflow'),
        'aks-project/setup-my-app-1700000000000'
      );
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        AGENT_CONFIG_PATH,
        expect.any(String),
        expect.stringContaining('containerization agent config'),
        'aks-project/setup-my-app-1700000000000'
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
      mockRequest.mockResolvedValue(undefined);

      await expect(createSetupPR(mockOctokit, validConfig)).rejects.toThrow('PR creation failed');

      // Verify cleanup attempted: DELETE the branch ref
      expect(mockRequest).toHaveBeenCalledWith(
        'DELETE /repos/{owner}/{repo}/git/refs/{ref}',
        expect.objectContaining({
          owner: 'testuser',
          repo: 'my-repo',
          ref: 'heads/aks-project/setup-my-app-1700000000000',
        })
      );
    });
  });

  describe('triggerCopilotAgent', () => {
    it('should create issue then assign to copilot-swe-agent[bot]', async () => {
      mockCreateIssue.mockResolvedValue({
        number: 10,
        url: 'https://github.com/testuser/my-repo/issues/10',
      });
      mockAssignIssueToCopilot.mockResolvedValue(undefined);

      const result = await triggerCopilotAgent(mockOctokit, validConfig);

      expect(result).toEqual({
        url: 'https://github.com/testuser/my-repo/issues/10',
        number: 10,
      });

      // Step 1: Issue created without assignees
      expect(mockCreateIssue).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'Generate AKS deployment pipeline',
        expect.stringContaining('```yaml'),
        []
      );

      // Step 2: Copilot agent assigned via dedicated endpoint
      expect(mockAssignIssueToCopilot).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        10,
        'main'
      );

      const issueBody = mockCreateIssue.mock.calls[0][4] as string;
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
      mockCreateIssue.mockResolvedValue({ number: 11, url: 'https://example.com/issues/11' });
      mockAssignIssueToCopilot.mockResolvedValue(undefined);

      const config: PipelineConfig = {
        ...validConfig,
        ingressEnabled: true,
        ingressHost: 'myapp.example.com',
        port: 8080,
      };
      await triggerCopilotAgent(mockOctokit, config);

      const issueBody = mockCreateIssue.mock.calls[0][4] as string;
      expect(issueBody).toContain('ingressEnabled: true');
      expect(issueBody).toContain('ingressHost: "myapp.example.com"');
      expect(issueBody).toContain('port: 8080');
    });

    it('should throw on invalid config', async () => {
      const config: PipelineConfig = { ...validConfig, clusterName: '', namespace: '' };

      await expect(triggerCopilotAgent(mockOctokit, config)).rejects.toThrow(
        'Invalid pipeline config'
      );
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockAssignIssueToCopilot).not.toHaveBeenCalled();
    });

    it('should propagate errors from createIssue', async () => {
      mockCreateIssue.mockRejectedValue(new Error('Failed to create issue'));

      await expect(triggerCopilotAgent(mockOctokit, validConfig)).rejects.toThrow(
        'Failed to create issue'
      );
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      expect(mockAssignIssueToCopilot).not.toHaveBeenCalled();
    });

    it('should propagate errors from assignIssueToCopilot', async () => {
      mockCreateIssue.mockResolvedValue({
        number: 10,
        url: 'https://github.com/testuser/my-repo/issues/10',
      });
      mockAssignIssueToCopilot.mockRejectedValue(
        new Error('Failed to assign Copilot agent to issue #10')
      );

      await expect(triggerCopilotAgent(mockOctokit, validConfig)).rejects.toThrow(
        'Failed to assign Copilot agent'
      );
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      expect(mockAssignIssueToCopilot).toHaveBeenCalledTimes(1);
    });

    it('should include container configuration in issue body when provided', async () => {
      mockCreateIssue.mockResolvedValue({ number: 12, url: 'https://example.com/issues/12' });
      mockAssignIssueToCopilot.mockResolvedValue(undefined);

      const cc = createContainerConfig();
      const config: PipelineConfig = { ...validConfig, containerConfig: cc };
      await triggerCopilotAgent(mockOctokit, config);

      const issueBody = mockCreateIssue.mock.calls[0][4] as string;
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
      mockCreateIssue.mockResolvedValue({
        number: 20,
        url: 'https://github.com/testuser/my-repo/issues/20',
      });
      mockAssignIssueToCopilot.mockResolvedValue(undefined);

      // Use values that pass validation but contain YAML injection attempts.
      // namespace has strict regex validation, so we only inject in other fields.
      const maliciousConfig = createValidConfig({
        appName: 'my-app"\nmalicious: true',
        clusterName: 'cluster\ninjection: yes',
        resourceGroup: 'rg"\nevil: true',
      });

      await triggerCopilotAgent(mockOctokit, maliciousConfig);

      const issueBody = mockCreateIssue.mock.calls[0][4] as string;
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
          { key: 'NODE_ENV', value: 'production' },
          { key: 'API_KEY', value: 'secret-key' },
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
          { key: '', value: 'should-be-skipped' },
          { key: '   ', value: 'also-skipped' },
          { key: 'VALID', value: 'included' },
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
  });
});
