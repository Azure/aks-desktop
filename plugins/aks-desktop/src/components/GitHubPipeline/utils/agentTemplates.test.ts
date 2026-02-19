// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainerConfig, createValidConfig } from '../__fixtures__/pipelineConfig';
import type { PipelineConfig } from '../types';
import {
  generateAgentConfig,
  generateBranchName,
  SETUP_WORKFLOW_CONTENT,
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
      expect(result).toContain('Tenant ID: tenant-123');
      expect(result).toContain('Identity ID: identity-456');
      expect(result).toContain('Subscription ID: sub-789');
      expect(result).toContain('Service Type: LoadBalancer');
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
      expect(result).toContain('aks-desktop/deployed-by: pipeline');
      expect(result).toContain('aks-desktop/pipeline-repo: testuser/my-repo');
      expect(result).toContain('Deployment Annotations (mandatory)');
    });

    it('should include pipeline-run-url annotation instruction in workflow requirements', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('aks-desktop/pipeline-run-url=');
      expect(result).toContain('kubectl annotate deployment --all');
    });

    it('should include GitHub Actions workflow requirements with workflow_dispatch inputs', () => {
      const result = generateAgentConfig(validConfig);
      expect(result).toContain('azure/login@v2');
      expect(result).toContain('azure/aks-set-context@v4');
      expect(result).toContain('workflow_dispatch');
      expect(result).toContain('cluster-name');
      expect(result).toContain('resource-group');
      expect(result).toContain('namespace');
      expect(result).toContain('subscription-id');
      expect(result).toContain('${{ inputs.cluster-name }}');
      expect(result).toContain('${{ inputs.resource-group }}');
      expect(result).toContain('${{ inputs.namespace }}');
      expect(result).toContain('${{ inputs.subscription-id }}');
      expect(result).not.toContain('Trigger on push to main');
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
          { key: 'NODE_ENV', value: 'production' },
          { key: '', value: '' },
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
      expect(result).toContain('Environment Variables: NODE_ENV=production');
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
      expect(result).toBe('aks-desktop/setup-my-app-1700000000000');
    });

    it('should start with aks-desktop/setup-', () => {
      const result = generateBranchName('test');
      expect(result).toMatch(/^aks-desktop\/setup-test-\d+$/);
    });

    it('should sanitize spaces and special characters', () => {
      const result = generateBranchName('My App!@#$');
      expect(result).toBe('aks-desktop/setup-my-app-1700000000000');
    });

    it('should collapse consecutive hyphens', () => {
      const result = generateBranchName('my---app');
      expect(result).toBe('aks-desktop/setup-my-app-1700000000000');
    });

    it('should fallback to "app" for empty or all-special-char names', () => {
      const result = generateBranchName('!!!');
      expect(result).toBe('aks-desktop/setup-app-1700000000000');
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
