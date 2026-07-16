// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { trackError, trackFeature } from '../../../telemetry';
import { checkNamespaceExists } from '../../../utils/azure/az-namespace-access';
import { createManagedNamespace } from '../../../utils/azure/az-namespaces';
import { checkAzureCliAndAksPreview } from '../../../utils/azure/checkAzureCli';
import { assignRolesToNamespace } from '../../../utils/azure/roleAssignment';
import {
  PROJECT_ID_LABEL,
  PROJECT_MANAGED_BY_LABEL,
  PROJECT_MANAGED_BY_VALUE,
  RESOURCE_GROUP_LABEL,
  SUBSCRIPTION_LABEL,
} from '../../../utils/constants/projectLabels';
import { STEPS } from '../types';
import { useAzureResources } from './useAzureResources';
import { useClusterCapabilities } from './useClusterCapabilities';
import { useExtensionCheck } from './useExtensionCheck';
import { useFeatureCheck } from './useFeatureCheck';
import { useFormData } from './useFormData';
import { useNamespaceCheck } from './useNamespaceCheck';
import { useValidation } from './useValidation';

/** Set to `true` locally to enable verbose debug logging. Never enable in production. */
const DEBUG = false;

function safelyTrackFeature(properties: Parameters<typeof trackFeature>[0]) {
  try {
    trackFeature(properties);
  } catch {}
}

function safelyTrackError(properties: Parameters<typeof trackError>[0]) {
  try {
    trackError(properties);
  } catch {}
}

/**
 * All state and handlers returned by {@link useCreateAKSProjectWizard}.
 * Pass the whole object (plus a few derived values) into
 * {@link CreateAKSProjectPure} as props.
 */
export interface UseCreateAKSProjectWizardResult {
  // ── Step navigation ──────────────────────────────────────────────────────
  /** Zero-based index of the currently visible wizard step. */
  activeStep: number;
  /** Ordered step labels used to render the breadcrumb navigation bar. */
  steps: typeof STEPS;
  /** Advances `activeStep` and clears any Azure resource errors. */
  handleNext: () => void;
  /** Decrements `activeStep`. */
  handleBack: () => void;
  /** Jumps directly to `step`. */
  handleStepClick: (step: number) => void;
  /**
   * Submits the project-creation form.  Creates the managed namespace,
   * polls for readiness, assigns user roles, and updates the creation
   * overlay state throughout.  A 10-minute timeout guard prevents silent hangs.
   */
  handleSubmit: () => Promise<void>;
  /** Navigates back to the home route (`/`). */
  onBack: () => void;

  // ── Creation-overlay state ────────────────────────────────────────────────
  /** `true` while the namespace-creation request is in-flight. */
  isCreating: boolean;
  /** Status message updated at each stage of the creation process. */
  creationProgress: string;
  /** Error message if creation failed, or `null` when not in an error state. */
  creationError: string | null;
  /** Direct setter for {@link creationError} (used by the connector to dismiss the overlay). */
  setCreationError: React.Dispatch<React.SetStateAction<string | null>>;
  /** Direct setter for {@link creationProgress} (used by the connector to clear on dismiss). */
  setCreationProgress: React.Dispatch<React.SetStateAction<string>>;
  /** `true` when the project was created successfully and the success dialog is open. */
  showSuccessDialog: boolean;
  /** Direct setter for {@link showSuccessDialog}. */
  setShowSuccessDialog: React.Dispatch<React.SetStateAction<boolean>>;
  /** Name of the first application entered by the user in the success dialog. */
  applicationName: string;
  /** Setter for {@link applicationName}. */
  setApplicationName: React.Dispatch<React.SetStateAction<string>>;

  // ── CLI suggestions ───────────────────────────────────────────────────────
  /**
   * Warning messages returned by `checkAzureCliAndAksPreview` on mount.
   * Non-empty when the Azure CLI or required extensions are missing.
   */
  cliSuggestions: string[];

