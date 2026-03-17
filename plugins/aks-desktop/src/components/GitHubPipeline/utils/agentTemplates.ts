// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  CONTAINERIZATION_MCP_VERSION,
  DEFAULT_IMAGE_TAG,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
import type { PipelineConfig } from '../types';
import { toEnvSecretName } from './pipelineOrchestration';
import { getProbeConfigs, renderProbeMarkdown } from './probeHelpers';

/**
 * Returns the non-empty environment variables from a pipeline config.
 * Filters out entries with blank keys.
 */
export function getActiveEnvVars(config: PipelineConfig): Array<{ key: string; value: string }> {
  return config.containerConfig?.envVars?.filter(e => e.key.trim()) ?? [];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Static content for `.github/workflows/copilot-setup-steps.yml`.
 * Matches the reference implementation.
 */
export const SETUP_WORKFLOW_CONTENT = `name: Copilot Setup Steps

on:
  workflow_dispatch:

jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Setup OPA
        uses: open-policy-agent/setup-opa@v2
        with:
          version: latest

      - name: Verify OPA installation
        run: opa version

      - name: Test merge
        run: |
          npx containerization-assist-mcp@${CONTAINERIZATION_MCP_VERSION} list-policies --show-merged
`;

/**
 * Generates workflow instructions for injecting user-defined environment
 * variables from GitHub secrets into Kubernetes.
 */
const generateEnvVarWorkflowInstructions = (config: PipelineConfig): string => {
  const envVars = getActiveEnvVars(config);
  if (envVars.length === 0) return '\n';

  const secretMappings = envVars
    .map(e => `${e.key}=\${{ secrets.${toEnvSecretName(e.key)} }}`)
    .join(' ');

  return `
- Before applying manifests, create a Kubernetes Secret from GitHub secrets for environment variables:
  \`kubectl create secret generic \${{ inputs.namespace }}-env --from-literal=${secretMappings} -n \${{ inputs.namespace }} --dry-run=client -o yaml | kubectl apply -f -\`
- In the Deployment manifest, reference this secret via \`envFrom: [{ secretRef: { name: <namespace>-env } }]\`
`;
};

/**
 * Generates the `.github/agents/containerization.agent.md` file,
 * parameterized with the user's AKS deployment config.
 *
 * Based on the reference implementation at
 * https://github.com/ReinierCC/spring-petclinic/blob/main/.github/agents/containerization.agent.md
 * with an appended AKS-specific deployment section.
 */
export const generateAgentConfig = (config: PipelineConfig): string => {
  const optionalLines: string[] = [];
  if (config.ingressEnabled !== undefined) {
    optionalLines.push(`- Ingress: ${config.ingressEnabled ? 'enabled' : 'disabled'}`);
  }
  if (config.ingressHost) {
    optionalLines.push(`- Ingress Host: ${config.ingressHost}`);
  }
  if (config.imageReference) {
    optionalLines.push(`- Image Reference: ${config.imageReference}`);
  }
  if (config.port !== undefined) {
    optionalLines.push(`- Port: ${config.port}`);
  }

  const cc = config.containerConfig;
  if (cc) {
    if (cc.containerImage) {
      optionalLines.push(`- Container Image: ${cc.containerImage}`);
    }
    optionalLines.push(`- Target Port: ${cc.targetPort}`);
    if (cc.useCustomServicePort) {
      optionalLines.push(`- Service Port: ${cc.servicePort}`);
    }
    optionalLines.push(`- Replicas: ${cc.replicas}`);

    if (cc.enableResources) {
      optionalLines.push(`- CPU Request: ${cc.cpuRequest}`);
      optionalLines.push(`- CPU Limit: ${cc.cpuLimit}`);
      optionalLines.push(`- Memory Request: ${cc.memoryRequest}`);
      optionalLines.push(`- Memory Limit: ${cc.memoryLimit}`);
    }

    const envVars = getActiveEnvVars(config);
    if (envVars.length > 0) {
      optionalLines.push(
        `- Environment Variables (values stored as GitHub secrets): ${envVars
          .map(e => `${e.key} → \`secrets.${toEnvSecretName(e.key)}\``)
          .join(', ')}`
      );
    }

    for (const probe of getProbeConfigs(cc)) {
      optionalLines.push(renderProbeMarkdown(probe));
    }

    if (cc.enableHpa) {
      optionalLines.push(
        `- HPA: enabled (min: ${cc.hpaMinReplicas}, max: ${cc.hpaMaxReplicas}, target CPU: ${cc.hpaTargetCpu}%)`
      );
    }

    if (cc.runAsNonRoot) optionalLines.push(`- Run As Non-Root: true`);
    if (cc.readOnlyRootFilesystem) optionalLines.push(`- Read-Only Root Filesystem: true`);
    if (!cc.allowPrivilegeEscalation) optionalLines.push(`- Allow Privilege Escalation: false`);
    if (cc.enablePodAntiAffinity) optionalLines.push(`- Pod Anti-Affinity: enabled`);
    if (cc.enableTopologySpreadConstraints)
      optionalLines.push(`- Topology Spread Constraints: enabled`);
  }

  const optionalSection = optionalLines.length > 0 ? '\n' + optionalLines.join('\n') : '';

  return `---
name: containerize-and-deploy
description: "Analyze repository, generate a best-practice Dockerfile, Kubernetes manifests, and a GitHub Actions deployment workflow for AKS."
---

## Role
You are a containerization-focused coding agent. Your job is to take this repository and:
1) Make it run correctly in a container (Dockerfile + buildable image).
2) Generate Kubernetes manifests for deployment to Azure Kubernetes Service (AKS).
3) Generate a GitHub Actions workflow for CI/CD deployment to AKS.

