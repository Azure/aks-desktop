// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import React from 'react';
import ConfigureContainer from './components/ConfigureContainer';
import ConfigureYAML from './components/ConfigureYAML';
import Deploy from './components/Deploy';
import DeployWizardPure from './components/DeployWizardPure';
import SourceStep from './components/SourceStep';
import type { ContainerConfig } from './hooks/useContainerConfiguration';
import { useDeployWizard, WizardStep } from './hooks/useDeployWizard';

/** Options accepted by the {@link DeployWizard} connector. */
type DeployWizardProps = {
  /** Target cluster passed to `apply` when deploying resources. */
  cluster?: string;
  /** Target namespace injected into generated/parsed YAML before deployment. */
  namespace?: string;
  /** Pre-fills the application-name field in the container-configuration step. */
  initialApplicationName?: string;
  initialContainerConfig?: Partial<ContainerConfig>;
  /** Called when the user clicks "Close" after a deploy result. */
  onClose?: () => void;
};

/**
 * Thin connector that wires {@link useDeployWizard} into {@link DeployWizardPure}.
 *
 * Composes the wizard state hook and the step-specific child components, then
 * passes the full state bag to the pure presentational view. All business logic
 * lives in the hook; all rendering lives in the view.
 */

export default function DeployWizard(props: DeployWizardProps) {
  const wizardState = useDeployWizard(props);

  const renderStepContent = () => {
    const {
      activeStep,
      sourceType,
      yamlEditorValue,
      yamlError,
      setYamlEditorValue,
      setYamlError,
      containerConfig,
      userPreviewYaml,
      deployResult,
      deployMessage,
    } = wizardState;

    switch (activeStep) {
      case WizardStep.SOURCE:
        return (
          <SourceStep sourceType={sourceType} onSourceTypeChange={wizardState.setSourceType} />
        );
      case WizardStep.CONFIGURE:
        return (
          <React.Fragment>
            {sourceType === 'yaml' ? (
              <ConfigureYAML
                yamlEditorValue={yamlEditorValue}
                yamlError={yamlError}
                onYamlChange={val => setYamlEditorValue(val)}
                onYamlErrorChange={err => setYamlError(err)}
              />
            ) : (
              <ConfigureContainer containerConfig={containerConfig} />
            )}
          </React.Fragment>
        );
      case WizardStep.DEPLOY:
        return (
          <Deploy
            sourceType={sourceType}
            namespace={props.namespace}
            yamlEditorValue={yamlEditorValue}
            userPreviewYaml={userPreviewYaml}
            containerPreviewYaml={containerConfig.config.containerPreviewYaml}
            deployResult={deployResult}
            deployMessage={deployMessage}
          />
        );
      default:
        return null;
    }
  };

  return (
    <DeployWizardPure
      {...wizardState}
      namespace={props.namespace}
      onClose={props.onClose}
      stepContent={renderStepContent()}
    />
  );
}
