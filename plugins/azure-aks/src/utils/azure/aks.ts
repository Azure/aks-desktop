// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ContainerServiceClient } from '@azure/arm-containerservice';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { setCluster } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { getStatelessClusterKubeConfigs } from '@kinvolk/headlamp-plugin/lib/stateless';
import { auth } from '@kinvolk/headlamp-plugin/lib/Utils';
import YAML from 'yaml';
import { getLoginStatus } from '../../azureAuth';
import { azureCredential } from '../../azureAuth';

const AKS_SERVER_ID = '6dae42f8-4368-4678-94ff-3960e28e3630';

export interface Subscription {
  id: string;
  name: string;
  state: string;
  tenantId: string;
  tenantName: string;
  isDefault: boolean;
}

export interface AKSCluster {
  name: string;
  resourceGroup: string;
  location: string;
  kubernetesVersion: string;
  provisioningState: string;
  fqdn: string;
  isAzureRBACEnabled: boolean;
}

export async function getSubscriptions(): Promise<{
  success: boolean;
  message: string;
  subscriptions?: Subscription[];
}> {
  try {
    const client = new SubscriptionClient(azureCredential);
    const subscriptions: Subscription[] = [];

    for await (const subscription of client.subscriptions.list()) {
      if (!subscription.subscriptionId) continue;
      subscriptions.push({
        id: subscription.subscriptionId,
        name: subscription.displayName || subscription.subscriptionId,
        state: subscription.state || 'Unknown',
        tenantId: subscription.tenantId || '',
        tenantName: subscription.tenantId || '',
        isDefault: false,
      });
    }

    return { success: true, message: 'Subscriptions retrieved successfully', subscriptions };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getAKSClusters(subscriptionId: string): Promise<{
  success: boolean;
  message: string;
  clusters?: AKSCluster[];
}> {
  try {
    const client = new ContainerServiceClient(azureCredential, subscriptionId);
    const clusters: AKSCluster[] = [];

    for await (const cluster of client.managedClusters.list()) {
      if (!cluster.name) continue;
      clusters.push({
        name: cluster.name,
        resourceGroup: cluster.id?.match(/resourceGroups\/([^/]+)/i)?.[1] || '',
        location: cluster.location || '',
        kubernetesVersion: cluster.kubernetesVersion || '',
        provisioningState: cluster.provisioningState || '',
        fqdn: cluster.fqdn || '',
        isAzureRBACEnabled: cluster.aadProfile?.enableAzureRbac === true,
      });
    }

    return { success: true, message: 'AKS clusters retrieved successfully', clusters };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function refreshClusterTokens(): Promise<void> {
  try {
    const login = await getLoginStatus();
    if (!login.isLoggedIn) return;

    const kubeconfigs = await getStatelessClusterKubeConfigs();
    if (!kubeconfigs?.length) return;

    const credential = azureCredential;
    const token = await credential.getToken(`${AKS_SERVER_ID}/.default`);
    if (!token.token) return;

    for (const encodedKubeconfig of kubeconfigs) {
      try {
        const kubeconfig = YAML.parse(atob(encodedKubeconfig));
        const isAKSCluster = kubeconfig.extensions?.some((item: any) => item.name === 'aks_info');
        if (!isAKSCluster) continue;

        const clusterName = kubeconfig.contexts?.[0]?.name;
        if (clusterName) auth.setToken(clusterName, token.token);
      } catch (error) {
        console.error('[AKS] Error updating cluster token:', error);
      }
    }
  } catch (error) {
    console.error('[AKS] Error refreshing AKS cluster tokens:', error);
  }
}

export async function registerAKSCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  managedNamespace?: string,
  _tenantId?: string
): Promise<{ success: boolean; message: string }> {
  void _tenantId;
  try {
    const credential = azureCredential;
    const client = new ContainerServiceClient(credential, subscriptionId);
    const credentials = managedNamespace
      ? await client.managedNamespaces.listCredential(resourceGroup, clusterName, managedNamespace)
      : await client.managedClusters.listClusterUserCredentials(resourceGroup, clusterName);
    const kubeconfigData = credentials.kubeconfigs?.[0]?.value;
    if (!kubeconfigData) {
      return { success: false, message: 'No kubeconfig data returned from Azure' };
    }

    const kubeconfig = YAML.parse(Buffer.from(kubeconfigData).toString('utf-8'));
    const token = await credential.getToken(`${AKS_SERVER_ID}/.default`);

    for (const user of kubeconfig.users || []) {
      if (user.user?.exec) delete user.user.exec;
    }

    const aksExtension = {
      name: 'aks_info',
      extension: { subscriptionId, resourceGroup, clusterName },
    };
    kubeconfig.extensions = kubeconfig.extensions || [];
    const extensionIndex = kubeconfig.extensions.findIndex((item: any) => item.name === 'aks_info');
    if (extensionIndex >= 0) kubeconfig.extensions[extensionIndex] = aksExtension;
    else kubeconfig.extensions.push(aksExtension);

    const encodedKubeconfig = Buffer.from(YAML.stringify(kubeconfig)).toString('base64');
    await setCluster({ kubeconfig: encodedKubeconfig });
    auth.setToken(clusterName, token.token);

    return { success: true, message: `Cluster context '${clusterName}' is now available.` };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
