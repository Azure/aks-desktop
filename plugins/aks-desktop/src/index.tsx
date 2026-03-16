// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  Headlamp,
  registerAddClusterProvider,
  registerAppBarAction,
  registerAppLogo,
  registerAppTheme,
  registerCustomCreateProject,
  registerPluginSettings,
  registerProjectDeleteButton,
  registerProjectDetailsTab,
  // @ts-ignore todo: registerProjectHeaderAction is not exported properly
  registerProjectHeaderAction,
  registerProjectOverviewSection,
  registerRoute,
  registerSidebarEntry,
  useTranslation,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { Redirect } from 'react-router-dom';
import RegisterAKSClusterPage from './components/AKS/RegisterAKSClusterPage';
import AzureLoginPage from './components/AzureAuth/AzureLoginPage';
import AzureProfilePage from './components/AzureAuth/AzureProfilePage';
import ClusterCapabilityCard from './components/ClusterCapabilityCard/ClusterCapabilityCard';
import ConfigurePipelineButton from './components/ConfigurePipeline/ConfigurePipelineButton';
import CreateAKSProject from './components/CreateAKSProject/CreateAKSProject';
import CreateNamespace from './components/CreateNamespace/CreateNamespace';
import AKSProjectDeleteButton from './components/DeleteAKSProject/AKSProjectDeleteButton';
import DeployButton from './components/Deploy/DeployButton';
import PipelineCard from './components/Deployments/PipelineCard';
import DeployTab from './components/DeployTab/DeployTab';
import { GitHubAuthStatusButton } from './components/GitHubPipeline/components/GitHubAuthStatusButton';
import { GitHubAuthProvider } from './components/GitHubPipeline/GitHubAuthContext';
import ImportAKSProjects from './components/ImportAKSProjects/ImportAKSProjects';
import InfoTab from './components/InfoTab/InfoTab';
import AzureLogo from './components/Logo/Logo';
import LogsTab from './components/LogsTab/LogsTab';
import MetricsCard from './components/Metrics/MetricsCard';
import MetricsTab from './components/MetricsTab/MetricsTab';
import PreviewFeaturesSettings from './components/PluginSettings/PreviewFeaturesSettings';
import { previewFeaturesStore } from './components/PluginSettings/previewFeaturesStore';
import ScalingCard from './components/Scaling/ScalingCard';
import ScalingTab from './components/Scaling/ScalingTab';
import { getLoginStatus } from './utils/azure/az-cli';
import { isAksProject } from './utils/shared/isAksProject';
import { azureTheme } from './utils/shared/theme';

/** Stores the latest t() for use outside React component scope (e.g. event handlers). */
let tFunc: ((key: string) => string) | null = null;

function TranslatedLabel({ children }: { children: string }) {
  const { t } = useTranslation();
  return <>{t(children)}</>;
}

