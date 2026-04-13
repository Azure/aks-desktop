// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import YAML from 'yaml';
import { normalizeK8sName } from '../../../utils/kubernetes/k8sNames';
import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { getProbeConfigs, probeFieldName } from './probeHelpers';
import { escapeYamlValue } from './yamlUtils';

export interface WorkflowConfig {
  /** App name used for the ACR image name and the `CONTAINER_NAME` env var. Must be a valid DNS-1123 label. */
  appName: string;
  /** AKS cluster name, written to `CLUSTER_NAME` env var. */
  clusterName: string;
  /** Resource group containing the AKS cluster, written to `CLUSTER_RESOURCE_GROUP` env var. */
  resourceGroup: string;
  /** Kubernetes namespace for deployment and annotation steps. */
  namespace: string;
  /** Azure Container Registry name (without `.azurecr.io`), written to `AZURE_CONTAINER_REGISTRY`. */
  acrName: string;
  /** Path to the Dockerfile, relative to repo root (e.g., `./Dockerfile` or `./src/web/Dockerfile`). */
  dockerfilePath: string;
  /** Build context path passed to `az acr build` (e.g., `.` or `./src/web`). */
  buildContextPath: string;
  /** Default branch name used as the push trigger (e.g., `main`). */
  defaultBranch: string;
}

/**
 * Generates a deterministic deploy-to-aks.yml workflow.
 * Based on the proven aks-devhub workflow with all known bug fixes applied.
 */
export function generateDeployWorkflow(config: WorkflowConfig): string {
  const esc = escapeYamlValue;
  // Normalize to a valid DNS-1123 label so CONTAINER_NAME matches the K8s resource name
  // used in the generated manifests, preventing a silent mismatch during k8s-deploy image substitution.
  const appName = normalizeK8sName(config.appName);
  return `name: Deploy to AKS

on:
  push:
    branches: ["${esc(config.defaultBranch)}"]
  workflow_dispatch:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: false

env:
  AZURE_CONTAINER_REGISTRY: "${esc(config.acrName)}"
  CONTAINER_NAME: "${esc(appName)}"
  CLUSTER_NAME: "${esc(config.clusterName)}"
  CLUSTER_RESOURCE_GROUP: "${esc(config.resourceGroup)}"
  DEPLOYMENT_MANIFEST_PATH: ./deploy/kubernetes
  DOCKER_FILE: "${esc(config.dockerfilePath)}"
  BUILD_CONTEXT_PATH: "${esc(config.buildContextPath)}"
  NAMESPACE: "${esc(config.namespace)}"

jobs:
  buildImage:
    permissions:
      contents: read
      id-token: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1

      - name: Azure login
        uses: azure/login@eec3c95657c1536435858eda1f3ff5437fee8474 # v2.3.0
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build and push image to ACR
        run: |
          az acr build \\
            --registry "\${{ env.AZURE_CONTAINER_REGISTRY }}" \\
            -f "\${{ env.DOCKER_FILE }}" \\
            --image "\${{ env.CONTAINER_NAME }}:\${{ github.sha }}" \\
            "\${{ env.BUILD_CONTEXT_PATH }}"

  deploy:
    permissions:
      actions: read
      contents: read
      id-token: write
    runs-on: ubuntu-latest
    needs: [buildImage]
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1

      - name: Azure login
        uses: azure/login@eec3c95657c1536435858eda1f3ff5437fee8474 # v2.3.0
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Set up kubelogin
        uses: azure/use-kubelogin@0ce7c36141aa27d4934872cf00b0120804c98a29 # v1.3
        with:
          kubelogin-version: 'v0.1.6'

      - name: Get K8s context
        uses: azure/aks-set-context@c7eb093e5a5d47caa333f64974d5fd1cd4bf069d # v4.0.3
        with:
          resource-group: \${{ env.CLUSTER_RESOURCE_GROUP }}
          cluster-name: \${{ env.CLUSTER_NAME }}
          admin: 'false'
          use-kubelogin: 'true'

      - name: Deploy application
        uses: Azure/k8s-deploy@c8cfec839dc09896b3b8cc40cd13d04792680771 # v5.1.0
        with:
          action: deploy
          manifests: \${{ env.DEPLOYMENT_MANIFEST_PATH }}
          images: |
            \${{ env.AZURE_CONTAINER_REGISTRY }}.azurecr.io/\${{ env.CONTAINER_NAME }}:\${{ github.sha }}
          namespace: \${{ env.NAMESPACE }}

      - name: Annotate namespace
        continue-on-error: true
        run: |
          kubectl annotate namespace "\${{ env.NAMESPACE }}" \\
            "aks-project/pipeline-repo=\${{ github.repository }}" \\
            --overwrite

      - name: Annotate deployment
        continue-on-error: true
        run: |
          kubectl annotate deployment "\${{ env.CONTAINER_NAME }}" \\
            -n "\${{ env.NAMESPACE }}" \\
            aks-project/pipeline-run-url=\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }} \\
            "aks-project/pipeline-workflow=\${{ github.workflow }}" \\
            --overwrite
`;
}

