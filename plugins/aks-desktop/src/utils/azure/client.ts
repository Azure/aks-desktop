// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Azure Client Factory with Graph API Integration
 *
 * This module provides a unified interface for accessing Azure resources using both
 * Azure Resource Graph API and Azure CLI as fallback. The Graph API provides better
 * performance and more efficient querying for read operations.
 *
 * Features:
 * - Primary: Azure Resource Graph API for fast, efficient queries
 * - Fallback: Azure CLI for compatibility and write operations
 * - Error handling with automatic fallback
 * - TypeScript-first with strong typing
 * - Optimized for AKS cluster management
 */

import {
  getClusters,
  getContainerImages,
  getContainerRegistries,
  getResourceGroups,
  getSubscriptions,
  getTenants,
} from './az-cli';
import {
  getClustersFromGraphAPI,
  getContainerImagesFromGraphAPI,
  getContainerRegistriesFromGraphAPI,
  getResourceGroupsFromGraphAPI,
  getSubscriptionsFromGraphAPI,
  getTenantsFromGraphAPI,
} from './graph-api';

// Types for Azure resources
export interface AzureTenant {
  id: string;
  name: string;
  domain: string;
  status: string;
}

export interface AzureSubscription {
  id: string;
  name: string;
  tenant: string;
  status: string;
  cost?: string;
}

export interface AzureResourceGroup {
  id: string;
  name: string;
  location: string;
  subscriptionId: string;
}

export interface AzureCluster {
  id: string;
  name: string;
  subscription: string;
  resourceGroup: string;
  location: string;
  version: string;
  status: string;
  nodeCount: number;
  vmSize: string;
}

export interface ContainerRegistry {
  id: string;
  name: string;
  resourceGroup: string;
  loginServer: string;
  location: string;
  sku: string;
}

export interface ContainerImage {
  id: string;
  name: string;
  repository: string;
  tag: string;
  registry: string;
  registryName: string;
  createdTime: string;
  size: string;
  digest: string;
}

// Interface for the Azure client
export interface AzureClient {
  getSubscriptions(): Promise<AzureSubscription[]>;
  getTenants(): Promise<AzureTenant[]>;
  getClusters(subscriptionId?: string): Promise<AzureCluster[]>;
  getResourceGroups(subscriptionId: string): Promise<AzureResourceGroup[]>;
  getContainerRegistries(subscriptionId: string): Promise<ContainerRegistry[]>;
  getContainerImages(subscriptionId: string, registryName?: string): Promise<ContainerImage[]>;
}

// Graph API client implementation for read operations
class GraphAPIClient implements AzureClient {
  async getSubscriptions(): Promise<AzureSubscription[]> {
    try {
      return await getSubscriptionsFromGraphAPI();
    } catch (error) {
      console.warn('Graph API failed for subscriptions, falling back to CLI:', error);
      return getSubscriptions();
    }
  }

  async getTenants(): Promise<AzureTenant[]> {
    try {
      return await getTenantsFromGraphAPI();
    } catch (error) {
      console.warn('Graph API failed for tenants, falling back to CLI:', error);
      return getTenants();
    }
  }

  async getClusters(subscriptionId?: string): Promise<AzureCluster[]> {
    try {
      return await getClustersFromGraphAPI(subscriptionId);
    } catch (error) {
      console.warn('Graph API failed for clusters, falling back to CLI:', error);
      return getClusters(subscriptionId);
    }
  }

  async getResourceGroups(subscriptionId: string): Promise<AzureResourceGroup[]> {
    try {
      // Try Graph API first for better performance
      return await getResourceGroupsFromGraphAPI(subscriptionId);
    } catch (error) {
      console.warn('Graph API failed for resource groups, falling back to CLI:', error);
      // Fallback to CLI if Graph API fails
      return getResourceGroups(subscriptionId);
    }
  }

  async getContainerRegistries(subscriptionId: string): Promise<ContainerRegistry[]> {
    try {
      return await getContainerRegistriesFromGraphAPI(subscriptionId);
    } catch (error) {
      console.warn('Graph API failed for container registries, falling back to CLI:', error);
      return getContainerRegistries(subscriptionId);
    }
  }

  async getContainerImages(
    subscriptionId: string,
    registryName?: string
  ): Promise<ContainerImage[]> {
    try {
      return await getContainerImagesFromGraphAPI(subscriptionId, registryName);
    } catch (error) {
      console.warn('Graph API failed for container images, falling back to CLI:', error);
      return getContainerImages(subscriptionId, registryName);
    }
  }
}

// Legacy CLI client implementation (kept for comparison/fallback)
class AzCliClient implements AzureClient {
  async getSubscriptions(): Promise<AzureSubscription[]> {
    return getSubscriptions();
  }

  async getTenants(): Promise<AzureTenant[]> {
    return getTenants();
  }

  async getClusters(subscriptionId?: string): Promise<AzureCluster[]> {
    return getClusters(subscriptionId);
  }

  async getResourceGroups(subscriptionId: string): Promise<AzureResourceGroup[]> {
    return getResourceGroups(subscriptionId);
  }

  async getContainerRegistries(subscriptionId: string): Promise<ContainerRegistry[]> {
    return getContainerRegistries(subscriptionId);
  }

  async getContainerImages(
    subscriptionId: string,
    registryName?: string
  ): Promise<ContainerImage[]> {
    return getContainerImages(subscriptionId, registryName);
  }
}

// Factory function to create the client
export function createAzureClient(): AzureClient {
  // Use Graph API client by default for better performance on read operations
  return new GraphAPIClient();
}

// Factory function to create CLI client (for fallback or specific use cases)
export function createAzureCliClient(): AzureClient {
  return new AzCliClient();
}
