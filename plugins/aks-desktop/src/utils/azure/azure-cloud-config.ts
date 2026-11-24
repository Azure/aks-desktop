// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export type NativeCloudName = 'AzureCloud' | 'AzureUSGovernment' | 'AzureChinaCloud';

export interface NativeCloudConfiguration {
  name: NativeCloudName;
  authority: string;
  deviceLoginUrl: string;
  arm: { endpoint: string; scope: string };
  graph: { endpoint: string; scope: string };
}

const configurations: Record<NativeCloudName, NativeCloudConfiguration> = {
  AzureCloud: {
    name: 'AzureCloud',
    authority: 'https://login.microsoftonline.com',
    deviceLoginUrl: 'https://microsoft.com/devicelogin',
    arm: {
      endpoint: 'https://management.azure.com',
      scope: 'https://management.core.windows.net//.default',
    },
    graph: {
      endpoint: 'https://graph.microsoft.com',
      scope: 'https://graph.microsoft.com/.default',
    },
  },
  AzureUSGovernment: {
    name: 'AzureUSGovernment',
    authority: 'https://login.microsoftonline.us',
    deviceLoginUrl: 'https://microsoft.com/devicelogin',
    arm: {
      endpoint: 'https://management.usgovcloudapi.net',
      scope: 'https://management.core.usgovcloudapi.net//.default',
    },
    graph: {
      endpoint: 'https://graph.microsoft.us',
      scope: 'https://graph.microsoft.us/.default',
    },
  },
  AzureChinaCloud: {
    name: 'AzureChinaCloud',
    authority: 'https://login.chinacloudapi.cn',
    deviceLoginUrl: 'https://microsoft.com/devicelogin',
    arm: {
      endpoint: 'https://management.chinacloudapi.cn',
      scope: 'https://management.core.chinacloudapi.cn//.default',
    },
    graph: {
      endpoint: 'https://microsoftgraph.chinacloudapi.cn',
      scope: 'https://microsoftgraph.chinacloudapi.cn/.default',
    },
  },
};

/** Returns built-in native login metadata, rejecting unsupported or custom CLI clouds. */
export function getNativeCloudConfiguration(name: string = 'AzureCloud'): NativeCloudConfiguration {
  if (!Object.prototype.hasOwnProperty.call(configurations, name)) {
    throw new Error(`Unsupported Azure cloud for native login: ${name}`);
  }
  return configurations[name as NativeCloudName];
}