export interface ManifestConfig {
  /** App name used as the K8s resource name (Deployment, Service, container) and selector label. Must be a valid DNS-1123 label. */
  appName: string;
  /** Kubernetes namespace for the generated Deployment and Service manifests. */
  namespace: string;
  /** Azure Container Registry name (without `.azurecr.io`) used to construct the container image reference. */
  acrName: string;
  /** GitHub repository owner and name, used in the `aks-project/pipeline-repo` annotation. */
  repo: { owner: string; name: string };
}

/**
 * Generates a Kubernetes Deployment manifest from container config.
 * Builds a plain JS object and serializes via YAML.stringify for correct
 * indentation and escaping.
 *
 * Note: This generator is intentionally separate from `DeployWizard/utils/yamlGenerator.ts`.
 * The two generators differ in annotation strategy (`deployed-by: pipeline` vs `manual`),
 * output format (single manifest vs multi-doc with Secret/SA/HPA), and caller context
 * (pipeline-generated file vs wizard UI). Shared logic (`normalizeK8sName`, `getProbeConfigs`)
 * is imported from shared utilities rather than duplicated.
 */
export function generateDeploymentManifest(config: ManifestConfig, cc: ContainerConfig): string {
  // Normalize to a valid DNS-1123 label so the manifest is accepted by Kubernetes even if
  // the caller passes an app name with uppercase, underscores, or other invalid characters.
  const appName = normalizeK8sName(config.appName);

  const container: Record<string, unknown> = {
    name: appName,
    // Note: Azure/k8s-deploy@v5 substitutes this with the actual built image+SHA at deploy time.
    // The ':latest' here is a placeholder that will be replaced by the workflow's build SHA.
    image: `${config.acrName}.azurecr.io/${appName}:latest`,
    ports: [{ containerPort: cc.targetPort }],
  };

  if (cc.enableResources) {
    container.resources = {
      requests: { cpu: cc.cpuRequest, memory: cc.memoryRequest },
      limits: { cpu: cc.cpuLimit, memory: cc.memoryLimit },
    };
  }

  for (const probe of getProbeConfigs(cc).filter(p => p.enabled)) {
    const probeSpec: Record<string, unknown> = {
      httpGet: { path: probe.path, port: cc.targetPort },
      initialDelaySeconds: probe.initialDelay,
      periodSeconds: probe.period,
      timeoutSeconds: probe.timeout,
      failureThreshold: probe.failure,
    };
    // Kubernetes requires successThreshold === 1 for liveness and startup probes (K8s API constraint).
    // Only readiness probes may have successThreshold > 1, so we only emit the field for readiness.
    if (probe.name === 'Readiness') {
      probeSpec.successThreshold = probe.success;
    }
    container[probeFieldName(probe.name)] = probeSpec;
  }

  // Security context: always-on hardening defaults (capabilities drop ALL, seccomp RuntimeDefault).
  const securityContext: Record<string, unknown> = {
    capabilities: { drop: ['ALL'] },
    seccompProfile: { type: 'RuntimeDefault' },
  };
  if (!cc.allowPrivilegeEscalation) securityContext.allowPrivilegeEscalation = false;
  if (cc.runAsNonRoot) securityContext.runAsNonRoot = true;
  if (cc.readOnlyRootFilesystem) securityContext.readOnlyRootFilesystem = true;
  container.securityContext = securityContext;

  const podSpec: Record<string, unknown> = {};

  if (cc.enablePodAntiAffinity) {
    podSpec.affinity = {
      podAntiAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 100,
            podAffinityTerm: {
              labelSelector: { matchLabels: { app: appName } },
              topologyKey: 'kubernetes.io/hostname',
            },
          },
        ],
      },
    };
  }

  if (cc.enableTopologySpreadConstraints) {
    podSpec.topologySpreadConstraints = [
      {
        maxSkew: 1,
        topologyKey: 'kubernetes.io/hostname',
        whenUnsatisfiable: 'ScheduleAnyway',
        labelSelector: { matchLabels: { app: appName } },
      },
    ];
  }

  podSpec.containers = [container];

  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: appName,
      namespace: config.namespace,
      annotations: {
        'aks-project/deployed-by': 'pipeline',
        'aks-project/pipeline-repo': `${config.repo.owner}/${config.repo.name}`,
      },
    },
    spec: {
      replicas: cc.replicas,
      selector: { matchLabels: { app: appName } },
      template: {
        metadata: { labels: { app: appName } },
        spec: podSpec,
      },
    },
  };

  return YAML.stringify(deployment, { lineWidth: 0 });
}

/**
 * Generates a Kubernetes Service manifest from container config.
 * Builds a plain JS object and serializes via YAML.stringify.
 */
export function generateServiceManifest(config: ManifestConfig, cc: ContainerConfig): string {
  const servicePort = cc.useCustomServicePort ? cc.servicePort : cc.targetPort;
  const appName = normalizeK8sName(config.appName);

  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: appName,
      namespace: config.namespace,
    },
    spec: {
      type: cc.serviceType,
      ports: [
        {
          port: servicePort,
          targetPort: cc.targetPort,
          protocol: 'TCP',
        },
      ],
      selector: { app: appName },
    },
  };

  return YAML.stringify(service, { lineWidth: 0 });
}
