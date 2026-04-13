// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React from 'react';
import { useHistory } from 'react-router-dom';
import AzureAuthGuard from '../AzureAuth/AzureAuthGuard';
import { ComputeStep } from '../shared/ComputeStep';
import { NetworkingStep } from '../shared/NetworkingStep';
import { AccessStep } from './components/AccessStep';
import { BasicsStep } from './components/BasicsStep';
import CreateAKSProjectPure from './components/CreateAKSProjectPure';
import { ReviewStep } from './components/ReviewStep';
import { useCreateAKSProjectWizard } from './hooks/useCreateAKSProjectWizard';

/**
 * Thin connector for the Create AKS Project wizard.
 *
 * Composes {@link useCreateAKSProjectWizard} (all state and async logic) with
 * {@link CreateAKSProjectPure} (pure presentational rendering). The connector's
 * only responsibilities are:
 * - Rendering each step's child component via `renderStepContent`.
 * - Mapping router actions (`history.push`) to the pure component's callbacks.
 * - Wrapping the whole page in {@link AzureAuthGuard} to gate authentication.
 */
function CreateAKSProject() {
  const history = useHistory();
  const wizard = useCreateAKSProjectWizard();

  const renderStepContent = (step: number) => {
    const commonProps = {
      formData: wizard.formData,
      onFormDataChange: wizard.updateFormData,
      validation: wizard.validation,
      loading: wizard.azureResources.loading,
      error: wizard.azureResources.error,
    };
    switch (step) {
      case 0:
        return (
          <BasicsStep
            {...commonProps}
            subscriptions={wizard.azureResources.subscriptions}
            clusters={wizard.azureResources.clusters}
            totalClusterCount={wizard.azureResources.totalClusterCount}
            loadingClusters={wizard.azureResources.loadingClusters}
            clusterError={wizard.azureResources.clusterError}
            extensionStatus={wizard.extensionStatus}
            featureStatus={wizard.featureStatus}
            namespaceStatus={wizard.namespaceCheck}
            clusterCapabilities={wizard.clusterCapabilities.capabilities}
            capabilitiesLoading={wizard.clusterCapabilities.loading}
            onInstallExtension={wizard.extensionStatus.installExtension}
            onRegisterFeature={wizard.featureStatus.registerFeature}
            onRetrySubscriptions={async () => {
              await wizard.azureResources.fetchSubscriptions();
            }}
            onRetryClusters={async () => {
              await wizard.azureResources.fetchClusters(wizard.formData.subscription);
            }}
            onRefreshCapabilities={() => {
              if (
                wizard.formData.cluster &&
                wizard.formData.subscription &&
                wizard.formData.resourceGroup
              ) {
                wizard.clusterCapabilities.fetchCapabilities(
                  wizard.formData.subscription,
                  wizard.formData.resourceGroup,
                  wizard.formData.cluster
                );
              }
            }}
          />
        );
      case 1:
        return <NetworkingStep {...commonProps} />;
      case 2:
        return <ComputeStep {...commonProps} />;
      case 3:
        return <AccessStep {...commonProps} />;
      case 4:
        return (
          <ReviewStep
            {...commonProps}
            subscriptions={wizard.azureResources.subscriptions}
            clusters={wizard.azureResources.clusters}
          />
        );
      default:
        return null;
    }
  };

  return (
    <AzureAuthGuard>
      <CreateAKSProjectPure
        {...wizard}
        azureResourcesLoading={wizard.azureResources.loading}
        projectName={wizard.formData.projectName}
        onNavigateToProject={url => history.push(url)}
        onDismissError={() => {
          wizard.setCreationError(null);
          wizard.setCreationProgress('');
          wizard.onBack();
        }}
        onCancelSuccess={() => {
          wizard.setShowSuccessDialog(false);
          wizard.onBack();
        }}
        stepContent={renderStepContent(wizard.activeStep)}
      />
    </AzureAuthGuard>
  );
}

export default CreateAKSProject;