/** Re-registers entries with translated strings when the UI language changes. */
function TranslatedRegistrations() {
  const { t, i18n } = useTranslation();

  React.useEffect(() => {
    tFunc = t;

    Headlamp.setAppMenu(menus => {
      const helpMenu = menus?.find(menu => menu.id === 'original-help');
      if (helpMenu && helpMenu.submenu) {
        const docIndex = helpMenu.submenu.findIndex(item => item.id === 'original-documentation');
        if (docIndex !== -1) {
          helpMenu.submenu[docIndex] = {
            label: t('Documentation'),
            id: 'aks-documentation',
            url: 'https://aka.ms/aks/aks-desktop',
          };
        }
        const issueIndex = helpMenu.submenu.findIndex(item => item.id === 'original-open-issue');
        if (issueIndex !== -1) {
          helpMenu.submenu[issueIndex] = {
            label: t('Open an Issue'),
            id: 'aks-open-issue',
            url: 'https://github.com/Azure/aks-desktop/issues',
          };
        }
      }
      return menus;
    });

    registerRoute({
      path: '/azure/login',
      // @ts-ignore todo: fix component type
      component: AzureLoginPage,
      name: t('Azure Login'),
      exact: true,
      sidebar: { item: 'azure-profile', sidebar: 'HOME' },
      noAuthRequired: true,
      useClusterURL: false,
    });

    registerRoute({
      path: '/azure/profile',
      component: AzureProfilePage,
      name: t('Azure Profile'),
      sidebar: { sidebar: 'HOME', item: 'azure-profile' },
      exact: true,
      noAuthRequired: true,
      useClusterURL: false,
    });

    registerRoute({
      path: '/projects/create-aks-project',
      component: CreateAKSProject,
      name: t('Create a new AKS project'),
      sidebar: { sidebar: 'HOME', item: 'projects' },
      exact: true,
      noAuthRequired: true,
      useClusterURL: false,
    });

    registerRoute({
      path: '/projects/import-aks-projects',
      component: ImportAKSProjects,
      name: t('Import AKS Projects'),
      sidebar: { sidebar: 'HOME', item: 'projects' },
      exact: true,
      noAuthRequired: true,
      useClusterURL: false,
    });

    registerCustomCreateProject({
      id: 'use-existing-namespace',
      name: t('Use Existing Namespace(s)'),
      description: t('Select namespaces to use as a project'),
      component: () => <Redirect to="/projects/import-aks-projects" />,
      icon: 'mdi:import',
    });

    registerRoute({
      path: '/projects/create-namespace',
      component: CreateNamespace,
      name: t('Create New Namespace'),
      sidebar: { sidebar: 'HOME', item: 'projects' },
      exact: true,
      noAuthRequired: true,
      useClusterURL: false,
    });

    registerCustomCreateProject({
      id: 'create-namespace',
      name: t('Create New Namespace'),
      description: t('New namespace with resources as a project'),
      component: () => <Redirect to="/projects/create-namespace" />,
      icon: 'mdi:folder-add',
    });

    registerCustomCreateProject({
      id: 'create-aks-managed-namespace',
      name: t('Create New AKS Managed Namespace'),
      description: t('Create new AKS managed namespace and use as a project'),
      component: () => <Redirect to="/projects/create-aks-project" />,
      icon: 'logos:microsoft-azure',
    });

    registerAddClusterProvider({
      title: t('Azure Kubernetes Service'),
      // @ts-ignore todo fix registerAddClusterProvider icon to take string
      icon: 'logos:microsoft-azure',
      description: t(
        'Connect to an existing AKS (Azure Kubernetes Service) cluster from your Azure subscription. Requires Azure CLI authentication.'
      ),
      url: '/add-cluster-aks',
    });

    registerRoute({
      path: '/add-cluster-aks',
      component: RegisterAKSClusterPage,
      name: t('Register AKS Cluster'),
      sidebar: null,
      exact: true,
      useClusterURL: false,
      noAuthRequired: true,
    });

    // Re-use the existing azure-auth-update event to trigger
    // updateAzureAccountLabel, which will re-register the sidebar entry with
    // the translated 'Azure Account' label (via tFunc) when not logged in.
    window.dispatchEvent(new Event('azure-auth-update'));
  }, [i18n.language, t]);

  return null;
}

Headlamp.setAppMenu(menus => {
  // Find the Help menu
  const helpMenu = menus?.find(menu => menu.id === 'original-help');

  if (helpMenu && helpMenu.submenu) {
    // Replace Documentation link
    const docIndex = helpMenu.submenu.findIndex(item => item.id === 'original-documentation');
    if (docIndex !== -1) {
      helpMenu.submenu[docIndex] = {
        label: 'Documentation',
        id: 'aks-documentation',
        url: 'https://aka.ms/aks/aks-desktop',
      };
    }

    // Replace Open Issue link
    const issueIndex = helpMenu.submenu.findIndex(item => item.id === 'original-open-issue');
    if (issueIndex !== -1) {
      helpMenu.submenu[issueIndex] = {
        label: 'Open an Issue',
        id: 'aks-open-issue',
        url: 'https://github.com/Azure/aks-desktop/issues',
      };
    }
  }

  return menus;
});

