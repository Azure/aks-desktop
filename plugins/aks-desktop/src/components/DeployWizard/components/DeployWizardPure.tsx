// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Typography,
} from '@mui/material';
import React from 'react';
import { Breadcrumb } from '../../CreateAKSProject/components/Breadcrumb';
import type { useContainerConfiguration } from '../hooks/useContainerConfiguration';
import { WizardStep } from '../hooks/useDeployWizard';

/**
 * Pure presentational props for {@link DeployWizardPure}.
 * Every piece of state and every callback is passed in from outside;
 * the component contains no stateful business-logic hooks (only `useTranslation` for i18n).
 */
export interface DeployWizardPureProps {
  /** Index of the currently active step (see {@link WizardStep}). */
  activeStep: WizardStep;
  /** Selected deploy source, or `null` while the user has not yet chosen. */
  sourceType: 'yaml' | 'container' | null;
  /** Setter for {@link sourceType}. */
  setSourceType: React.Dispatch<React.SetStateAction<'yaml' | 'container' | null>>;
  /** Raw YAML text from the editor (YAML source path). */
  yamlEditorValue: string;
  /** Setter for {@link yamlEditorValue}. */
  setYamlEditorValue: React.Dispatch<React.SetStateAction<string>>;
  /** Validation error from the YAML editor, or `null` when valid. */
  yamlError: string | null;
  /** Setter for {@link yamlError}. */
  setYamlError: React.Dispatch<React.SetStateAction<string | null>>;
  /** `true` while the deploy API call is in-flight; shows a spinner on the Deploy button. */
  deploying: boolean;
  /** Outcome of the last deploy attempt, or `null` before the first attempt. */
  deployResult: 'success' | 'error' | null;
  /** Human-readable message describing the deploy outcome. */
  deployMessage: string;
  /** Namespace-overridden YAML for the YAML-source review step. */
  userPreviewYaml: string;
  /** Full container-configuration state (see `useContainerConfiguration`). */
  containerConfig: ReturnType<typeof useContainerConfiguration>;
  /** Target namespace; forwarded to child deploy step. */
  namespace?: string;
  /** Advances {@link activeStep} by one. */
  handleNext: () => void;
  /** Decrements {@link activeStep} by one. */
  handleBack: () => void;
  /** Jumps to a specific step if allowed by {@link isStepValid}. */
  handleStepClick: (step: WizardStep) => void;
  /** Validates and applies all Kubernetes resources from the current source. */
  handleDeploy: () => Promise<void>;
  /** Returns `true` when the given step has enough data to proceed. */
  isStepValid: (step: WizardStep) => boolean;
  /** Called when the user clicks "Close" after a deploy result. */
  onClose?: () => void;
  /** Step-specific content rendered inside the scrollable area (composed by the connector). */
  stepContent: React.ReactNode;
}

/**
 * Pure presentational component for the Deploy Application wizard.
 *
 * Renders the breadcrumb navigation, scrollable step area, and navigation
 * footer. The deploy button shows an accessible loading spinner while
 * `deploying` is `true` and disables itself to prevent duplicate submissions.
 * Contains no stateful hooks — all business-logic state and handlers come from {@link useDeployWizard}.
 *
 * @see {@link useDeployWizard} for the hook that drives this component.
 * @see {@link DeployWizardPureProps} for the full prop contract.
 */

export default function DeployWizardPure({
  activeStep,
  deploying,
  deployResult,
  handleBack,
  handleDeploy,
  handleNext,
  handleStepClick,
  isStepValid,
  onClose,
  stepContent,
}: DeployWizardPureProps) {
  const { t } = useTranslation();

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography
        id="deploy-wizard-dialog-title"
        variant="h4"
        gutterBottom
        sx={{ fontWeight: 600, mb: 2 }}
      >
        {t('Deploy Application')}
      </Typography>
      <Card>
        <CardContent sx={{ p: 0 }}>
          <Box>
            <Breadcrumb
              steps={[t('Source'), t('Configure'), t('Deploy')]}
              activeStep={activeStep}
              onStepClick={step => handleStepClick(step as WizardStep)}
            />
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
            {stepContent}
          </Box>
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
                    {t('Close')}
                  </Button>
                ) : (
                  /* aria-busy signals to AT that the Deploy button is performing an async
                     operation. The CircularProgress spinner is hidden with aria-hidden
                     because the button text ("Deploying...") already conveys the busy state.
                     MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy
                     MDN: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-hidden */
                  <Button
                    variant="contained"
                    onClick={handleDeploy}
                    disabled={deploying}
                    aria-busy={deploying || undefined}
                    startIcon={deploying ? <CircularProgress size={20} aria-hidden="true" /> : null}
                  >
                    {deploying ? `${t('Deploying')}...` : t('Deploy')}
                  </Button>
                )}
              </Box>
            ) : (
              <>
                <Box>
                  {activeStep > WizardStep.SOURCE && (
                    <Button variant="outlined" onClick={handleBack}>
                      {t('Back')}
                    </Button>
                  )}
                </Box>
                <Button
                  variant="contained"
                  onClick={handleNext}
                  disabled={!isStepValid(activeStep)}
                >
                  {t('Next')}
                </Button>
              </>
            )}
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
