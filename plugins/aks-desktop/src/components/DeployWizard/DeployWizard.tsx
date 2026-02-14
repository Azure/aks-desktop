// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { apply } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import YAML from 'yaml';
import type { GitHubRepo } from '../../types/github';
import { Breadcrumb } from '../CreateAKSProject/components/Breadcrumb';
import GitHubPipelineWizard from '../GitHubPipeline/GitHubPipelineWizard';
import ConfigureContainer from './components/ConfigureContainer';
import ConfigureYAML from './components/ConfigureYAML';
import Deploy from './components/Deploy';
import SourceStep from './components/SourceStep';
import { useContainerConfiguration } from './hooks/useContainerConfiguration';
import { applyNamespaceOverride } from './utils/namespaceOverride';
import { generateYamlForContainer } from './utils/yamlGenerator';

type DeployWizardProps = {
  cluster?: string;
  namespace?: string;
  initialApplicationName?: string;
  azureContext?: { subscriptionId: string; resourceGroup: string; tenantId: string };
  onClose?: () => void;
  /** Pre-selected repo to resume an in-progress pipeline. */
  resumePipelineRepo?: GitHubRepo;
};

enum WizardStep {
  SOURCE = 0,
  CONFIGURE = 1,
  DEPLOY = 2,
}

const STEP_NAMES: string[] = ['Source', 'Configure', 'Deploy'];

const FEATURE_FLAG_GITHUB_PIPELINE = 'aks-desktop:feature:github-pipeline';
const isGitHubPipelineEnabled = (): boolean =>
  localStorage.getItem(FEATURE_FLAG_GITHUB_PIPELINE) === 'true';