  // ── Sub-hook results (forwarded to step components) ───────────────────────
  /** Collected form values from the wizard steps. */
  formData: ReturnType<typeof useFormData>['formData'];
  /** Updates a single key in {@link formData}. */
  updateFormData: ReturnType<typeof useFormData>['updateFormData'];
  /** Subscriptions, clusters, loading states, and fetch actions for Azure resources. */
  azureResources: ReturnType<typeof useAzureResources>;
  /** Extension install status and action for the aks-preview CLI extension. */
  extensionStatus: ReturnType<typeof useExtensionCheck>;
  /** Feature registration status and action for the required AKS feature flag. */
  featureStatus: ReturnType<typeof useFeatureCheck>;
  /** Namespace existence check state and action. */
  namespaceCheck: ReturnType<typeof useNamespaceCheck>;
  /** Cluster capability flags (SKU, network policy, add-on status). */
  clusterCapabilities: ReturnType<typeof useClusterCapabilities>;
  /** Per-step validation result used to gate the "Next" / "Create Project" button. */
  validation: ReturnType<typeof useValidation>;
  /**
   * `true` when the cluster name in the form is not found in the local Headlamp
   * cluster registry, `undefined` when no cluster is selected.
   */
  isClusterMissing: boolean | undefined;
  /** Ref object for the step content container, used to manage focus and scroll position. */
  stepContentRef: React.RefObject<HTMLDivElement>;
}

/**
 * Manages all wizard state and side-effects for the Create AKS Project flow.
 *
 * Extracted from `CreateAKSProject.tsx` so it can be unit-tested independently
 * and so that {@link CreateAKSProjectPure} remains a pure presentational component.
 * The hook composes every domain-specific sub-hook and exposes a single flat
 * object that can be spread directly onto {@link CreateAKSProjectPure}.
 *
 * @returns Wizard state and handlers ready to spread into {@link CreateAKSProjectPure}.
 */
