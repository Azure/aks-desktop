/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  Headlamp,
  registerAddClusterProvider,
  registerProjectHeaderAction,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { azureCredential, getLoginStatus, initiateLogin, logout } from './azureAuth';
import RegisterAKSClusterPage from './components/AKS/RegisterAKSClusterPage';
import AzureLoginPage from './components/AzureAuth/AzureLoginPage';
import AzureProfilePage from './components/AzureAuth/AzureProfilePage';
import DeployButton from './components/Deploy/DeployButton';
import { registerProjectFeatures } from './registerProjectFeatures';
import { refreshClusterTokens } from './utils/azure/aks';
import {
  AZURE_ACCOUNT_POLL_INTERVAL_MS,
  CLUSTER_TOKEN_REFRESH_INTERVAL_MS,
} from './utils/constants/timing';

if (Headlamp.isRunningAsApp()) {
  Object.defineProperty(window, 'azureAuth', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { azureCredential, getLoginStatus, initiateLogin, logout },
  });
  registerProjectFeatures();
  registerProjectHeaderAction({
    id: 'deploy-application',
    component: ({ project }) => <DeployButton project={project} />,
  });

  (window as any).__azureAuthStatus = {
    isLoggedIn: false,
    isChecking: true,
    username: undefined,
  };

  registerSidebarEntry({
    name: 'azure-profile',
    url: '/azure/profile',
    icon: 'mdi:account-circle',
    parent: null,
    label: 'Azure Account',
    useClusterURL: false,
    sidebar: 'HOME',
  });

  let currentUsername: string | null = null;
  const updateAzureAccountLabel = async () => {
    try {
      const status = await getLoginStatus();
      (window as any).__azureAuthStatus = { ...status, isChecking: false };
      const displayName =
        status.isLoggedIn && status.username ? status.username.split('@')[0] : null;

      if (displayName !== currentUsername) {
        currentUsername = displayName;
        registerSidebarEntry({
          name: 'azure-profile',
          url: '/azure/profile',
          icon: 'mdi:account-circle',
          parent: null,
          label: displayName || 'Azure Account',
          useClusterURL: false,
          sidebar: 'HOME',
        });
      }
    } catch (error) {
      (window as any).__azureAuthStatus = {
        isLoggedIn: false,
        isChecking: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  void updateAzureAccountLabel();
  window.addEventListener('azure-auth-update', updateAzureAccountLabel);
  window.addEventListener('focus', updateAzureAccountLabel);
  setInterval(updateAzureAccountLabel, AZURE_ACCOUNT_POLL_INTERVAL_MS);

  void refreshClusterTokens();
  setInterval(refreshClusterTokens, CLUSTER_TOKEN_REFRESH_INTERVAL_MS);

  registerRoute({
    path: '/azure/login',
    component: () => <AzureLoginPage />,
    name: 'Azure Login',
    exact: true,
    sidebar: { item: 'azure-profile', sidebar: 'HOME' },
    noAuthRequired: true,
    useClusterURL: false,
  });

  registerRoute({
    path: '/azure/profile',
    component: AzureProfilePage,
    name: 'Azure Profile',
    sidebar: { sidebar: 'HOME', item: 'azure-profile' },
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
  });

  registerAddClusterProvider({
    title: 'Azure Kubernetes Service',
    // @ts-ignore registerAddClusterProvider currently types icon as a component.
    icon: 'logos:microsoft-azure',
    description:
      'Connect to an existing AKS cluster from your Azure subscription. Requires Azure authentication.',
    url: '/add-cluster-aks',
  });

  registerRoute({
    path: '/add-cluster-aks',
    component: RegisterAKSClusterPage,
    name: 'Register AKS Cluster',
    sidebar: null,
    exact: true,
    useClusterURL: false,
    noAuthRequired: true,
  });
}
