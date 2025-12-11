import { getClusters, getSubscriptions as getAzSubscriptions, runCommandAsync } from './az-cli';

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
 * Get the resources path (works in both dev and production)
 */
function getResourcesPath(): string | null {
  if (typeof process !== 'undefined' && (process as any).resourcesPath) {
    return (process as any).resourcesPath;
  }
  return null;
}

/**
 * Get the path to the az-kubelogin.py script
 */
function getAzKubeloginPath(): string {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // In development, use the script from build directory
    return `${__dirname}/../../../../build/az-kubelogin.py`;
  } else {
    // In production, the script is in external-tools/bin
    const resourcesPath = getResourcesPath();
    if (!resourcesPath) {
      throw new Error('Resources path not available');
    }
    return `${resourcesPath}/external-tools/bin/az-kubelogin.py`;
  }
}

/**
 * Get the path to the bundled Python executable
 */
function getBundledPythonPath(): string {
  const isDev = process.env.NODE_ENV === 'development';
  const platform = process.platform === 'win32' ? 'win32' : process.platform;

  if (isDev) {
    // In development, Python is in the Azure CLI directory
    const pythonName = platform === 'win32' ? 'python.exe' : 'python3';
    return `${__dirname}/../../../../headlamp/app/resources/external-tools/az-cli/${platform}/bin/${pythonName}`;
  } else {
    // In production, Python is bundled with Azure CLI
    const pythonName = platform === 'win32' ? 'python.exe' : 'python3';
    const resourcesPath = getResourcesPath();
    if (!resourcesPath) {
      throw new Error('Resources path not available');
    }
    return `${resourcesPath}/external-tools/az-cli/${platform}/bin/${pythonName}`;
  }
}

/**
 * Add az-kubelogin.py exec configuration to kubeconfig for Azure AD authentication
 */