export function useCreateAKSProjectWizard(): UseCreateAKSProjectWizardResult {
  const history = useHistory();
  const { t } = useTranslation();

  const [activeStep, setActiveStep] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState('');
  const [creationError, setCreationError] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [applicationName, setApplicationName] = useState('');
  const terminalTrackedRef = useRef(false);
  const [cliSuggestions, setCliSuggestions] = useState<string[]>([]);
  const stepContentRef = useRef<HTMLDivElement>(null);

  // Track the 2-second success-dialog delay timer so it can be cleared on unmount,
  // preventing a setState call on an unmounted component (React warning / memory leak).
  const successTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    safelyTrackFeature({ feature: 'aksd.project-create', status: 'opened' });
  }, []);

  const { formData, updateFormData } = useFormData();
  const azureResources = useAzureResources();
  const clusterCapabilities = useClusterCapabilities();
  const extensionStatus = useExtensionCheck();
  const featureStatus = useFeatureCheck({ subscription: formData.subscription });
  const namespaceCheck = useNamespaceCheck();

  const clustersConf = K8s.useClustersConf();
  const isClusterMissing =
    formData.cluster &&
    Object.values(clustersConf).find((it: any) => it.name === formData.cluster) === undefined
      ? true
      : undefined;

  const validation = useValidation(
    activeStep,
    formData,
    extensionStatus,
    featureStatus,
    namespaceCheck,
    isClusterMissing,
    clusterCapabilities.capabilities
  );

  useEffect(() => {
    azureResources.fetchSubscriptions();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const azureCheck = await checkAzureCliAndAksPreview();
      if (cancelled) {
        return;
      }
      if (DEBUG) console.debug('Azure CLI check results:', azureCheck);
      setCliSuggestions(azureCheck?.suggestions ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (formData.subscription) {
      azureResources.fetchClusters(formData.subscription);
    } else {
      azureResources.clearClusters();
    }
    clusterCapabilities.clearCapabilities();
  }, [formData.subscription]);

  useEffect(() => {
    if (formData.cluster && formData.subscription && formData.resourceGroup) {
      clusterCapabilities.fetchCapabilities(
        formData.subscription,
        formData.resourceGroup,
        formData.cluster
      );
    } else {
      clusterCapabilities.clearCapabilities();
    }
  }, [formData.cluster, formData.subscription, formData.resourceGroup]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (
        formData.projectName &&
        formData.cluster &&
        formData.resourceGroup &&
        formData.subscription
      ) {
        namespaceCheck.checkNamespace(
          formData.cluster,
          formData.resourceGroup,
          formData.projectName,
          formData.subscription
        );
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [formData.projectName, formData.cluster, formData.resourceGroup, formData.subscription]);

  // Clear the success-dialog delay timer when the hook unmounts so we never call
  // setState after the component has been removed from the tree.
  useEffect(() => {
    return () => {
      clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const handleNext = () => {
    azureResources.clearError();
    azureResources.clearClusterError();
    setActiveStep(prevStep => prevStep + 1);
  };

  const handleBack = () => {
    setActiveStep(prevStep => prevStep - 1);
  };

  const handleStepClick = (step: number) => {
    // Block breadcrumb navigation while a creation request is in-flight to prevent
    // navigating away mid-creation which could corrupt the wizard state.
    if (isCreating) return;
    setActiveStep(step);
  };

  // Focus on the content when changing steps.
  // Prioritise form inputs over alert action buttons so that the first
  // interactable field receives focus (e.g. "Project Name" on the Basics step).
  useEffect(() => {
    requestAnimationFrame(() => {
      const container = stepContentRef.current;
      if (!container) return;
      const focusable =
        container.querySelector<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        ) ??
        container.querySelector<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
      focusable?.focus();
    });
  }, [activeStep]);

  const handleSubmit = async () => {
    let creationTimeoutId: number | undefined;
    let didTimeout = false;
    terminalTrackedRef.current = false;
    safelyTrackFeature({ feature: 'aksd.project-create', status: 'started' });
    try {
      if (DEBUG)
        console.debug('handleSubmit', {
          cluster: formData.cluster,
          projectName: formData.projectName,
        });

      setIsCreating(true);
      setCreationError(null);
      setCreationProgress(`${t('Starting project creation')}...`);

      // Guard flag: set to true if the timeout wins the race so the still-running
      // creationPromise does not continue mutating UI state after an error is shown.
      let aborted = false;

      const timeoutPromise = new Promise((_, reject) => {
        creationTimeoutId = window.setTimeout(() => {
          aborted = true;
          didTimeout = true;
          reject(
            new Error(
              t(
                'Project creation timed out after 10 minutes. Please check if the namespace was created and try again.'
              )
            )
          );
        }, 10 * 60 * 1000);
      });

      const creationPromise = (async () => {
        setCreationProgress(`${t('Initiating managed namespace creation')}...`);
        const namespaceResult = await createManagedNamespace({
          clusterName: formData.cluster,
          resourceGroup: formData.resourceGroup,
          namespaceName: formData.projectName,
          subscriptionId: formData.subscription,
          cpuRequest: formData.cpuRequest,
          cpuLimit: formData.cpuLimit,
          memoryRequest: formData.memoryRequest,
          memoryLimit: formData.memoryLimit,
          ingressPolicy: formData.ingress,
          egressPolicy: formData.egress,
          labels: {
            [PROJECT_ID_LABEL]: formData.projectName,
            [PROJECT_MANAGED_BY_LABEL]: PROJECT_MANAGED_BY_VALUE,
            [SUBSCRIPTION_LABEL]: formData.subscription,
            [RESOURCE_GROUP_LABEL]: formData.resourceGroup,
          },
        });

        if (!namespaceResult.success) {
          throw new Error(
            t('Namespace creation failed: {{message}}', {
              message: namespaceResult.error || t('Unknown error'),
            })
          );
        }

        if (aborted) return;
        setCreationProgress(`${t('Namespace creation initiated! Monitoring creation status')}...`);
        if (DEBUG)
          console.debug('🚀 Namespace creation initiated for namespace:', formData.projectName);

        if (DEBUG) console.debug('⏳ Waiting 5 seconds for namespace to propagate...');
        setCreationProgress(`${t('Waiting for namespace to propagate')}...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (aborted) return;

        let namespaceVerified = false;
        let retryCount = 0;
        const maxRetries = 8;
        const retryDelay = 4000;

        while (!namespaceVerified && retryCount < maxRetries) {
          try {
            if (DEBUG)
              console.debug(
                `🔍 Verification attempt ${retryCount + 1} for namespace: ${formData.projectName}`
              );

            const result = await checkNamespaceExists(
              formData.cluster,
              formData.resourceGroup,
              formData.projectName,
              formData.subscription
            );
            if (aborted) return;

            if (DEBUG) {
              console.debug(`   Direct result exists: ${result.exists}`);
              console.debug(`   Direct result error: ${result.error || 'None'}`);
            }

            if (result.error) {
              if (DEBUG) console.debug(`   ❌ Namespace check error: ${result.error}`);
              throw new Error(
                t('Namespace status check failed: {{message}}', { message: result.error })
              );
            }

            if (result.exists === true) {
              namespaceVerified = true;
              if (DEBUG) console.debug('✅ Namespace verified successfully');
            } else {
              retryCount++;
              if (retryCount < maxRetries) {
                if (DEBUG)
                  console.debug(`⏳ Namespace not found yet, retrying in ${retryDelay / 1000}s...`);
                setCreationProgress(`${t('Waiting for namespace to be created')}...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                if (aborted) return;
              } else {
                if (DEBUG) console.debug(`❌ Max retries reached, namespace still not found`);
              }
            }
          } catch (statusError) {
            const statusErrorMessage =
              statusError instanceof Error ? statusError.message : String(statusError);
            if (DEBUG) console.debug(`❌ Verification attempt failed:`, statusErrorMessage);
            throw new Error(
              t('Namespace status verification failed: {{message}}', {
                message: statusErrorMessage,
              })
            );
          }
        }

        if (aborted) return;

        if (!namespaceVerified) {
          if (DEBUG)
            console.debug('⚠️ Namespace verification failed, continuing (timing issue likely).');
          setCreationProgress(
            `${t('Namespace creation API succeeded, proceeding with user assignments')}...`
          );
        }

        // Step 2: Add users to the namespace
        setCreationProgress(
          `${t('Namespace creation completed successfully! Adding user access')}...`
        );

        const roleResult = await assignRolesToNamespace({
          clusterName: formData.cluster,
          resourceGroup: formData.resourceGroup,
          namespaceName: formData.projectName,
          subscriptionId: formData.subscription,
          assignments: formData.userAssignments,
          onProgress: msg => {
            if (!aborted) setCreationProgress(msg);
          },
          t: t,
        });

        if (aborted) return;

        if (!roleResult.success) {
          const errorMessage = `${t(
            'User assignment completed with errors'
          )}\n${roleResult.errors.join('\n')}`;
          if (roleResult.results.length > 0) {
            console.warn('Some user assignments succeeded:', roleResult.results);
          }
          throw new Error(errorMessage);
        }

        setCreationProgress(t('Project creation completed successfully!'));

        setCreationProgress(`${t('Performing final status verification')}...`);

        let finalVerified = false;
        for (let attempt = 0; attempt < 2 && !finalVerified; attempt++) {
          try {
            const result = await checkNamespaceExists(
              formData.cluster,
              formData.resourceGroup,
              formData.projectName,
              formData.subscription
            );

            if (aborted) return;

            if (result.error) {
              throw new Error(
                t('Final status check failed: {{message}}', { message: result.error })
              );
            }

            if (result.exists) {
              finalVerified = true;
              if (DEBUG) console.debug('✅ Final namespace verification successful');
            } else if (attempt === 0) {
              if (DEBUG)
                console.debug('⏳ Final verification: namespace not found, retrying once...');
              await new Promise(resolve => setTimeout(resolve, 2000));
              if (aborted) return;
            }
          } catch (finalError) {
            const finalErrorMessage =
              finalError instanceof Error ? finalError.message : String(finalError);
            throw new Error(
              t('Final status verification failed: {{message}}', {
                message: finalErrorMessage,
              })
            );
          }
        }

        if (!finalVerified) {
          if (DEBUG)
            console.debug('⚠️ Final verification failed, but namespace creation API succeeded.');
        }

        setCreationProgress(t('All verifications completed successfully!'));
      })();

      // Attach a rejection handler to prevent an unhandled promise rejection if
      // the timeout wins the race while creationPromise is still running and later rejects.
      // When DEBUG is enabled, log the late rejection for post-timeout diagnostics.
      creationPromise.catch(err => {
        if (DEBUG) {
          console.debug(
            'Namespace creation promise rejected after timeout or component unmount:',
            err
          );
        }
      });

      await Promise.race([creationPromise, timeoutPromise]);

      terminalTrackedRef.current = true;
      safelyTrackFeature({ feature: 'aksd.project-create', status: 'succeeded' });

      // Store the timer id so the cleanup effect can cancel it if the component
      // unmounts before the 2 seconds elapse, preventing setState on an unmounted component.
      successTimeoutRef.current = window.setTimeout(() => {
        setIsCreating(false);
        setShowSuccessDialog(true);
      }, 2000);
    } catch (error) {
      terminalTrackedRef.current = true;
      safelyTrackFeature({ feature: 'aksd.project-create', status: 'failed' });
      safelyTrackError({
        area: 'project-create',
        errorClass: didTimeout ? 'TimeoutError' : 'UnknownError',
        phase: 'failed',
      });
      const rawErrorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      // Sanitize potential PII (e.g., email addresses) from the error message and stack
      // for non-debug logging.  JS stack traces include the message on the first line, so
      // the stack must be redacted with the same pattern as the message.
      const PII_REDACT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
      const sanitizedErrorMessage = rawErrorMessage
        ? rawErrorMessage.replace(PII_REDACT_RE, '<redacted>')
        : '';
      const sanitizedErrorStack = errorStack
        ? errorStack.replace(PII_REDACT_RE, '<redacted>')
        : undefined;

      if (DEBUG) {
        // In debug mode, log full error details for troubleshooting.
        console.error('Error creating AKS project (debug):', error);
        console.error('Error details (debug):', {
          message: rawErrorMessage,
          stack: errorStack,
          formDataRedacted: true,
        });
      } else {
        // In non-debug/production, avoid logging raw PII-bearing messages or stacks.
        console.error('Error creating AKS project:', sanitizedErrorMessage || 'Unknown error');
        console.error('Error details (sanitized):', {
          message: sanitizedErrorMessage || 'Unknown error',
          stack: sanitizedErrorStack,
          formDataRedacted: true,
        });
      }

      // Use the raw (un-redacted) message for the user-visible error dialog so
      // actionable details (e.g., the assignee that failed) are visible.
      // Sanitization is only applied to console logging above.
      setCreationError(rawErrorMessage || t('Failed to create project'));
      setIsCreating(false);
      setCreationProgress('');
    } finally {
      // Clear the 10-minute guard timer so it cannot fire (and cause an unhandled
      // rejection) after creationPromise has already won the Promise.race.
      clearTimeout(creationTimeoutId);
    }
  };

  const onBack = () => {
    if (!terminalTrackedRef.current) {
      terminalTrackedRef.current = true;
      safelyTrackFeature({ feature: 'aksd.project-create', status: 'cancelled' });
    }
    history.push('/');
  };

  return {
    activeStep,
    steps: STEPS,
    handleNext,
    handleBack,
    handleStepClick,
    handleSubmit,
    onBack,
    isCreating,
    creationProgress,
    creationError,
    setCreationError,
    setCreationProgress,
    showSuccessDialog,
    setShowSuccessDialog,
    applicationName,
    setApplicationName,
    cliSuggestions,
    formData,
    updateFormData,
    azureResources,
    extensionStatus,
    featureStatus,
    namespaceCheck,
    clusterCapabilities,
    validation,
    isClusterMissing,
    stepContentRef,
  };
}
