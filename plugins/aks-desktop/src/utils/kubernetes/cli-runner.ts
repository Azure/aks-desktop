// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, runCommand } from '@kinvolk/headlamp-plugin/lib';

declare const pluginRunCommand: typeof runCommand;

function runCommandAsync(
  command: 'az',
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  console.log('command called:', command, args);
  return new Promise(resolve => {
    try {
      const cmd = pluginRunCommand(command, args, {});
      let stdout = '';
      let stderr = '';

      cmd.stdout.on('data', (data: string) => (stdout += data));
      cmd.stderr.on('data', (data: string) => (stderr += data));

      cmd.on('exit', () => {
        resolve({ stdout, stderr });
      });

      cmd.on('error', (code: number) => {
        resolve({ stdout: '', stderr: `Command execution error (code ${code})` });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      resolve({ stdout: '', stderr: `Failed to execute command: ${errorMessage}` });
    }
  });
}

export async function runAzCli(args: string[]): Promise<string> {
  const { stdout, stderr } = await runCommandAsync('az', args);
  if (stderr && stderr.includes('ERROR')) {
    throw new Error(`az CLI error: ${stderr}`);
  }
  return stdout.trim();
}

export async function runCommandWithOutput(
  command: 'az',
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return await runCommandAsync(command, args);
}

export async function getNamespaces(clusterContext?: string): Promise<string[]> {
  return new Promise(resolve => {
    try {
      K8s.ResourceClasses.Namespace.apiList(
        namespaces => {
          const namespaceNames = namespaces.map(ns => ns.metadata?.name || '').filter(Boolean);
          resolve(namespaceNames);
        },
        (err: any) => {
          console.error('Error getting namespaces with Headlamp API:', err);
          resolve([]);
        },
        {
          cluster: clusterContext,
        }
      )();
    } catch (error) {
      console.error('Error in getNamespaces:', error);
      resolve([]);
    }
  });
}

export async function getDeployments(namespace: string, clusterContext?: string): Promise<any[]> {
  return new Promise(resolve => {
    try {
      K8s.ResourceClasses.Deployment.apiList(
        deployments => {
          // Convert Headlamp deployment objects to plain objects for compatibility
          const deploymentObjects = deployments.map(
            deployment => deployment.jsonData || deployment
          );
          resolve(deploymentObjects);
        },
        (err: any) => {
          console.error('Error getting deployments with Headlamp API:', err);
          resolve([]);
        },
        {
          cluster: clusterContext,
          namespace,
        }
      )();
    } catch (error) {
      console.error('Error in getDeployments:', error);
      resolve([]);
    }
  });
}

export async function getPods(
  namespace: string,
  deploymentName?: string,
  clusterContext?: string
): Promise<any[]> {
  return new Promise(resolve => {
    try {
      const options: any = {
        cluster: clusterContext,
        namespace,
      };

      // Add label selector if deploymentName is provided
      if (deploymentName) {
        options.labelSelector = `app=${deploymentName}`;
      }

      K8s.ResourceClasses.Pod.apiList(
        pods => {
          // Convert Headlamp pod objects to plain objects for compatibility
          const podObjects = pods.map(pod => pod.jsonData || pod);
          resolve(podObjects);
        },
        (err: any) => {
          console.error('Error getting pods with Headlamp API:', err);
          // Try fallback with alternative label if deploymentName was provided
          if (deploymentName) {
            const fallbackOptions = {
              ...options,
              labelSelector: `app.kubernetes.io/name=${deploymentName}`,
            };

            K8s.ResourceClasses.Pod.apiList(
              pods => {
                const podObjects = pods.map(pod => pod.jsonData || pod);
                resolve(podObjects);
              },
              (fallbackErr: any) => {
                console.error('Error with fallback pod selector:', fallbackErr);
                resolve([]);
              },
              fallbackOptions
            )();
          } else {
            resolve([]);
          }
        },
        options
      )();
    } catch (error) {
      console.error('Error in getPods:', error);
      resolve([]);
    }
  });
}

export async function getLogs(
  namespace: string,
  podName: string,
  containerName?: string,
  clusterContext?: string
): Promise<string> {
  return new Promise(resolve => {
    try {
      K8s.ResourceClasses.Pod.apiGet(
        pod => {
          // Use pod.getLogs method for efficient log streaming
          const logOptions = {
            container: containerName,
            tailLines: 100,
            follow: false,
            timestamps: false,
          };

          pod
            .getLogs(containerName, logOptions)
            .then((logs: string) => {
              resolve(logs || '');
            })
            .catch((error: any) => {
              console.error('Error getting pod logs:', error);
              resolve('');
            });
        },
        podName,
        namespace,
        (err: any) => {
          console.error('Error getting pod with Headlamp API:', err);
          resolve('');
        },
        {
          cluster: clusterContext,
        }
      )();
    } catch (error) {
      console.error('Error in getLogs:', error);
      resolve('');
    }
  });
}

export async function scaleDeployment(
  namespace: string,
  deploymentName: string,
  replicas: number,
  clusterContext?: string
): Promise<boolean> {
  return new Promise(resolve => {
    try {
      K8s.ResourceClasses.Deployment.apiGet(
        async deployment => {
          try {
            // Use the deployment's scale method
            await deployment.scale(replicas);
            resolve(true);
          } catch (scaleError) {
            console.error('Error scaling deployment:', scaleError);
            resolve(false);
          }
        },
        deploymentName,
        namespace,
        (err: any) => {
          console.error('Error getting deployment for scaling:', err);
          resolve(false);
        },
        {
          cluster: clusterContext,
        }
      )();
    } catch (error) {
      console.error('Error in scaleDeployment:', error);
      resolve(false);
    }
  });
}

export async function getDeploymentStatus(
  namespace: string,
  deploymentName: string,
  clusterContext?: string
): Promise<any> {
  return new Promise(resolve => {
    try {
      K8s.ResourceClasses.Deployment.apiGet(
        deployment => {
          // Return the plain object representation for compatibility
          resolve(deployment.jsonData || deployment);
        },
        deploymentName,
        namespace,
        (err: any) => {
          console.error('Error getting deployment status with Headlamp API:', err);
          resolve(null);
        },
        {
          cluster: clusterContext,
        }
      )();
    } catch (error) {
      console.error('Error in getDeploymentStatus:', error);
      resolve(null);
    }
  });
}
