// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  registerCustomCreateProject,
  registerProjectDeleteButton,
  registerProjectDetailsTab,
  registerProjectOverviewSection,
  registerRoute,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { Redirect } from 'react-router-dom';
import AccessTab from './components/AccessTab/AccessTab';
import ClusterCapabilityCard from './components/ClusterCapabilityCard/ClusterCapabilityCard';
import CreateAKSProject from './components/CreateAKSProject/CreateAKSProject';
import CreateNamespace from './components/CreateNamespace/CreateNamespace';
import AKSProjectDeleteButton from './components/DeleteAKSProject/AKSProjectDeleteButton';
import ImportAKSProjects from './components/ImportAKSProjects/ImportAKSProjects';
import InfoTab from './components/InfoTab/InfoTab';
import LogsTab from './components/LogsTab/LogsTab';
import MetricsCard from './components/Metrics/MetricsCard';
import MetricsTab from './components/Metrics/MetricsTab';
import ScalingCard from './components/Scaling/ScalingCard';
import ScalingTab from './components/Scaling/ScalingTab';
import {
  isAksProject,
  isAksProjectWithResourceGroup,
  isArmManagedProject,
} from './utils/shared/isAksProject';

/** Registers project creation routes and AKS managed namespace extensions. */
export function registerProjectFeatures() {
  registerRoute({
    path: '/projects/create-namespace',
    component: CreateNamespace,
    name: 'Create New Namespace',
    sidebar: { sidebar: 'HOME', item: 'projects' },
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
  });

  registerCustomCreateProject({
    id: 'create-namespace',
    name: 'Create New Namespace',
    description: 'New namespace with resources as a project',
    component: () => <Redirect to="/projects/create-namespace" />,
    icon: 'mdi:folder-add',
  });

  registerRoute({
    path: '/projects/create-aks-project',
    component: CreateAKSProject,
    name: 'Create a new AKS project',
    sidebar: { sidebar: 'HOME', item: 'projects' },
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
  });

  registerRoute({
    path: '/projects/import-aks-projects',
    component: ImportAKSProjects,
    name: 'Import AKS Projects',
    sidebar: { sidebar: 'HOME', item: 'projects' },
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
  });

  registerCustomCreateProject({
    id: 'use-existing-namespace',
    name: 'Use Existing Namespace(s)',
    description: 'Select namespaces to use as a project',
    component: () => <Redirect to="/projects/import-aks-projects" />,
    icon: 'mdi:import',
  });

  registerCustomCreateProject({
    id: 'create-aks-managed-namespace',
    name: 'Create New AKS Managed Namespace',
    description: 'Create new AKS managed namespace and use as a project',
    component: () => <Redirect to="/projects/create-aks-project" />,
    icon: 'logos:microsoft-azure',
  });

  registerProjectDetailsTab({
    id: 'info',
    label: 'Info',
    icon: 'mdi:information',
    isEnabled: isAksProjectWithResourceGroup,
    component: ({ project }) => <InfoTab project={project} />,
  });

  registerProjectDetailsTab({
    id: 'logs',
    label: 'Logs',
    icon: 'mdi:text-box-multiple-outline',
    isEnabled: isAksProject,
    component: ({ projectResources }) => <LogsTab projectResources={projectResources} />,
  });

  registerProjectDetailsTab({
    id: 'metrics',
    label: 'Metrics',
    icon: 'mdi:chart-line',
    isEnabled: isAksProject,
    component: ({ project }) => <MetricsTab project={project} />,
  });

  registerProjectDetailsTab({
    id: 'scaling',
    label: 'Scaling',
    icon: 'mdi:chart-timeline-variant',
    isEnabled: isAksProject,
    component: ({ project }) => <ScalingTab project={project} />,
  });

  registerProjectDetailsTab({
    id: 'headlamp-projects.tabs.access',
    label: 'Access',
    icon: 'mdi:account-lock',
    isEnabled: isArmManagedProject,
    component: ({ project }) => <AccessTab project={project} />,
  });

  registerProjectOverviewSection({
    id: 'cluster-capabilities',
    // @ts-expect-error isEnabled exists at runtime but is missing from ProjectOverviewSection types
    isEnabled: isAksProject,
    component: ({ project }) => <ClusterCapabilityCard project={project} />,
  });

  registerProjectOverviewSection({
    id: 'scaling-overview',
    // @ts-expect-error isEnabled exists at runtime but is missing from ProjectOverviewSection types
    isEnabled: isAksProject,
    component: ({ project }) => <ScalingCard project={project} />,
  });

  registerProjectOverviewSection({
    id: 'metrics-overview',
    // @ts-expect-error isEnabled exists at runtime but is missing from ProjectOverviewSection types
    isEnabled: isAksProject,
    component: ({ project }) => <MetricsCard project={project} />,
  });

  registerProjectDeleteButton({
    isEnabled: isArmManagedProject,
    component: ({ project }) => <AKSProjectDeleteButton project={project} />,
  });
}
