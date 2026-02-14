// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { PipelineConfig } from '../types';

// Mock github-api module
const mockGetDefaultBranchSha = vi.fn();
const mockCreateBranch = vi.fn();
const mockCreateOrUpdateFile = vi.fn();
const mockCreatePullRequest = vi.fn();
const mockCreateIssue = vi.fn();
const mockAssignIssueToCopilot = vi.fn();

vi.mock('../../../utils/github/github-api', () => ({
  getDefaultBranchSha: (...args: unknown[]) => mockGetDefaultBranchSha(...args),
  createBranch: (...args: unknown[]) => mockCreateBranch(...args),
  createOrUpdateFile: (...args: unknown[]) => mockCreateOrUpdateFile(...args),
  createPullRequest: (...args: unknown[]) => mockCreatePullRequest(...args),
  createIssue: (...args: unknown[]) => mockCreateIssue(...args),
  assignIssueToCopilot: (...args: unknown[]) => mockAssignIssueToCopilot(...args),
}));

// Mock agentTemplates to control generated content
vi.mock('./agentTemplates', async () => {
  const actual = await vi.importActual('./agentTemplates');
  return {
    ...actual,
    generateBranchName: vi.fn(() => 'aks-desktop/setup-my-app-1700000000000'),
  };
});

import { createSetupPR, triggerCopilotAgent } from './pipelineOrchestration';

const validConfig: PipelineConfig = {
  tenantId: 'tenant-123',
  identityId: 'identity-456',
  subscriptionId: 'sub-789',
  clusterName: 'my-cluster',
  resourceGroup: 'my-rg',
  namespace: 'production',
  appName: 'my-app',
  serviceType: 'LoadBalancer',
  repo: { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' },
};

const mockOctokit = {} as never;

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

      // Verify branch creation
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
        'aks-desktop/setup-my-app-1700000000000',
        'abc123'
      );

      // Verify two files pushed (workflow + agent config)
      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2);
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        '.github/workflows/copilot-setup-steps.yml',
        expect.any(String),
        expect.stringContaining('Copilot setup workflow'),
        'aks-desktop/setup-my-app-1700000000000'
      );
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        '.github/agents/containerization.agent.md',
        expect.any(String),
        expect.stringContaining('containerization agent config'),
        'aks-desktop/setup-my-app-1700000000000'
      );

      // Verify PR creation
      expect(mockCreatePullRequest).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        expect.stringContaining('my-app'),
        expect.stringContaining('Containerization Agent Setup'),
        'aks-desktop/setup-my-app-1700000000000',
        'main'
      );
    });

    it('should propagate errors from GitHub API', async () => {
      mockGetDefaultBranchSha.mockRejectedValue(new Error('Not Found'));

      await expect(createSetupPR(mockOctokit, validConfig)).rejects.toThrow('Not Found');
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

      // Verify YAML payload contains config values
      const issueBody = mockCreateIssue.mock.calls[0][4] as string;
      expect(issueBody).toContain('cluster: my-cluster');
      expect(issueBody).toContain('namespace: production');
      expect(issueBody).toContain('tenantId: tenant-123');
      expect(issueBody).toContain('identityId: identity-456');
      expect(issueBody).toContain('subscriptionId: sub-789');
      expect(issueBody).toContain('appName: my-app');
      expect(issueBody).toContain('serviceType: LoadBalancer');
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
      expect(issueBody).toContain('ingressHost: myapp.example.com');
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

      const cc: ContainerConfig = {
        containerStep: 0,
        appName: 'my-app',
        containerImage: 'nginx:1.25',
        replicas: 3,
        targetPort: 8080,
        servicePort: 80,
        useCustomServicePort: false,
        serviceType: 'LoadBalancer',
        enableResources: true,
        cpuRequest: '200m',
        cpuLimit: '1',
        memoryRequest: '256Mi',
        memoryLimit: '1Gi',
        envVars: [{ key: 'NODE_ENV', value: 'production' }],
        enableLivenessProbe: true,
        enableReadinessProbe: true,
        enableStartupProbe: true,
        showProbeConfigs: false,
        livenessPath: '/health',
        readinessPath: '/ready',
        startupPath: '/',
        livenessInitialDelay: 10,
        livenessPeriod: 10,
        livenessTimeout: 1,
        livenessFailure: 3,
        livenessSuccess: 1,
        readinessInitialDelay: 5,
        readinessPeriod: 10,
        readinessTimeout: 1,
        readinessFailure: 3,
        readinessSuccess: 1,
        startupInitialDelay: 0,
        startupPeriod: 10,
        startupTimeout: 1,
        startupFailure: 30,
        startupSuccess: 1,
        enableHpa: true,
        hpaMinReplicas: 2,
        hpaMaxReplicas: 10,
        hpaTargetCpu: 80,
        runAsNonRoot: true,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
        enablePodAntiAffinity: true,
        enableTopologySpreadConstraints: true,
        containerPreviewYaml: '',
      };
      const config: PipelineConfig = { ...validConfig, containerConfig: cc };
      await triggerCopilotAgent(mockOctokit, config);

      const issueBody = mockCreateIssue.mock.calls[0][4] as string;
      expect(issueBody).toContain('containerImage: nginx:1.25');
      expect(issueBody).toContain('replicas: 3');
      expect(issueBody).toContain('targetPort: 8080');
      expect(issueBody).toContain('cpuRequest: 200m');
      expect(issueBody).toContain('memoryLimit: 1Gi');
      expect(issueBody).toContain('key: NODE_ENV');
      expect(issueBody).toContain('livenessProbe:');
      expect(issueBody).toContain('path: /health');
      expect(issueBody).toContain('hpa:');
      expect(issueBody).toContain('minReplicas: 2');
      expect(issueBody).toContain('runAsNonRoot: true');
    });
  });
});
