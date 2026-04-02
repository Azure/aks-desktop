// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { ContainerConfig } from '../../DeployWizard/hooks/useContainerConfiguration';
import { getProbeConfigs } from './probeHelpers';

export interface WorkflowConfig {
  appName: string;
  clusterName: string;
  resourceGroup: string;
  namespace: string;
  acrName: string;
  dockerfilePath: string;
  buildContextPath: string;
  defaultBranch: string;
}

/**
 * Generates a deterministic deploy-to-aks.yml workflow.
 * Based on the proven aks-devhub workflow with all known bug fixes applied.
 */
export function generateDeployWorkflow(config: WorkflowConfig): string {
  return `name: Deploy to AKS

on:
  push:
    branches: [${config.defaultBranch}]
  workflow_dispatch:

env:
  ACR_RESOURCE_GROUP: ${config.resourceGroup}
  AZURE_CONTAINER_REGISTRY: ${config.acrName}
  CONTAINER_NAME: ${config.appName}
  CLUSTER_NAME: ${config.clusterName}
  CLUSTER_RESOURCE_GROUP: ${config.resourceGroup}
  DEPLOYMENT_MANIFEST_PATH: ./deploy/kubernetes
  DOCKER_FILE: ${config.dockerfilePath}
  BUILD_CONTEXT_PATH: ${config.buildContextPath}
  NAMESPACE: ${config.namespace}

jobs:
  buildImage:
    permissions:
      contents: read
      id-token: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Azure login
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build and push image to ACR
        run: |
          az acr build \\
            --registry \${{ env.AZURE_CONTAINER_REGISTRY }} \\
            -g \${{ env.ACR_RESOURCE_GROUP }} \\
            -f \${{ env.DOCKER_FILE }} \\
            --image \${{ env.CONTAINER_NAME }}:\${{ github.sha }} \\
            \${{ env.BUILD_CONTEXT_PATH }}

  deploy:
    permissions:
      actions: read
      contents: read
      id-token: write
    runs-on: ubuntu-latest
    needs: [buildImage]
    steps:
      - uses: actions/checkout@v4

      - name: Azure login
        uses: azure/login@v2
        with:
          client-id: \${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: \${{ secrets.AZURE_TENANT_ID }}
          subscription-id: \${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Set up kubelogin
        uses: azure/use-kubelogin@v1
        with:
          kubelogin-version: 'v0.1.6'

      - name: Get K8s context
        uses: azure/aks-set-context@v4
        with:
          resource-group: \${{ env.CLUSTER_RESOURCE_GROUP }}
          cluster-name: \${{ env.CLUSTER_NAME }}
          admin: 'false'
          use-kubelogin: 'true'

      - name: Deploy application
        uses: Azure/k8s-deploy@v5
        with:
          action: deploy
          manifests: \${{ env.DEPLOYMENT_MANIFEST_PATH }}
          images: |
            \${{ env.AZURE_CONTAINER_REGISTRY }}.azurecr.io/\${{ env.CONTAINER_NAME }}:\${{ github.sha }}
          namespace: \${{ env.NAMESPACE }}

      - name: Annotate namespace
        continue-on-error: true
        run: |
          kubectl annotate namespace \${{ env.NAMESPACE }} \\
            aks-project/pipeline-repo=\${{ github.repository }} \\
            --overwrite

      - name: Annotate deployment
        continue-on-error: true
        run: |
          kubectl annotate deployment --all \\
            -n \${{ env.NAMESPACE }} \\
            aks-project/pipeline-run-url=\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }} \\
            "aks-project/pipeline-workflow=\${{ github.workflow }}" \\
            --overwrite
`;
}

export interface ManifestConfig {
  appName: string;
  namespace: string;
  acrName: string;
  repoOwner: string;
  repoName: string;
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(line => (line.trim() ? pad + line : line))
    .join('\n');
}

function generateProbeYaml(
  type: string,
  path: string,
  port: number,
  initialDelay: number,
  period: number,
  timeout: number,
  failure: number,
  success: number
): string {
  return `${type}:
          httpGet:
            path: ${path}
            port: ${port}
          initialDelaySeconds: ${initialDelay}
          periodSeconds: ${period}
          timeoutSeconds: ${timeout}
          failureThreshold: ${failure}
          successThreshold: ${success}`;
}

/**
 * Generates a Kubernetes Deployment manifest from container config.
 */
export function generateDeploymentManifest(config: ManifestConfig, cc: ContainerConfig): string {
  const probes = getProbeConfigs(cc)
    .filter(p => p.enabled)
    .map(p => {
      const tag = p.name.charAt(0).toLowerCase() + p.name.slice(1) + 'Probe';
      return generateProbeYaml(
        tag,
        p.path,
        cc.targetPort,
        p.initialDelay,
        p.period,
        p.timeout,
        p.failure,
        p.success
      );
    });

  const probesBlock = probes.length > 0 ? '\n' + indent(probes.join('\n'), 8) : '';

  const resourcesBlock = cc.enableResources
    ? `
        resources:
          requests:
            cpu: ${cc.cpuRequest}
            memory: ${cc.memoryRequest}
          limits:
            cpu: ${cc.cpuLimit}
            memory: ${cc.memoryLimit}`
    : '';

  const securityLines: string[] = [];
  if (cc.allowPrivilegeEscalation === false) securityLines.push('allowPrivilegeEscalation: false');
  if (cc.runAsNonRoot) securityLines.push('runAsNonRoot: true');
  if (cc.readOnlyRootFilesystem) securityLines.push('readOnlyRootFilesystem: true');
  const securityBlock =
    securityLines.length > 0
      ? `\n        securityContext:\n${securityLines.map(l => `          ${l}`).join('\n')}`
      : '';

  const antiAffinityBlock = cc.enablePodAntiAffinity
    ? `
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: ${config.appName}
              topologyKey: kubernetes.io/hostname`
    : '';

  const topologyBlock = cc.enableTopologySpreadConstraints
    ? `
      topologySpreadConstraints:
      - maxSkew: 1
        topologyKey: kubernetes.io/hostname
        whenUnsatisfiable: ScheduleAnyway
        labelSelector:
          matchLabels:
            app: ${config.appName}`
    : '';

  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${config.appName}
  namespace: ${config.namespace}
  annotations:
    aks-project/deployed-by: pipeline
    aks-project/pipeline-repo: ${config.repoOwner}/${config.repoName}
spec:
  replicas: ${cc.replicas}
  selector:
    matchLabels:
      app: ${config.appName}
  template:
    metadata:
      labels:
        app: ${config.appName}
    spec:${antiAffinityBlock}${topologyBlock}
      containers:
      - name: ${config.appName}
        image: ${config.acrName}.azurecr.io/${config.appName}:latest
        ports:
        - containerPort: ${cc.targetPort}${resourcesBlock}${probesBlock}${securityBlock}
`;
}

/**
 * Generates a Kubernetes Service manifest from container config.
 */
export function generateServiceManifest(config: ManifestConfig, cc: ContainerConfig): string {
  const servicePort = cc.useCustomServicePort ? cc.servicePort : cc.targetPort;
  return `apiVersion: v1
kind: Service
metadata:
  name: ${config.appName}
  namespace: ${config.namespace}
spec:
  type: ${cc.serviceType}
  ports:
  - port: ${servicePort}
    targetPort: ${cc.targetPort}
    protocol: TCP
  selector:
    app: ${config.appName}
`;
}