function addAzKubeloginToKubeconfig(kubeconfigYaml: string): string {
  try {
    const yaml = require('js-yaml');
    const kubeconfig = yaml.load(kubeconfigYaml);

    if (!kubeconfig || !kubeconfig.users) {
      return kubeconfigYaml;
    }

    const kubeloginPath = getAzKubeloginPath();
    const pythonPath = getBundledPythonPath();
    const serverId = '6dae42f8-4368-4678-94ff-3960e28e3960'; // Azure Kubernetes Service AAD Server

    // Get Azure CLI bin path and external tools bin path to add to PATH env var
    const isDev = process.env.NODE_ENV === 'development';
    const platform = process.platform === 'win32' ? 'win32' : process.platform;
    let azCliBinPath: string;
    let externalToolsBinPath: string;

    if (isDev) {
      azCliBinPath = `${__dirname}/../../../../headlamp/app/resources/external-tools/az-cli/${platform}/bin`;
      externalToolsBinPath = `${__dirname}/../../../../headlamp/app/resources/external-tools/bin`;
    } else {
      const resourcesPath = getResourcesPath();
      if (!resourcesPath) {
        throw new Error('Resources path not available');
      }
      azCliBinPath = `${resourcesPath}/external-tools/az-cli/${platform}/bin`;
      externalToolsBinPath = `${resourcesPath}/external-tools/bin`;
    }

    // Add exec configuration to each user
    for (const user of kubeconfig.users) {
      if (user.user) {
        console.log('[AKS] Adding az-kubelogin.py exec configuration for user:', user.name);

        // Set up exec authentication with our bundled Python script
        // Include both Azure CLI bin and external tools bin in PATH
        const pathSeparator = process.platform === 'win32' ? ';' : ':';
        const combinedPath = `${externalToolsBinPath}${pathSeparator}${azCliBinPath}${pathSeparator}${
          process.env.PATH || ''
        }`;

        user.user.exec = {
          apiVersion: 'client.authentication.k8s.io/v1beta1',
          command: pythonPath,
          args: [kubeloginPath, '--server-id', serverId],
          env: [
            {
              name: 'PATH',
              value: combinedPath,
            },
          ],
          provideClusterInfo: false,
        };
      }
    }

    // Convert back to YAML
    return yaml.dump(kubeconfig);
  } catch (error) {
    console.error('[AKS] Error adding az-kubelogin to kubeconfig:', error);
    // Return original if parsing fails
    return kubeconfigYaml;
  }
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
    const subs = await getAzSubscriptions();

    return {
      success: true,
      message: 'Subscriptions retrieved successfully',
      subscriptions: subs.map((sub: any) => ({
        id: sub.id,
        name: sub.name,
        state: sub.status || 'Unknown',
        tenantId: sub.tenant,
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
    const clusters = await getClusters(subscriptionId);

    return {
      success: true,
      message: 'AKS clusters retrieved successfully',
      clusters: clusters.map((cluster: any) => ({
        name: cluster.name,
        resourceGroup: cluster.resourceGroup,
        location: cluster.location,
        kubernetesVersion: cluster.version,
        provisioningState: cluster.status,
        fqdn: '', // Not returned by getClusters
        isAzureRBACEnabled: cluster.aadProfile !== null,
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
 *
 * @param managedNamespace - Optional managed namespace name to use for scoped credentials
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
    console.log(
      '[AKS] Registering cluster:',
      clusterName,
      managedNamespace ? `with managed namespace: ${managedNamespace}` : ''
    );

    // Call the Electron IPC handler
    const desktopApi = (window as any).desktopApi;

    if (!desktopApi || !desktopApi.registerAKSCluster) {
      console.error('[AKS] Desktop API not available - running in non-desktop mode?');
      return {
        success: false,
        message: 'Desktop API not available. This feature is only available in desktop mode.',
      };
    }

    // Get cluster info
    const clusterInfo = await getAKSClusterDetails(subscriptionId, resourceGroup, clusterName);
    if (!clusterInfo.success) {
      return {
        success: false,
        message: clusterInfo.message,
      };
    }

    const result = await desktopApi.registerAKSCluster(
      subscriptionId,
      resourceGroup,
      clusterName,
      clusterInfo.cluster?.isAzureRBACEnabled,
      managedNamespace
    );

    console.log('[AKS] Registration result:', result);
    return result;
  } catch (error) {
    console.error('[AKS] Error registering AKS cluster:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get kubeconfig for an AKS cluster (base64 encoded)
 * @deprecated Use registerAKSCluster() instead to write kubeconfig directly
 */
export async function getAKSKubeconfig(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<{
  success: boolean;
  message: string;
  kubeconfig?: string;
}> {
  try {
    // Use --format azure to get a kubeconfig without kubelogin dependency
    // We'll add our own exec configuration afterwards
    const args = [
      'aks',
      'get-credentials',
      '--subscription',
      subscriptionId,
      '--resource-group',
      resourceGroup,
      '--name',
      clusterName,
      '--format',
      '--overwrite-existing',
      'azure', // This gives us basic auth without exec plugin
      '--file',
      '-', // Output to stdout
    ];

    console.log('[AKS] Getting kubeconfig with args:', args);
    const { stdout, stderr } = await runCommandAsync('az', args);

    console.log('[AKS] get-credentials stdout length:', stdout?.length);
    console.log('[AKS] get-credentials stderr:', stderr);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      return {
        success: false,
        message: stderr || 'Failed to get AKS kubeconfig',
      };
    }

    if (!stdout) {
      return {
        success: false,
        message: 'No kubeconfig returned from Azure CLI',
      };
    }

    // Validate that stdout looks like a kubeconfig (contains apiVersion and kind)
    if (!stdout.includes('apiVersion') || !stdout.includes('kind: Config')) {
      console.error('[AKS] Invalid kubeconfig format. First 500 chars:', stdout.substring(0, 500));
      return {
        success: false,
        message: 'Invalid kubeconfig format received from Azure CLI',
      };
    }

    console.log('[AKS] Kubeconfig preview:', stdout.substring(0, 300));

    // Add our az-kubelogin.py exec configuration for Azure AD authentication
    const modifiedKubeconfig = addAzKubeloginToKubeconfig(stdout);

    // Base64 encode the kubeconfig
    const base64Kubeconfig = Buffer.from(modifiedKubeconfig).toString('base64');
    console.log('[AKS] Kubeconfig base64 encoded, length:', base64Kubeconfig.length);

    return {
      success: true,
      message: 'Kubeconfig retrieved successfully',
      kubeconfig: base64Kubeconfig,
    };
  } catch (error) {
    console.error('Error getting AKS kubeconfig:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get details for a specific AKS cluster
 */
export async function getAKSClusterDetails(
  subscriptionId: string,
  resourceGroup: string,
  clusterName: string
): Promise<{
  success: boolean;
  message: string;
  cluster?: AKSCluster;
}> {
  try {
    const args = [
      'aks',
      'show',
      '--subscription',
      subscriptionId,
      '--resource-group',
      resourceGroup,
      '--name',
      clusterName,
      '--output',
      'json',
    ];

    const { stdout, stderr } = await runCommandAsync('az', args);

    if (stderr && (stderr.includes('ERROR') || stderr.includes('error'))) {
      return {
        success: false,
        message: stderr || 'Failed to get AKS cluster details',
      };
    }

    if (!stdout) {
      return {
        success: false,
        message: 'No cluster details returned from Azure CLI',
      };
    }

    try {
      const cluster = JSON.parse(stdout);
      return {
        success: true,
        message: 'Cluster details retrieved successfully',
        cluster: {
          name: cluster.name,
          resourceGroup: cluster.resourceGroup,
          location: cluster.location,
          kubernetesVersion: cluster.kubernetesVersion,
          provisioningState: cluster.provisioningState,
          fqdn: cluster.fqdn,
          isAzureRBACEnabled: cluster.aadProfile !== null,
        },
      };
    } catch (parseError) {
      console.error('Error parsing cluster details:', parseError);
      return {
        success: false,
        message: 'Failed to parse cluster details',
      };
    }
  } catch (error) {
    console.error('Error getting AKS cluster details:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