## Hard Requirements
- **Image tag must be \`${DEFAULT_IMAGE_TAG}\`** (always).
- Maintain a checklist at \`artifacts/tool-call-checklist.md\` and update it immediately after each tool call.
- **Always call these in order** for Dockerfile work:
  1) \`containerization-assist-mcp/generate-dockerfile\`
  2) \`containerization-assist-mcp/fix-dockerfile\`
  3) \`containerization-assist-mcp/build-image\`

## Tools
Do not restrict tools. Use any available built-in tools and MCP tools.
Prefer using these MCP tools when available:
- containerization-assist-mcp/analyze-repo
- containerization-assist-mcp/generate-dockerfile
- containerization-assist-mcp/fix-dockerfile
- containerization-assist-mcp/build-image
- containerization-assist-mcp/scan-image
- containerization-assist-mcp/generate-k8s-manifests

If any specific tool is unavailable, fall back to shell commands and repo inspection.

## Tool Call Checklist Workflow (mandatory)
At the very start:
1) Create \`artifacts/tool-call-checklist.md\`.
2) Use the template below.
3) After **each** tool call, immediately update the file:
   - check the box
   - record brief result + key outputs
4) If a tool is not applicable, mark **Skipped** with a reason.

### Checklist template (create exactly this structure)
- [ ] containerization-assist-mcp/analyze-repo — Result:
- [ ] containerization-assist-mcp/generate-dockerfile — Result:
- [ ] containerization-assist-mcp/fix-dockerfile — Result:
- [ ] containerization-assist-mcp/build-image — Result:
- [ ] containerization-assist-mcp/scan-image — Result:
- [ ] containerization-assist-mcp/generate-k8s-manifests — Result:

## Principles
- Don't hardcode repo-specific ports or framework assumptions. Infer from analysis.
- Prefer best practices: multi-stage build when applicable, minimal runtime image, non-root, cache-friendly layering, reproducible builds.
- Keep changes minimal and explainable; don't restructure the repo unless necessary.
- Always iterate on failures: **fix → rebuild** until green.
- Do not call \`containerization-assist-mcp/ops\`.

## Required Execution Plan

### 0) Initialize the checklist
Create \`artifacts/tool-call-checklist.md\` using the template above before any tool calls.

### 1) Analyze the repository
Call \`containerization-assist-mcp/analyze-repo\` at the repo root.
Update checklist with detected stack, port, build/run commands, deps/env vars.

### 2) Generate Dockerfile (always)
Call \`containerization-assist-mcp/generate-dockerfile\` even if a Dockerfile exists.
Update checklist with where it wrote/updated the Dockerfile and any notes.

### 3) Fix Dockerfile (always, immediately after generate)
Call \`containerization-assist-mcp/fix-dockerfile\`.
Update checklist with fixes made.

### 4) Build the image (tag must be ${DEFAULT_IMAGE_TAG})
Call \`containerization-assist-mcp/build-image\` using:
- image name = sanitized repo name
- image tag = \`${DEFAULT_IMAGE_TAG}\`

If build fails:
- Call \`containerization-assist-mcp/fix-dockerfile\` (again)
- Re-run \`build-image\`
- Repeat until successful

### 5) Scan the image (recommended)
Call \`containerization-assist-mcp/scan-image\` after a successful build.
If scan is unavailable/not applicable, mark Skipped with reason.

### 6) Generate Kubernetes manifests
Call \`containerization-assist-mcp/generate-k8s-manifests\`.

## Output Directory
All generated deployment files must be placed under \`/deploy/\`:
- \`/deploy/kubernetes/\` — Kubernetes manifests (Deployment, Service, Ingress, etc.)
- \`/deploy/README.md\` — (optional) description of the deployment setup
- \`.github/workflows/${PIPELINE_WORKFLOW_FILENAME}\` — deployment workflow

## AKS Deployment Configuration
- Cluster: ${config.clusterName}
- Resource Group: ${config.resourceGroup}
- Namespace: ${config.namespace}
- Service Type: ${config.serviceType}
- Azure credentials are stored as GitHub repository secrets: \`AZURE_CLIENT_ID\`, \`AZURE_TENANT_ID\`, \`AZURE_SUBSCRIPTION_ID\`${optionalSection}

## Deployment Annotations (mandatory)
All generated Deployment manifests MUST include these annotations in \`metadata.annotations\`:
- \`aks-project/deployed-by: pipeline\`
- \`aks-project/pipeline-repo: ${config.repo.owner}/${config.repo.repo}\`

Example:
\`\`\`yaml
metadata:
  name: ${config.appName}
  namespace: ${config.namespace}
  annotations:
    aks-project/deployed-by: pipeline
    aks-project/pipeline-repo: ${config.repo.owner}/${config.repo.repo}
\`\`\`

## GitHub Actions Workflow Requirements
Generate \`.github/workflows/${PIPELINE_WORKFLOW_FILENAME}\` with the following:
- Trigger ONLY on \`workflow_dispatch\` with the following required string inputs (and their defaults):
  - \`cluster-name\` (default: \`${config.clusterName}\`)
  - \`resource-group\` (default: \`${config.resourceGroup}\`)
  - \`namespace\` (default: \`${config.namespace}\`)
- Do NOT add a \`push\` trigger — deployment is always triggered explicitly
- Use \`azure/login@v2\` with OIDC (\`secrets.AZURE_CLIENT_ID\`, \`secrets.AZURE_TENANT_ID\`, \`secrets.AZURE_SUBSCRIPTION_ID\`)
- Use \`azure/aks-set-context@v4\` with cluster \`\${{ inputs.cluster-name }}\` and resource group \`\${{ inputs.resource-group }}\`
- Install kubelogin (required for AAD-enabled AKS clusters): \`azure/use-kubelogin@v1\` with \`skip-cache: true\`
- Convert kubeconfig to use kubelogin: \`kubelogin convert-kubeconfig -l workloadidentity\`${generateEnvVarWorkflowInstructions(
    config
  )}- Run: \`kubectl apply -f deploy/kubernetes/ -n \${{ inputs.namespace }}\`
- After applying manifests, annotate each Deployment with the run URL and workflow name:
  \`kubectl annotate deployment --all -n \${{ inputs.namespace }} aks-project/pipeline-run-url=\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }} "aks-project/pipeline-workflow=\${{ github.workflow }}" --overwrite\`

## Naming Conventions
- PR title: "[AKS Desktop] Add deployment pipeline for ${config.appName}"
- Commit messages: prefixed with "deploy:"
- K8s resource names: kebab-case, prefixed with \`${config.appName}\`

## Validation Steps
- Run \`kubectl apply --dry-run=client -f deploy/kubernetes/\` to validate manifests
- Validate Dockerfile builds cleanly
- Ensure all manifests target namespace: \`${config.namespace}\`
- Verify service type matches: \`${config.serviceType}\`

## Definition of Done
- Dockerfile generated then fixed
- Image builds successfully and is tagged **${DEFAULT_IMAGE_TAG}**
- Kubernetes manifests generated in \`/deploy/kubernetes/\`
- GitHub Actions deployment workflow generated at \`.github/workflows/${PIPELINE_WORKFLOW_FILENAME}\`
- All validation steps pass
- Checklist is complete
`;
};