// add azure related components only if running as app
if (Headlamp.isRunningAsApp()) {
  // register azure logo
  registerAppLogo(AzureLogo);

  // register the theme and make it default
  registerAppTheme(azureTheme);
  if (!localStorage.getItem('headlampThemePreference')) {
    localStorage.setItem('headlampThemePreference', 'Azure Theme');
    localStorage.setItem('cached-current-theme', `${azureTheme}`);
  }

  // Initialize Azure auth status on window object for Headlamp integration
  (window as any).__azureAuthStatus = {
    isLoggedIn: false,
    isChecking: true,
    username: undefined,
  };

  // Azure Profile (in main sidebar)
  registerSidebarEntry({
    name: 'azure-profile',
    url: '/azure/profile',
    icon: 'mdi:account-circle',
    parent: null,
    label: 'Azure Account',
    useClusterURL: false,
    sidebar: 'HOME',
  });

  // Update Azure Account label based on login status
  let currentUsername: string | null = null;

  const updateAzureAccountLabel = async () => {
    try {
      const status = await getLoginStatus();

      // Expose auth status to window object for headlamp components
      (window as any).__azureAuthStatus = {
        isLoggedIn: status.isLoggedIn,
        isChecking: false,
        username: status.username,
        tenantId: status.tenantId,
        subscriptionId: status.subscriptionId,
        error: status.error,
      };

      if (status.isLoggedIn && status.username) {
        const displayName = status.username.split('@')[0];
        if (currentUsername !== displayName) {
          currentUsername = displayName;
          registerSidebarEntry({
            name: 'azure-profile',
            url: '/azure/profile',
            icon: 'mdi:account-circle',
            parent: null,
            label: displayName,
            useClusterURL: false,
            sidebar: 'HOME',
          });
        }
      } else if (currentUsername !== null) {
        currentUsername = null;
        registerSidebarEntry({
          name: 'azure-profile',
          url: '/azure/profile',
          icon: 'mdi:account-circle',
          parent: null,
          label: tFunc ? tFunc('Azure Account') : 'Azure Account',
          useClusterURL: false,
          sidebar: 'HOME',
        });
      }
    } catch (error) {
      // Update auth status to indicate error/not logged in
      (window as any).__azureAuthStatus = {
        isLoggedIn: false,
        isChecking: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  // Check initially
  updateAzureAccountLabel();

  // Listen for custom events from login/logout operations
  window.addEventListener('azure-auth-update', updateAzureAccountLabel);

  // Check when window regains focus (user might have logged in/out externally)
  let isWindowFocused = document.hasFocus();
  window.addEventListener('focus', () => {
    if (!isWindowFocused) {
      isWindowFocused = true;
      updateAzureAccountLabel();
    }
  });
  window.addEventListener('blur', () => {
    isWindowFocused = false;
  });

  // Fallback: Check periodically with a longer interval (30 seconds) as a safety net
  setInterval(updateAzureAccountLabel, 30000); // Check every 30 seconds

  // Register Azure authentication routes
  registerRoute({
    path: '/azure/login',
    // @ts-ignore todo: fix component type
    component: AzureLoginPage,
    name: 'Azure Login',
    exact: true,
    sidebar: {
      item: 'azure-profile',
      sidebar: 'HOME',
    },
    noAuthRequired: true, // This route doesn't require auth
    useClusterURL: false,
  });

  registerRoute({
    path: '/azure/profile',
    component: AzureProfilePage,
    name: 'Azure Profile',
    sidebar: {
      sidebar: 'HOME',
      item: 'azure-profile',
    },
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
  });

  registerRoute({
    path: '/projects/create-aks-project',
    component: CreateAKSProject,
    name: 'Create a new AKS project',
    sidebar: {
      sidebar: 'HOME',
      item: 'projects',
    },
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
  });

  registerRoute({
    path: '/projects/import-aks-projects',
    component: ImportAKSProjects,
    name: 'Import AKS Projects',
    sidebar: {
      sidebar: 'HOME',
      item: 'projects',
    },
    exact: true,
    noAuthRequired: true,
    useClusterURL: false,
  });

  // Override built-in "Use Existing Namespace(s)" with enhanced AKS version
  // that discovers both managed namespaces (via Azure Resource Graph) and regular namespaces
  registerCustomCreateProject({
    id: 'use-existing-namespace',
    name: 'Use Existing Namespace(s)',
    description: 'Select namespaces to use as a project',
    component: () => <Redirect to="/projects/import-aks-projects" />,
    icon: 'mdi:import',
  });

  // Override built-in "Create New Namespace" with AKS-aware version
  registerRoute({
    path: '/projects/create-namespace',
    component: CreateNamespace,
    name: 'Create New Namespace',
    sidebar: {
      sidebar: 'HOME',
      item: 'projects',
    },
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

  // AKS-specific: Create new managed namespace via Azure
  registerCustomCreateProject({
    id: 'create-aks-managed-namespace',
    name: 'Create New AKS Managed Namespace',
    description: 'Create new AKS managed namespace and use as a project',
    component: () => <Redirect to="/projects/create-aks-project" />,
    icon: 'logos:microsoft-azure',
  });

  // Register AKS as a cluster provider in the "Add Cluster" page
  registerAddClusterProvider({
    title: 'Azure Kubernetes Service',
    // @ts-ignore todo fix registerAddClusterProvider icon to take string
    icon: 'logos:microsoft-azure',
    description:
      'Connect to an existing AKS (Azure Kubernetes Service) cluster from your Azure subscription. Requires Azure CLI authentication.',
    url: '/add-cluster-aks',
  });

  // Register route for the AKS cluster registration dialog
  registerRoute({
    path: '/add-cluster-aks',
    component: RegisterAKSClusterPage,
    name: 'Register AKS Cluster',
    sidebar: null,
    exact: true,
    useClusterURL: false,
    noAuthRequired: true,
  });

  // Re-register translatable entries when UI language changes
  registerAppBarAction(TranslatedRegistrations);
}

registerPluginSettings('aks-desktop', PreviewFeaturesSettings, false);

registerProjectOverviewSection({
  id: 'cluster-capabilities',
  // @ts-ignore todo: there is an isEnabled prop in registerProjectOverviewSection it's just not present in the types yet. We need to push our changes to headlamp
  isEnabled: isAksProject,
  component: ({ project }) => <ClusterCapabilityCard project={project} />,
});

registerProjectOverviewSection({
  id: 'scaling-overview',
  // @ts-ignore todo: there is an isEnabled prop in registerProjectOverviewSection it's just not present in the types yet. We need to push our changes to headlamp
  isEnabled: isAksProject,
  component: ({ project }) => <ScalingCard project={project} />,
});

registerProjectOverviewSection({
  id: 'metrics-overview',
  // @ts-ignore todo: there is an isEnabled prop in registerProjectOverviewSection it's just not present in the types yet. We need to push our changes to headlamp
  isEnabled: isAksProject,
  component: ({ project }) => <MetricsCard project={project} />,
});

registerProjectOverviewSection({
  id: 'pipeline-overview',
  // @ts-expect-error isEnabled exists at runtime but is missing from ProjectOverviewSection types
  isEnabled: props =>
    previewFeaturesStore.get().githubPipelines ? isAksProject(props) : Promise.resolve(false),
  // GitHubAuthProvider is duplicated across three registrations (here, DeployTab, and
  // ConfigurePipelineButton) because Headlamp renders each registered component in an
  // independent React tree — there is no shared ancestor to hoist the provider into.
  // Token state is shared across instances via localStorage inside useGitHubAuth.
  component: ({ project }) => (
    <GitHubAuthProvider>
      <PipelineCard project={project} />
    </GitHubAuthProvider>
  ),
});

registerProjectDetailsTab({
  id: 'info',
  label: <TranslatedLabel>Info</TranslatedLabel>,
  icon: 'mdi:information',
  component: ({ project }) => <InfoTab project={project} />,
});

registerProjectDetailsTab({
  id: 'deploy',
  label: <TranslatedLabel>Deploy</TranslatedLabel>,
  icon: 'mdi:cloud-upload',
  isEnabled: isAksProject,
  component: ({ project }) => (
    <GitHubAuthProvider>
      <DeployTab project={project} />
    </GitHubAuthProvider>
  ),
});

registerProjectDetailsTab({
  id: 'logs',
  label: <TranslatedLabel>Logs</TranslatedLabel>,
  icon: 'mdi:text-box-multiple-outline',
  component: LogsTab,
});

registerProjectDetailsTab({
  id: 'metrics',
  label: <TranslatedLabel>Metrics</TranslatedLabel>,
  icon: 'mdi:chart-line',
  isEnabled: isAksProject,
  component: ({ project }) => <MetricsTab project={project} />,
});

registerProjectDetailsTab({
  id: 'scaling',
  label: <TranslatedLabel>Scaling</TranslatedLabel>,
  icon: 'mdi:chart-timeline-variant',
  isEnabled: isAksProject,
  component: ({ project }) => <ScalingTab project={project} />,
});

// Register Deploy Application button in project header
registerProjectHeaderAction({
  id: 'deploy-application',
  component: ({ project }) => <DeployButton project={project} />,
});

registerProjectHeaderAction({
  id: 'github-auth-status',
  component: () => (
    <GitHubAuthProvider>
      <GitHubAuthStatusButton />
    </GitHubAuthProvider>
  ),
});

registerProjectHeaderAction({
  id: 'configure-pipeline',
  component: ({ project }) => (
    <GitHubAuthProvider>
      <ConfigurePipelineButton project={project} />
    </GitHubAuthProvider>
  ),
});

// Register custom delete button for AKS projects only
registerProjectDeleteButton({
  isEnabled: isAksProject,
  component: ({ project }) => <AKSProjectDeleteButton project={project} />,
});
