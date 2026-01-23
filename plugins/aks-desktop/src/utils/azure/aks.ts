import { AuthorizationManagementClient } from '@azure/arm-authorization';
import {
  ContainerServiceClient,
  ManagedNamespacesCreateOrUpdateResponse,
} from '@azure/arm-containerservice';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { setCluster } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { auth } from '@kinvolk/headlamp-plugin/lib/Utils';
import YAML from 'yaml';

export interface Subscription {
  id: string;
  name: string;
  state: string;
  tenantId: string;
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

export interface AzureResult<T = any> {
  success: boolean;
  message: string;
  data?: T;
}

/**
 * Get list of Azure subscriptions
 */
export async function getSubscriptions(): Promise<{
  success: boolean;
  message: string;
  subscriptions?: Subscription[];
}> {
  try {
    const client = new ResourceGraphClient(azureCredential);

    const result = await client.resources({
      query: `
            resourcecontainers
            | where type == "microsoft.resources/subscriptions"
            | project id = subscriptionId, name, tenantId, state = properties.state
          `,
    });

    const subs = (result.data as Array<any>) || [];

    return {
      success: true,
      message: 'Subscriptions retrieved successfully',
      subscriptions: subs.map((sub: any) => ({
        id: sub.id,
        name: sub.name,
        state: sub.state || 'Unknown',
        tenantId: sub.tenantId,
        isDefault: false, // We don't have this info from the existing function
      })),
    };
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get list of AKS clusters in a subscription
 */
export async function getAKSClusters(subscriptionId: string): Promise<{
  success: boolean;
  message: string;
  clusters?: AKSCluster[];
}> {
  try {
    const client = new ResourceGraphClient(azureCredential);

    const clusters = await client
      .resources({
        subscriptions: [subscriptionId],
        query: `
            resources
            | where type == "microsoft.containerservice/managedclusters"
          `,
      })
      .then(it => it.data);

    return {
      success: true,
      message: 'AKS clusters retrieved successfully',
      clusters: clusters.map((cluster: any) => ({
        name: cluster.name,
        resourceGroup: cluster.resourceGroup,
        location: cluster.location,
        kubernetesVersion: cluster.properties.version,
        provisioningState: cluster.properties.provisioningState,
        fqdn: cluster.properties.fqdn,
        isAzureRBACEnabled: cluster.properties.aadProfile !== null,
      })),
    };
  } catch (error) {
    console.error('Error getting AKS clusters:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Register an AKS cluster using the Electron IPC API.
 * This calls the native registration logic in the Electron backend.
 */
export async function registerAKSCluster(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string,
  managedNamespace?: string
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const AKS_SERVER_ID = '6dae42f8-4368-4678-94ff-3960e28e3630';
    const aksClient = new ContainerServiceClient(azureCredential, subscriptionId);

    const creds = managedNamespace
      ? await aksClient.managedNamespaces.listCredential(
          resourceGroup,
          clusterName,
          managedNamespace
        )
      : await aksClient.managedClusters.listClusterUserCredentials(resourceGroup, clusterName);

    const kubeconfigData = creds.kubeconfigs?.[0]?.value;
    if (!kubeconfigData) {
      return { success: false, message: 'No kubeconfig data returned from Azure' };
    }

    const kubeconfig = YAML.parse(Buffer.from(kubeconfigData).toString('utf-8'));

    const tokenResult = await azureCredential.getToken(`${AKS_SERVER_ID}/.default`);

    // Remove kubelogin exec
    for (const user of kubeconfig.users || []) {
      if (user.user?.exec) {
        delete user.user.exec;
      }
    }

    // Add AKS metadata extension for token refresh
    const aksExtension = {
      name: 'aks_info',
      extension: {
        subscriptionId,
        resourceGroup,
        clusterName,
      },
    };

    if (!kubeconfig.extensions) {
      kubeconfig.extensions = [];
    }
    const existingAksExt = kubeconfig.extensions.findIndex((ext: any) => ext.name === 'aks_info');
    if (existingAksExt >= 0) {
      kubeconfig.extensions[existingAksExt] = aksExtension;
    } else {
      kubeconfig.extensions.push(aksExtension);
    }

    // Return base64-encoded kubeconfig
    const kubeconfigYaml = YAML.stringify(kubeconfig);
    const kubeconfigBase64 = Buffer.from(kubeconfigYaml).toString('base64');

    await setCluster({ kubeconfig: kubeconfigBase64 });
    auth.setToken(clusterName, tokenResult.token);

    return { success: true, message: '' };
  } catch (error) {
    console.error('[AKS] Error registering AKS cluster:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getAksToken() {
  const AKS_SERVER_ID = '6dae42f8-4368-4678-94ff-3960e28e3630';
  return await azureCredential.getToken(`${AKS_SERVER_ID}/.default`);
}

/**
 * Get a single managed namespace from an AKS cluster
 */
export async function getManagedNamespace({
  subscriptionId,
  resourceGroup,
  clusterName,
  namespaceName,
}: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  namespaceName: string;
}): Promise<AzureResult> {
  try {
    const client = new ResourceGraphClient(azureCredential);

    const result = await client.resources({
      subscriptions: [subscriptionId],
      query: `
        resources
        | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces'
        | where name == '${namespaceName}'
        | where id contains '${clusterName}'
        | where resourceGroup =~ '${resourceGroup}'
      `,
    });

    const namespaces = (result.data as Array<any>) || [];
    if (namespaces.length === 0) {
      return {
        success: false,
        message: `Managed namespace '${namespaceName}' not found`,
      };
    }

    return {
      success: true,
      message: 'Managed namespace retrieved successfully',
      data: namespaces[0],
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update a managed namespace in an AKS cluster
 */
export async function updateManagedNamespace(options: {
  subscriptionId: string;
  resourceGroup: string;
  clusterName: string;
  namespaceName: string;
  cpuRequest?: number;
  cpuLimit?: number;
  memoryRequest?: number;
  memoryLimit?: number;
  ingressPolicy?: 'AllowAll' | 'AllowSameNamespace' | 'DenyAll';
  egressPolicy?: 'AllowAll' | 'AllowSameNamespace' | 'DenyAll';
}): Promise<AzureResult> {
  const {
    subscriptionId,
    resourceGroup,
    clusterName,
    namespaceName,
    cpuRequest,
    cpuLimit,
    memoryRequest,
    memoryLimit,
    ingressPolicy,
    egressPolicy,
  } = options;

  try {
    const aksClient = new ContainerServiceClient(azureCredential, subscriptionId);

    const existing = await aksClient.managedNamespaces.get(
      resourceGroup,
      clusterName,
      namespaceName
    );

    const result = await aksClient.managedNamespaces.beginCreateOrUpdateAndWait(
      resourceGroup,
      clusterName,
      namespaceName,
      {
        ...existing,
        properties: {
          ...existing.properties,
          defaultResourceQuota: {
            ...existing.properties?.defaultResourceQuota,
            cpuRequest:
              cpuRequest !== undefined
                ? `${cpuRequest}m`
                : existing.properties?.defaultResourceQuota?.cpuRequest,
            cpuLimit:
              cpuLimit !== undefined
                ? `${cpuLimit}m`
                : existing.properties?.defaultResourceQuota?.cpuLimit,
            memoryRequest:
              memoryRequest !== undefined
                ? `${memoryRequest}Mi`
                : existing.properties?.defaultResourceQuota?.memoryRequest,
            memoryLimit:
              memoryLimit !== undefined
                ? `${memoryLimit}Mi`
                : existing.properties?.defaultResourceQuota?.memoryLimit,
          },
          defaultNetworkPolicy: {
            ...existing.properties?.defaultNetworkPolicy,
            ingress: ingressPolicy ?? existing.properties?.defaultNetworkPolicy?.ingress,
            egress: egressPolicy ?? existing.properties?.defaultNetworkPolicy?.egress,
          },
        },
      }
    );

    return {
      success: true,
      message: 'Managed namespace updated successfully',
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if a Kubernetes namespace exists in an AKS cluster
 */
export async function checkNamespaceExists(
  clusterName: string,
  resourceGroup: string,
  namespaceName: string,
  subscriptionId: string
): Promise<{ exists: boolean; error?: string }> {
  const result = await getManagedNamespace({
    subscriptionId,
    resourceGroup,
    clusterName,
    namespaceName,
  });

  if (result.success) {
    return { exists: true };
  }

  if (result.message.includes('not found')) {
    return { exists: false };
  }

  return { exists: false, error: result.message };
}

/**
 * Check if ManagedNamespacePreview feature is registered
 */
export async function isManagedNamespacePreviewRegistered({
  subscription,
}: {
  subscription: string;
}): Promise<{
  registered: boolean;
  state?: string;
  error?: string;
}> {
  try {
    const { FeatureClient } = await import('@azure/arm-features');
    const client = new FeatureClient(azureCredential, subscription);

    const feature = await client.features.get(
      'Microsoft.ContainerService',
      'ManagedNamespacePreview'
    );

    const state = feature.properties?.state;
    const isRegistered = state === 'Registered';

    return {
      registered: isRegistered,
      state: state,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { registered: false, error: errorMessage };
  }
}

/**
 * Register ManagedNamespacePreview feature
 */
export async function registerManagedNamespacePreview({
  subscription,
}: {
  subscription: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { FeatureClient } = await import('@azure/arm-features');
    const client = new FeatureClient(azureCredential, subscription);

    await client.features.register('Microsoft.ContainerService', 'ManagedNamespacePreview');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Failed to register ManagedNamespacePreview feature: ${errorMessage}`,
    };
  }
}

/**
 * Register Microsoft.ContainerService provider
 */
export async function registerContainerServiceProvider({
  subscription,
}: {
  subscription: string;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { ResourceManagementClient } = await import('@azure/arm-resources');
    const client = new ResourceManagementClient(azureCredential, subscription);

    await client.providers.register('Microsoft.ContainerService');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Failed to register Microsoft.ContainerService provider: ${errorMessage}`,
    };
  }
}

declare global {
  interface Window {
    azureApi: any;
  }
}

/** Azure SDK compatible token credential */
export const azureCredential = {
  async getToken(scopes: string | string[]): Promise<{
    token: string;
    expiresOnTimestamp: number;
  }> {
    return window.azureApi.getToken({ scopes });
  },
};

/** Check login status without prompting to login */
export async function getLoginStatus(): Promise<{
  isLoggedIn: boolean;
  username?: string;
  tenantId?: string;
  subscriptionId?: string;
  needsRelogin?: boolean;
  error?: string;
}> {
  try {
    const result = await window.azureApi.checkLogin();
    return result;
  } catch (error) {
    console.error('Error getting Azure login status:', error);
    return {
      isLoggedIn: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get Prometheus query endpoint for an AKS cluster
 */
export async function getPrometheusEndpoint(
  resourceGroup: string,
  clusterName: string,
  subscription: string
): Promise<string> {
  const client = new ResourceGraphClient(azureCredential);

  const result = await client.resources({
    subscriptions: [subscription],
    query: `
      resources
      | where type =~ 'microsoft.alertsmanagement/prometheusrulegroups'
      | where resourceGroup =~ '${resourceGroup}'
      | where properties.clusterName == '${clusterName}'
      | mv-expand workspaceId = properties.scopes
      | project workspaceId = tolower(tostring(workspaceId))
      | join kind=inner (
          resources
          | where type =~ 'microsoft.monitor/accounts'
          | project workspaceId = tolower(id), prometheusEndpoint = properties.metrics.prometheusQueryEndpoint
      ) on workspaceId
      | project prometheusEndpoint
    `,
  });

  const data = (result.data as Array<any>) || [];
  if (data.length === 0) {
    throw new Error(`No prometheus endpoint found for cluster '${clusterName}'`);
  }

  return data[0].prometheusEndpoint;
}

/**
 * Query Prometheus metrics from Azure Monitor
 */
export async function queryPrometheus(
  endpoint: string,
  query: string,
  start: number,
  end: number,
  step = 60
): Promise<any[]> {
  try {
    const tokenResult = await azureCredential.getToken(
      'https://prometheus.monitor.azure.com/.default'
    );
    const rangeUrl = `${endpoint}/api/v1/query_range`;

    const formData = new URLSearchParams();
    formData.append('query', query);
    formData.append('start', start.toString());
    formData.append('end', end.toString());
    formData.append('step', step.toString());

    const response = await fetch(rangeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'success' && data.data.result) {
      return data.data.result;
    }

    return [];
  } catch (error) {
    console.error('queryPrometheus failed:', error);
    return [];
  }
}

export function login() {
  return window.azureApi.login();
}

export function logout() {
  return window.azureApi.logout();
}

export async function createManagedNamespace(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId?: string;
  cpuRequest?: number;
  cpuLimit?: number;
  memoryRequest?: number;
  memoryLimit?: number;
  ingressPolicy?: string;
  egressPolicy?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}): Promise<ManagedNamespacesCreateOrUpdateResponse> {
  const {
    clusterName,
    resourceGroup,
    namespaceName,
    subscriptionId,
    cpuRequest,
    cpuLimit,
    memoryRequest,
    memoryLimit,
    ingressPolicy,
    egressPolicy,
    labels = {},
  } = options;

  const aksClient = new ContainerServiceClient(azureCredential, subscriptionId);

  const cluster = await aksClient.managedClusters.get(resourceGroup, clusterName);
  const location = cluster.location;

  const result = await aksClient.managedNamespaces.beginCreateOrUpdateAndWait(
    resourceGroup,
    clusterName,
    namespaceName,
    {
      location,
      properties: {
        labels,
        defaultResourceQuota: {
          cpuLimit: cpuLimit + 'm',
          cpuRequest: cpuRequest + 'm',
          memoryLimit: memoryLimit + 'Mi',
          memoryRequest: memoryRequest + 'Mi',
        },
        defaultNetworkPolicy: {
          ingress: ingressPolicy,
          egress: egressPolicy,
        },
      },
    }
  );

  return result;
}

/**
 * Delete a managed namespace from an AKS cluster
 */
export async function deleteManagedNamespace(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId: string;
}): Promise<AzureResult> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  try {
    const aksClient = new ContainerServiceClient(azureCredential, subscriptionId);

    await aksClient.managedNamespaces.beginDeleteAndWait(resourceGroup, clusterName, namespaceName);

    return {
      success: true,
      message: 'Managed namespace deleted successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export const PROJECT_ID_LABEL = 'headlamp.dev/project-id';
export const PROJECT_MANAGED_BY_LABEL = 'headlamp.dev/project-managed-by';
export const PROJECT_MANAGED_BY_AKS_DESKTOP = 'aks-desktop';

/**
 * Get all managed namespaces across all clusters in a subscription
 */
export async function getManagedNamespaces(): Promise<
  Array<{
    id: string;
    name: string;
    resourceGroup: string;
    properties?: any;
    subscriptionId: string;
  }>
> {
  try {
    const client = new ResourceGraphClient(azureCredential);

    const result = await client.resources({
      query: `
         resources
        | where type =~ 'microsoft.containerservice/managedclusters/managednamespaces'
        | where properties['labels']['${PROJECT_MANAGED_BY_LABEL}'] == '${PROJECT_MANAGED_BY_AKS_DESKTOP}'
      `,
    });

    const namespaces = (result.data as Array<any>) || [];

    return namespaces.map((ns: any) => {
      return {
        id: ns.id,
        name: ns.name,
        resourceGroup: ns.resourceGroup || '',
        properties: ns.properties || {},
        subscriptionId: ns.subscriptionId,
      };
    });
  } catch (error) {
    console.error('Failed to get managed namespaces:', error);
    return [];
  }
}

/**
 * Get detailed properties of a specific managed namespace
 */
export async function getManagedNamespaceDetails(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  subscriptionId: string;
}): Promise<any> {
  const { clusterName, resourceGroup, namespaceName, subscriptionId } = options;

  try {
    const aksClient = new ContainerServiceClient(azureCredential, subscriptionId);

    const namespace = await aksClient.managedNamespaces.get(
      resourceGroup,
      clusterName,
      namespaceName
    );

    return namespace;
  } catch (error) {
    console.error('Failed to get managed namespace details:', error);
    throw new Error(
      `Failed to get managed namespace details: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

// Helper to check if a string is a valid GUID
function isGuid(str: string): boolean {
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return guidRegex.test(str);
}

// Resolve a user email/UPN to their object ID using Microsoft Graph
export async function resolveUserPrincipalId(userIdentifier: string): Promise<string> {
  if (isGuid(userIdentifier)) {
    return userIdentifier;
  }

  const credential = azureCredential;
  const tokenResponse = await credential.getToken('https://graph.microsoft.com/User.ReadBasic.All');
  const accessToken = tokenResponse.token;

  // Try to get user by UPN (email)
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userIdentifier)}?$select=id`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to resolve user '${userIdentifier}': ${response.status} ${errorText}`);
  }

  const user = await response.json();
  if (!user.id) {
    throw new Error(`User '${userIdentifier}' not found or has no object ID`);
  }

  console.debug(`Resolved user '${userIdentifier}' to principal ID: ${user.id}`);
  return user.id;
}

// Create a role assignment for a namespace
export async function createNamespaceRoleAssignment(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  assignee: string;
  role: string;
  subscriptionId?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { clusterName, resourceGroup, namespaceName, assignee, role, subscriptionId } = options;

  const cleanRole = role.trim().replace(/^["']|["']$/g, '');

  try {
    const principalId = await resolveUserPrincipalId(assignee);

    const aksClient = new ContainerServiceClient(azureCredential, subscriptionId);
    const authClient = new AuthorizationManagementClient(azureCredential, subscriptionId);

    const namespace = await aksClient.managedNamespaces.get(
      resourceGroup,
      clusterName,
      namespaceName
    );

    const namespaceResourceId = namespace.id;
    if (!namespaceResourceId) {
      return { success: false, error: 'Failed to get namespace resource ID' };
    }

    console.debug('Namespace resource ID:', namespaceResourceId);

    const roleDefinitionId = await findRoleDefinitionId(authClient, namespaceResourceId, cleanRole);
    if (!roleDefinitionId) {
      return { success: false, error: `Role definition not found: ${cleanRole}` };
    }

    console.debug('Role definition ID:', roleDefinitionId);

    const result = await authClient.roleAssignments.create(
      namespaceResourceId,
      crypto.randomUUID(),
      {
        roleDefinitionId,
        principalId,
        principalType: 'User',
      }
    );

    console.debug('Role assignment created:', result);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Failed to create role assignment: ${errorMessage}` };
  }
}

async function findRoleDefinitionId(
  authClient: AuthorizationManagementClient,
  scope: string,
  roleName: string
): Promise<string | undefined> {
  for await (const roleDef of authClient.roleDefinitions.list(scope)) {
    if (roleDef.roleName === roleName || roleDef.id === roleName) {
      return roleDef.id;
    }
  }
  return undefined;
}

// Verify if a user has access to a namespace
export async function verifyNamespaceAccess(options: {
  clusterName: string;
  resourceGroup: string;
  namespaceName: string;
  assignee: string;
  subscriptionId?: string;
}): Promise<{
  success: boolean;
  hasAccess: boolean;
  error?: string;
}> {
  const { clusterName, resourceGroup, namespaceName, assignee, subscriptionId } = options;

  try {
    const principalId = await resolveUserPrincipalId(assignee);

    const aksClient = new ContainerServiceClient(azureCredential, subscriptionId);
    const authClient = new AuthorizationManagementClient(azureCredential, subscriptionId);

    const namespace = await aksClient.managedNamespaces.get(
      resourceGroup,
      clusterName,
      namespaceName
    );

    const namespaceResourceId = namespace.id;
    if (!namespaceResourceId) {
      return { success: false, hasAccess: false, error: 'Failed to get namespace resource ID' };
    }

    const assignments: string[] = [];
    for await (const assignment of authClient.roleAssignments.listForScope(namespaceResourceId, {
      filter: `principalId eq '${principalId}'`,
    })) {
      if (assignment.principalId === principalId) {
        assignments.push(assignment.roleDefinitionId ?? '');
      }
    }

    return { success: true, hasAccess: assignments.length > 0 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      hasAccess: false,
      error: `Failed to verify namespace access: ${errorMessage}`,
    };
  }
}