export default function DeployWizard({
  cluster,
  namespace,
  initialApplicationName,
  azureContext,
  onClose,
  resumePipelineRepo,
}: DeployWizardProps) {
  const [activeStep, setActiveStep] = useState(
    resumePipelineRepo ? WizardStep.DEPLOY : WizardStep.SOURCE
  );
  const [sourceType, setSourceType] = useState<null | 'yaml' | 'container'>(
    resumePipelineRepo ? 'container' : null
  );
  const [showPipeline, setShowPipeline] = useState(!!resumePipelineRepo);
  const [yamlEditorValue, setYamlEditorValue] = useState<string>('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<null | 'success' | 'error'>(null);
  const [deployMessage, setDeployMessage] = useState<string>('');
  const [userPreviewYaml, setUserPreviewYaml] = useState<string>('');

  // Container configuration state
  const containerConfig = useContainerConfiguration(initialApplicationName);

  // Generate container preview YAML when entering the Deploy step.
  // Uses a ref to compare against the previous preview to avoid infinite re-renders
  // (setConfig creates a new object, which would re-trigger this effect).
  const prevContainerPreviewRef = React.useRef<string>('');
  useEffect(() => {
    if (activeStep === WizardStep.DEPLOY && sourceType === 'container') {
      const preview = generateYamlForContainer({
        ...containerConfig.config,
        namespace,
      });
      if (preview !== prevContainerPreviewRef.current) {
        prevContainerPreviewRef.current = preview;
        containerConfig.setConfig(prev => ({
          ...prev,
          containerPreviewYaml: preview,
        }));
      }
    }
    // Generate preview with namespace override for user YAML in the Review step
    if (activeStep === WizardStep.DEPLOY && sourceType === 'yaml') {
      try {
        const text = yamlEditorValue;
        const docs = YAML.parseAllDocuments(text).filter(d => d && d.contents);
        const processed = docs
          .map(d => d.toJSON())
          .filter(Boolean)
          .map(obj => applyNamespaceOverride(obj, namespace))
          .map(obj => YAML.stringify(obj).trim());
        setUserPreviewYaml(processed.join('\n---\n'));
      } catch (e) {
        // If parsing fails, fall back to raw
        setUserPreviewYaml(yamlEditorValue);
      }
    }
    // When leaving the Review step, clear any previous deploy result/message
    if (activeStep !== WizardStep.DEPLOY) {
      setDeployResult(null);
      setDeployMessage('');
      setDeploying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, sourceType, namespace, yamlEditorValue, containerConfig.config]);

  const isStepValid = (step: WizardStep): boolean => {
    switch (step) {
      case WizardStep.SOURCE:
        return sourceType !== null;
      case WizardStep.CONFIGURE:
        if (sourceType === 'yaml') {
          return yamlEditorValue.trim().length > 0;
        }
        if (sourceType === 'container') {
          return (
            containerConfig.config.appName.trim().length > 0 &&
            containerConfig.config.containerImage.trim().length > 0
          );
        }
        return false;
      case WizardStep.DEPLOY:
        return isStepValid(WizardStep.SOURCE) && isStepValid(WizardStep.CONFIGURE);
      default:
        return true;
    }
  };

  const handleNext = () => setActiveStep(s => Math.min(s + 1, WizardStep.DEPLOY));
  const handleBack = () => setActiveStep(s => Math.max(s - 1, WizardStep.SOURCE));
  const handleStepClick = (step: number) => {
    // Only allow clicking on the current step or previous steps that are valid
    if (step <= activeStep || isStepValid(step as WizardStep)) {
      setActiveStep(step);
    }
  };

  const handleDeploy = async () => {
    try {
      setYamlError(null);
      setDeployResult(null);
      setDeployMessage('');
      setDeploying(true);

      const text =
        sourceType === 'container' ? containerConfig.config.containerPreviewYaml : yamlEditorValue;

      // Validate YAML before deploying
      let parsedDocs;
      try {
        parsedDocs = YAML.parseAllDocuments(text);
        // Validate each document
        for (const doc of parsedDocs) {
          const json = doc.toJSON();
          if (!json || !json.kind || !json.metadata?.name) {
            throw new Error('Invalid YAML: missing required fields (kind or metadata.name)');
          }
        }
      } catch (e: any) {
        setYamlError(e?.message || 'Invalid YAML');
        setDeployResult('error');
        setDeployMessage(e?.message || 'Invalid YAML');
        setDeploying(false);
        return;
      }

      const docs = parsedDocs
        .map(d => d.toJSON())
        .filter(Boolean)
        .map(obj => (sourceType === 'yaml' ? applyNamespaceOverride(obj, namespace) : obj));

      let applied = 0;
      for (const resource of docs) {
        if (!resource || typeof resource !== 'object') continue;
        await apply(resource as any, cluster);
        applied++;
      }
      setDeployResult('success');
      setDeployMessage(`Applied ${applied} resource${applied === 1 ? '' : 's'} successfully.`);
    } catch (e: any) {
      setDeployResult('error');
      setDeployMessage(e?.message || 'Failed to apply resources.');
    } finally {
      setDeploying(false);
    }
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case WizardStep.SOURCE:
        return <SourceStep sourceType={sourceType} onSourceTypeChange={setSourceType} />;
      case WizardStep.CONFIGURE:
        return (
          <Box>
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
          </Box>
        );
      case WizardStep.DEPLOY:
        if (showPipeline) {
          return !azureContext ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : (
            <GitHubPipelineWizard
              clusterName={cluster || ''}
              namespace={namespace || ''}
              appName={containerConfig.config.appName || initialApplicationName || ''}
              subscriptionId={azureContext.subscriptionId}
              resourceGroup={azureContext.resourceGroup}
              tenantId={azureContext.tenantId}
              onClose={() => setShowPipeline(false)}
              initialRepo={resumePipelineRepo}
              containerConfig={containerConfig.config}
            />
          );
        }
        return (
          <Deploy
            sourceType={sourceType}
            namespace={namespace}
            yamlEditorValue={yamlEditorValue}
            userPreviewYaml={userPreviewYaml}
            containerPreviewYaml={containerConfig.config.containerPreviewYaml}
            deployResult={deployResult}
            deployMessage={deployMessage}
            showGitHubPipeline={isGitHubPipelineEnabled() && sourceType === 'container'}
            onSetupGitHubPipeline={() => setShowPipeline(true)}
          />
        );
      default:
        return null;
    }
  };

  return (
    // Todo: noScroll could be done like this? <Container maxWidth="lg" sx={{ py: 3, overflow: 'hidden' }}>
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 2 }}>
        Deploy Application
      </Typography>
      <Card>
        <CardContent sx={{ p: 0 }}>
          <Box>
            <Breadcrumb steps={STEP_NAMES} activeStep={activeStep} onStepClick={handleStepClick} />
          </Box>
          <Box
            sx={{
              height: '55vh',
              overflowY: 'auto',
              overflowX: 'hidden',
              px: 3,
              pt: 3,
            }}
          >
            {renderStepContent()}
          </Box>
          {/* Hide button bar when GitHub Pipeline wizard is active — it has its own navigation */}
          {showPipeline && activeStep === WizardStep.DEPLOY ? null : (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                px: 3,
                py: 3,
                borderTop: '1px solid',
                borderColor: 'divider',
                marginTop: 2,
              }}
            >
              {activeStep === WizardStep.DEPLOY ? (
                <Box sx={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
                  {deployResult ? (
                    <Button variant="contained" onClick={onClose}>
                      Close
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      onClick={handleDeploy}
                      disabled={deploying}
                      startIcon={deploying ? <CircularProgress size={20} /> : null}
                    >
                      {deploying ? 'Deploying...' : 'Deploy'}
                    </Button>
                  )}
                </Box>
              ) : (
                <>
                  <Box>
                    {activeStep > WizardStep.SOURCE && (
                      <Button variant="outlined" onClick={handleBack}>
                        Back
                      </Button>
                    )}
                  </Box>
                  <Button
                    variant="contained"
                    onClick={handleNext}
                    disabled={!isStepValid(activeStep)}
                  >
                    Next
                  </Button>
                </>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
