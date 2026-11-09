// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import YAML from 'yaml';
import { createOrUpdateFile } from '../../../utils/github/github-api';
import { normalizeK8sName } from '../../../utils/kubernetes/k8sNames';
import { getServiceAccountName } from '../../../utils/kubernetes/serviceAccountNames';
import {
  AGENT_CONFIG_PATH,
  CONTAINERIZATION_MCP_VERSION,
  COPILOT_SETUP_STEPS_PATH,
  DEFAULT_IMAGE_TAG,
  KUBELOGIN_VERSION,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
import type { PipelineConfig } from '../types';
import { generateAcrBuildSteps } from './acrBuildSteps';
import { ACR_BUILD_SCRIPT_PATH, ACR_TASKS_API_VERSION } from './acrTasks/acrTaskRunner';
import { deriveAcrName } from './deriveAcrName';
import { toEnvSecretName } from './pipelineOrchestration';
import { getProbeConfigs, renderProbeMarkdown } from './probeHelpers';
import { publishAcrBuildFiles } from './publishAcrBuildFiles';

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
const generateWorkloadIdentityWorkflowInstructions = (config: PipelineConfig): string => {
  const cc = config.containerConfig;
  if (!cc?.enableWorkloadIdentity || !cc.workloadIdentityClientId) return '';

  const saName = cc.workloadIdentityServiceAccount || getServiceAccountName(config.appName);

  return `
- Before applying manifests, create a Kubernetes ServiceAccount for workload identity:
  \`\`\`bash
  kubectl apply -f - <<EOF
  apiVersion: v1
  kind: ServiceAccount
  metadata:
    name: ${saName}
    namespace: \${{ inputs.namespace }}
    annotations:
      azure.workload.identity/client-id: "${cc.workloadIdentityClientId}"
  EOF
  \`\`\`
- In the Deployment manifest, set \`spec.template.metadata.labels["azure.workload.identity/use"]: "true"\` and \`spec.template.spec.serviceAccountName: ${saName}\`
`;
};

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
 * Renders the shared build/cancel steps and registry-scoping requirements for the agent.
 *
 * @param config Deployment settings, including the selected registry and non-secret build arguments.
 * @returns Markdown instructions, or an empty string when no registry is configured.
 */
const generateAcrWorkflowInstructions = (config: PipelineConfig): string => {
  if (!config.acrLoginServer && !config.acrResourceId) return '';

  const containerName = normalizeK8sName(config.appName);
  const loginServer = config.acrLoginServer || `${deriveAcrName(config)}.azurecr.io`;
  const steps = YAML.stringify(
    {
      steps: generateAcrBuildSteps({
        acrName: '${{ secrets.AZURE_ACR_NAME }}',
        acrResourceId: config.acrResourceId ? '${{ secrets.AZURE_ACR_RESOURCE_ID }}' : undefined,
        containerName,
        dockerfilePath: './Dockerfile',
        buildContextPath: '.',
        buildArguments: config.buildArguments,
      }),
    },
    { lineWidth: 0 }
  );

  return `
- Build/push with the committed Python 3 standard-library helper \`${ACR_BUILD_SCRIPT_PATH}\`; do not replace or duplicate its implementation in the workflow. Hosted Ubuntu already provides Python 3; no package downloads are needed.
- After checkout and \`azure/login@v2\`, insert these exact shared build/cancel steps into \`buildImage\`. Adjust only \`DOCKER_FILE\` and \`BUILD_CONTEXT_PATH\` to the repository's Dockerfile and context:
  \`\`\`yaml
${steps
  .trimEnd()
  .split('\n')
  .map(line => `  ${line}`)
  .join('\n')}
  \`\`\`
- The helper uses the existing Azure login: \`az account get-access-token\` obtains an ARM token only. ${
    config.acrResourceId
      ? 'Registry scope comes from `secrets.AZURE_ACR_RESOURCE_ID` for this ID-backed configuration.'
      : 'This name-only configuration explicitly leaves `AZURE_ACR_RESOURCE_ID` empty and uses ARM discovery in `secrets.AZURE_SUBSCRIPTION_ID`. Do not fall back to a retained registry-ID secret from an earlier configuration.'
  } Never assume the registry belongs to the AKS resource group.
- Preserve the complete ACR Tasks REST sequence with \`api-version=${ACR_TASKS_API_VERSION}\`: POST \`listBuildSourceUploadUrl\`, PUT the local context archive to its upload SAS URL, POST \`scheduleRun\` with a \`DockerBuildRequest\`, poll GET \`/runs/{runId}\` to a terminal state, POST \`/runs/{runId}/listLogSasUrl\`, and download/print the build log. Only \`Succeeded\` is success; failed, canceled, error, timeout, and polling/log failures must fail the build.
- Preserve SIGINT/SIGTERM handling and the cleanup step: POST \`/runs/{runId}/cancel\` for unfinished builds using persisted \`RUNNER_TEMP\` state. Missing state is a no-op; cancellation errors must remain visible failures, never use \`continue-on-error\` or suppress them. Keep \`exec python3\` so runner signals reach the helper.
- Deploy image \`${loginServer}/${containerName}:\${{ github.sha }}\`; keep the deploy job gated on a successful \`buildImage\`.
- Queue rather than cancel deployments: concurrency group \`\${{ github.workflow }}-\${{ github.ref }}\`, \`cancel-in-progress: false\`.
`;
};

/**
 * Generates the `.github/agents/containerization.agent.md` file,
 * parameterized with the user's AKS deployment config.
 *
 * Based on the reference implementation at
 * https://github.com/ReinierCC/spring-petclinic/blob/main/.github/agents/containerization.agent.md
 * with an appended AKS-specific deployment section.
 *
 * @param config Deployment settings used to specialize the agent's instructions.
 * @returns Agent configuration Markdown, including shared ACR runtime instructions when configured.
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
    if (cc.enableWorkloadIdentity && cc.workloadIdentityClientId) {
      const saName = cc.workloadIdentityServiceAccount || getServiceAccountName(config.appName);
      optionalLines.push(
        `- Workload Identity: enabled (service account: ${saName}, client ID: ${cc.workloadIdentityClientId})`
      );
    }
  }

  const optionalSection = optionalLines.length > 0 ? '\n' + optionalLines.join('\n') : '';

  return `---
name: containerize-and-deploy
description: "Analyze repository, generate a best-practice Dockerfile, Kubernetes manifests, and a GitHub Actions deployment workflow for AKS."
---

## Role
Containerization-focused coding agent. Take this repository and:
1) Make it run correctly in a container (Dockerfile + buildable image, tag = \`${DEFAULT_IMAGE_TAG}\`).
2) Generate Kubernetes manifests for AKS in \`/deploy/kubernetes/\`.
3) Generate a GitHub Actions deployment workflow at \`.github/workflows/${PIPELINE_WORKFLOW_FILENAME}\`.

## Principles
- Infer ports/frameworks from analysis — do not hardcode.
- Best practices: multi-stage build when applicable, minimal runtime image, non-root, cache-friendly layering.
- Keep changes minimal; don't restructure the repo unless necessary.
- **Do not echo large tool outputs back into prompts or the checklist.** Reference files by path and write a one-line summary (≤120 chars). This applies especially to \`analyze-repo\`, \`generate-k8s-manifests\`, and build logs.
- Do not call \`containerization-assist-mcp/ops\`.

## Execution Plan
Use \`containerization-assist-mcp\` tools when available; otherwise fall back to shell.

1. \`containerization-assist-mcp/analyze-repo\` — at repo root.
2. \`containerization-assist-mcp/generate-dockerfile\` — always, even if one exists.
3. \`containerization-assist-mcp/fix-dockerfile\` — immediately after generate.
4. \`containerization-assist-mcp/build-image\` — image name = sanitized repo name, tag = \`${DEFAULT_IMAGE_TAG}\`.
   On failure: retry up to **2 more times** (\`fix-dockerfile\` → \`build-image\`).
   If still failing after 3 total attempts, record the last error on the Step 4 (\`build-image\`) checklist line (≤120 chars) and continue to step 5 — the PR can still be reviewed by a human.
5. \`containerization-assist-mcp/scan-image\` — after a successful build. Mark Skipped (with reason) if unavailable or build did not succeed.
6. \`containerization-assist-mcp/generate-k8s-manifests\` — write to \`/deploy/kubernetes/\`.

## Checklist
Maintain \`artifacts/tool-call-checklist.md\`. Update **once per numbered step above** (not per tool call). Each entry: one line, ≤120 chars. Mark Skipped with a reason where applicable.

Template:
- [ ] 1. analyze-repo — Result:
- [ ] 2. generate-dockerfile — Result:
- [ ] 3. fix-dockerfile — Result:
- [ ] 4. build-image — Result:
- [ ] 5. scan-image — Result:
- [ ] 6. generate-k8s-manifests — Result:

## AKS Deployment Configuration
- Cluster: ${config.clusterName}
- Resource Group: ${config.resourceGroup}
- Namespace: ${config.namespace}
- Service Type: ${config.serviceType}
- Azure credentials stored as GitHub repository secrets: \`AZURE_CLIENT_ID\`, \`AZURE_TENANT_ID\`, \`AZURE_SUBSCRIPTION_ID\`${
    config.acrLoginServer || config.acrResourceId
      ? `\n- Container Registry: \`${
          config.acrLoginServer || `${deriveAcrName(config)}.azurecr.io`
        }\` (ACR name stored as secret \`AZURE_ACR_NAME\`; registry resource ID, when configured, stored as secret \`AZURE_ACR_RESOURCE_ID\`)`
      : ''
  }${optionalSection}

## Deployment Annotations (mandatory)
All generated Deployment manifests MUST include these annotations in \`metadata.annotations\`:
- \`aks-project/deployed-by: pipeline\`
- \`aks-project/pipeline-repo: ${config.repo.owner}/${config.repo.repo}\`

## GitHub Actions Workflow Requirements
Generate \`.github/workflows/${PIPELINE_WORKFLOW_FILENAME}\`:
- Trigger ONLY on \`workflow_dispatch\` with required string inputs:
  - \`cluster-name\` (default: \`${config.clusterName}\`)
  - \`resource-group\` (default: \`${config.resourceGroup}\`)
  - \`namespace\` (default: \`${config.namespace}\`)
- No \`push\` trigger.
- Two jobs: \`buildImage\` (build + push to ACR) and \`deploy\` (apply manifests) with \`needs: [buildImage]\`. The \`deploy\` job permissions block MUST include \`actions: read\`.
- Use \`azure/login@v2\` with OIDC (\`secrets.AZURE_CLIENT_ID\`, \`secrets.AZURE_TENANT_ID\`, \`secrets.AZURE_SUBSCRIPTION_ID\`).
- Use \`azure/aks-set-context@v4\` with \`\${{ inputs.cluster-name }}\` and \`\${{ inputs.resource-group }}\`.
- Install kubelogin via \`azure/use-kubelogin@v1\` with \`kubelogin-version: '${KUBELOGIN_VERSION}'\`, then \`kubelogin convert-kubeconfig -l workloadidentity\`.${generateAcrWorkflowInstructions(
    config
  )}${generateEnvVarWorkflowInstructions(config)}${generateWorkloadIdentityWorkflowInstructions(
    config
  )}- Apply manifests: \`kubectl apply -f deploy/kubernetes/ -n \${{ inputs.namespace }}\`
- After apply, annotate each Deployment with the run URL and workflow name:
  \`kubectl annotate deployment --all -n \${{ inputs.namespace }} aks-project/pipeline-run-url=\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }} "aks-project/pipeline-workflow=\${{ github.workflow }}" --overwrite\`

## Naming Conventions
- PR title: "[AKS Desktop] Add deployment pipeline for ${config.appName}"
- Commit messages prefixed with "deploy:"
- K8s resource names: kebab-case, prefixed with \`${config.appName}\`

## Validation
- \`kubectl apply --dry-run=client -f deploy/kubernetes/\` succeeds.
- All manifests target namespace \`${config.namespace}\` and service type \`${config.serviceType}\`.
`;
};

/**
 * Pushes agent config and, when a registry is configured, its exact ACR runtime bundle.
 * Also owns runtime publication for the fast-path async review to avoid duplicate writes.
 * Parallel writes are not atomic and are not rolled back on failure.
 *
 * @param octokit Authenticated client with repository contents write access.
 * @param owner GitHub repository owner.
 * @param repo GitHub repository name.
 * @param branchName Existing branch receiving the setup workflow, agent config and optional runtime.
 * @param config Deployment settings used to generate the agent config and select runtime publication.
 * @returns Resolves when all requested files have been published.
 * @throws If generation or any GitHub read/write fails; other writes may already have completed.
 */
export async function pushAgentConfigFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  config: PipelineConfig
): Promise<void> {
  const agentConfig = generateAgentConfig(config);
  await Promise.all([
    createOrUpdateFile(
      octokit,
      owner,
      repo,
      COPILOT_SETUP_STEPS_PATH,
      SETUP_WORKFLOW_CONTENT,
      'Add Copilot setup workflow',
      branchName
    ),
    ...(config.acrLoginServer || config.acrResourceId
      ? [publishAcrBuildFiles(octokit, owner, repo, branchName)]
      : []),
    createOrUpdateFile(
      octokit,
      owner,
      repo,
      AGENT_CONFIG_PATH,
      agentConfig,
      `Add containerization agent config for ${config.appName}`,
      branchName
    ),
  ]);
}

/**
 * Sanitizes an app name into a branch-name-safe slug: lowercases, replaces any
 * non-`[a-z0-9-]` character with `-`, collapses repeated dashes, and trims leading/trailing
 * dashes. Returns `'app'` if the input collapses to an empty string.
 *
 * Shared by both the agent-path setup branch and fast-path deploy branch so there is a
 * single definition of "what makes appName safe in a git ref".
 */
export function sanitizeAppNameForBranch(appName: string): string {
  return (
    appName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'app'
  );
}

/**
 * Generates a branch name for the setup PR.
 * Sanitizes appName via {@link sanitizeAppNameForBranch} to produce a valid git branch name.
 */
export const generateBranchName = (appName: string): string =>
  `aks-project/setup-${sanitizeAppNameForBranch(appName)}-${Date.now()}`;

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