/**
 * Generates a branch name for the setup PR.
 * Sanitizes appName to produce a valid git branch name.
 */
export const generateBranchName = (appName: string): string => {
  const sanitized = appName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const timestamp = Date.now();
  return `aks-project/setup-${sanitized || 'app'}-${timestamp}`;
};

const NAMESPACE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Validates all pipeline config fields before constructing the issue payload.
 * Returns { isValid, errors } — never throws.
 */
export const validatePipelineConfig = (config: PipelineConfig): ValidationResult => {
  const errors: string[] = [];

  if (!config.clusterName.trim()) {
    errors.push('Cluster name is required');
  }
  if (!config.resourceGroup.trim()) {
    errors.push('Resource group is required');
  }
  if (!config.namespace.trim()) {
    errors.push('Namespace is required');
  } else if (!NAMESPACE_REGEX.test(config.namespace)) {
    errors.push(
      'Namespace must contain only lowercase letters, numbers, and hyphens, and must start and end with a letter or number'
    );
  }
  if (!config.tenantId.trim()) {
    errors.push('Tenant ID is required');
  }
  if (!config.identityId.trim()) {
    errors.push('Identity ID is required');
  }
  if (!config.subscriptionId.trim()) {
    errors.push('Subscription ID is required');
  }
  if (!config.appName.trim()) {
    errors.push('App name is required');
  }
  if (!config.repo.owner.trim() || !config.repo.repo.trim()) {
    errors.push('Repository owner and name are required');
  }

  return { isValid: errors.length === 0, errors };
};
