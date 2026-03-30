// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

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
