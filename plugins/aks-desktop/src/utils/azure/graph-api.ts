// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
// Azure Graph API utility functions for reading Azure resources
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { QueryRequest } from '@azure/arm-resourcegraph/esm/models/index';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { AzureCliCredential } from '@azure/identity';
import { AzureCluster, AzureResourceGroup, AzureSubscription, AzureTenant } from './client';

// Initialize clients with Azure CLI credentials
const getResourceGraphClient = () => {
  const credential = new AzureCliCredential();
  return new ResourceGraphClient(credential);
};

const getSubscriptionClient = () => {
  const credential = new AzureCliCredential();
  return new SubscriptionClient(credential);
};

// Generic function to run Resource Graph queries
const runQuery = async (subscriptionIds: string[], queryText: string) => {
  const client = getResourceGraphClient();
  const query: QueryRequest = {
    subscriptions: subscriptionIds,
    query: queryText,
  };

  try {
    const result = await client.resources(query);
    return result.data;
  } catch (error) {
    console.error('Graph API query failed:', error);
    throw new Error(
      `Graph API query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

// Get all subscriptions using Azure Management API
export async function getSubscriptionsFromGraphAPI(): Promise<AzureSubscription[]> {
  const client = getSubscriptionClient();
  const subscriptions: AzureSubscription[] = [];

  try {
    for await (const subscription of client.subscriptions.list()) {
      if (subscription.subscriptionId && subscription.displayName) {
        subscriptions.push({
          id: subscription.subscriptionId,
          name: subscription.displayName,
          tenant: subscription.tenantId || '',
          status: subscription.state || 'Unknown',
        });
      }
    }
    return subscriptions;
  } catch (error) {
    console.error('Failed to get subscriptions from Graph API:', error);
    throw new Error(
      `Failed to get subscriptions: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get all tenants using Azure Management API
export async function getTenantsFromGraphAPI(): Promise<AzureTenant[]> {
  const client = getSubscriptionClient();
  const tenants: AzureTenant[] = [];

  try {
    for await (const tenant of client.tenants.list()) {
      if (tenant.tenantId) {
        tenants.push({
          id: tenant.tenantId,
          name: tenant.displayName || tenant.tenantId,
          domain: tenant.defaultDomain || tenant.tenantId,
          status: 'Active',
        });
      }
    }
    return tenants;
  } catch (error) {
    console.error('Failed to get tenants from Graph API:', error);
    throw new Error(
      `Failed to get tenants: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get resource groups for a subscription
export async function getResourceGroupsFromGraphAPI(
  subscriptionId: string
): Promise<AzureResourceGroup[]> {
  const query = `
    ResourceContainers
    | where type == "microsoft.resources/resourcegroups"
    | where subscriptionId == "${subscriptionId}"
    | project id, name, location, subscriptionId
  `;

  try {
    const result = await runQuery([subscriptionId], query);
    return result.map((rg: any) => ({
      id: rg.id,
      name: rg.name,
      location: rg.location,
      subscriptionId: rg.subscriptionId,
    }));
  } catch (error) {
    console.error('Failed to get resource groups from Graph API:', error);
    throw new Error(
      `Failed to get resource groups: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get AKS clusters with detailed information
export async function getClustersFromGraphAPI(subscriptionId?: string): Promise<AzureCluster[]> {
  const subscriptionIds = subscriptionId ? [subscriptionId] : [];

  // If no subscription ID provided, get all subscriptions
  let targetSubscriptions = subscriptionIds;
  if (!subscriptionId) {
    const subscriptions = await getSubscriptionsFromGraphAPI();
    targetSubscriptions = subscriptions.map(sub => sub.id);
  }

  const query = `
    Resources
    | where type =~ "Microsoft.ContainerService/managedClusters"
    | extend nodeCount = toint(properties.agentPoolProfiles[0].count)
    | extend vmSize = tostring(properties.agentPoolProfiles[0].vmSize)
    | extend kubernetesVersion = tostring(properties.kubernetesVersion)
    | extend provisioningState = tostring(properties.provisioningState)
    | extend powerState = tostring(properties.powerState.code)
    | extend actualStatus = case(
        powerState == "Running", "Running",
        powerState == "Stopped", "Stopped",
        powerState == "Starting", "Starting",
        powerState == "Stopping", "Stopping",
        provisioningState == "Succeeded", "Running",
        provisioningState == "Failed", "Failed",
        provisioningState == "Updating", "Updating",
        provisioningState == "Creating", "Creating",
        provisioningState == "Deleting", "Deleting",
        "Unknown"
    )
    | project 
        id, 
        name, 
        location, 
        resourceGroup, 
        subscriptionId,
        kubernetesVersion,
        status = actualStatus,
        nodeCount = coalesce(nodeCount, 1),
        vmSize = coalesce(vmSize, "Standard_DS2_v2")
  `;

  try {
    const result = await runQuery(targetSubscriptions, query);
    return result.map((cluster: any) => ({
      id: cluster.id,
      name: cluster.name,
      subscription: cluster.subscriptionId,
      resourceGroup: cluster.resourceGroup,
      location: cluster.location,
      version: cluster.kubernetesVersion || '1.28.0',
      status: cluster.status || 'Unknown',
      nodeCount: cluster.nodeCount || 1,
      vmSize: cluster.vmSize || 'Standard_DS2_v2',
    }));
  } catch (error) {
    console.error('Failed to get clusters from Graph API:', error);
    throw new Error(
      `Failed to get clusters: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get container registries using Resource Graph API
export async function getContainerRegistriesFromGraphAPI(subscriptionId: string): Promise<any[]> {
  const query = `
    Resources
    | where type == "microsoft.containerregistry/registries"
    | where subscriptionId == "${subscriptionId}"
    | project 
        id,
        name,
        resourceGroup,
        location,
        properties.loginServer,
        sku.name
  `;

  try {
    const result = await runQuery([subscriptionId], query);
    return result.map((registry: any) => ({
      id: registry.id,
      name: registry.name,
      resourceGroup: registry.resourceGroup,
      loginServer: registry.properties_loginServer,
      location: registry.location,
      sku: registry.sku_name || 'Basic',
    }));
  } catch (error) {
    console.error('Failed to get container registries from Graph API:', error);
    throw new Error(
      `Failed to get container registries: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

// Note: Container images are not available through Resource Graph API
// as they are data-plane resources. This function will fall back to Azure CLI
export async function getContainerImagesFromGraphAPI(
  subscriptionId: string,
  registryName?: string
): Promise<any[]> {
  // Container images are not exposed through Resource Graph API
  // as they are data-plane resources, not control-plane
  // This will always fall back to CLI implementation
  console.log(
    `Graph API not available for container images in subscription ${subscriptionId}${
      registryName ? ` registry ${registryName}` : ''
    }, falling back to CLI`
  );
  throw new Error('Container images not available through Graph API, falling back to CLI');
}
