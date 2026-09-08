// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { apply } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import React, { useEffect, useState } from 'react';
import YAML from 'yaml';
import { dryRunApply } from '../utils/dryRunApply';
import { applyNamespaceOverride } from '../utils/namespaceOverride';
import { checkResourceQuota, type QuotaWarning } from '../utils/quotaCheck';
import { type ContainerDeploymentConfig, generateYamlForContainer } from '../utils/yamlGenerator';
import type { ContainerConfig } from './useContainerConfiguration';
import { useContainerConfiguration } from './useContainerConfiguration';

/**
 * Parses a multi-document YAML string, filters empty documents, converts
 * each to a plain JS object, and optionally overrides the namespace.
 */
function parseAndOverride(yaml: string, namespace?: string) {
  return YAML.parseAllDocuments(yaml)
    .filter(d => d?.contents)
    .map(d => d.toJSON())
    .filter(Boolean)
    .map(obj => applyNamespaceOverride(obj, namespace));
}

/**
 * Expands Kubernetes List resources (e.g. DeploymentList) into individual items,
 * inheriting apiVersion and namespace from the parent when not set on the item.
 */
function flattenListResources(docs: any[]): any[] {
  return docs.flatMap(resource => {
    if (
      (resource.kind === 'List' || resource.kind?.endsWith('List')) &&
      Array.isArray(resource.items)
    ) {
      return resource.items.map((item: any) => ({
        ...item,
        apiVersion: item.apiVersion || resource.apiVersion,
        metadata: {
          ...item.metadata,
          namespace: item.metadata?.namespace || resource.metadata?.namespace,
        },
      }));
    }
    return resource;
  });
}

/** Returns the raw YAML text for the current source type. */
function getDeployText(
  sourceType: 'yaml' | 'container' | null,
  config: ContainerConfig,
  namespace?: string,
  yamlEditorValue?: string
): string {
  return sourceType === 'container'
    ? generateYamlForContainer(toYamlConfig(config, namespace))
    : yamlEditorValue ?? '';
}

/** Parses YAML text into docs, applying namespace override for YAML-source only. */
function parseDeployDocs(
  sourceType: 'yaml' | 'container' | null,
  text: string,
  namespace?: string
): any[] {
  return sourceType === 'yaml' ? parseAndOverride(text, namespace) : parseAndOverride(text);
}

/** Strips UI-only fields from a full ContainerConfig, returning only YAML-generation fields. */
function toYamlConfig(config: ContainerConfig, namespace?: string): ContainerDeploymentConfig {
  // Destructure to exclude UI-only fields that generateYamlForContainer does not accept.
  /* eslint-disable no-unused-vars */
  const { containerStep, showProbeConfigs, containerPreviewYaml, useCustomServicePort, ...rest } =
    config;
  /* eslint-enable no-unused-vars */
  return { ...rest, namespace };
}

/**
 * The three ordered steps of the Deploy wizard.
 * Used as numeric indices for `activeStep` comparisons.
 */
export enum WizardStep {
  /** Step 0 — choose between YAML upload and container-image configuration. */
  SOURCE = 0,
  /** Step 1 — edit the YAML or fill the container-image form. */
  CONFIGURE = 1,
  /** Step 2 — review the generated manifests and trigger deployment. */
  DEPLOY = 2,
}

/**
 * Options accepted by {@link useDeployWizard}.
 */
export interface UseDeployWizardOptions {
  /** Name of the target Kubernetes cluster (passed to `apply`). */
  cluster?: string;
  /** Target namespace; injected into generated/parsed YAML before deployment. */
  namespace?: string;
  /** Pre-fills the application name field in the container-configuration step. */
  initialApplicationName?: string;
  initialContainerConfig?: Partial<ContainerConfig>;
}

/**
 * All state and event-handlers returned by {@link useDeployWizard}.
 * Pass the whole object directly into {@link DeployWizardPure} as props.
 */
export interface UseDeployWizardResult {
  /** Index of the currently active wizard step (see {@link WizardStep}). */
  activeStep: WizardStep;
  /** Selected deploy source, or `null` if not yet chosen. */
  sourceType: 'yaml' | 'container' | null;
  /** Setter for {@link sourceType}. */
  setSourceType: React.Dispatch<React.SetStateAction<'yaml' | 'container' | null>>;
  /** Raw YAML text in the editor. */
  yamlEditorValue: string;
  /** Setter for {@link yamlEditorValue}. */
  setYamlEditorValue: React.Dispatch<React.SetStateAction<string>>;
  /** Validation error message from the YAML editor, or `null` when valid. */
  yamlError: string | null;
  /** Setter for {@link yamlError}. */
  setYamlError: React.Dispatch<React.SetStateAction<string | null>>;
  /** `true` while the deploy API call is in-flight. */
  deploying: boolean;
  /** Outcome of the most recent deploy attempt, or `null` before any attempt. */
  deployResult: 'success' | 'error' | null;
  /** Human-readable message describing the deploy outcome. */
  deployMessage: string;
  /** Advisory warnings when deployment resources would exceed namespace quota. */
  quotaWarnings: QuotaWarning[];
  /** Namespace-overridden YAML shown in the review step for the YAML source path. */
  userPreviewYaml: string;
  /** Full container-configuration state and setter (see `useContainerConfiguration`). */
  containerConfig: ReturnType<typeof useContainerConfiguration>;
  /** Advances `activeStep` by one (capped at {@link WizardStep.DEPLOY}). */
  handleNext: () => void;
  /** Decrements `activeStep` by one (floored at {@link WizardStep.SOURCE}). */
  handleBack: () => void;
  /**
   * Navigates to `step` if it is at or before `activeStep`, or if
   * {@link isStepValid} returns `true` for that step.
   */
  handleStepClick: (step: WizardStep) => void;
  /**
   * Validates the current YAML/container config, applies each parsed Kubernetes
   * resource via the Headlamp API proxy, and updates {@link deployResult}.
   */
  handleDeploy: () => Promise<void>;
  /**
   * Returns `true` when the given step has sufficient data to proceed.
   * Used to enable/disable the "Next" button and breadcrumb navigation.
   */
  isStepValid: (step: WizardStep) => boolean;
}

/**
 * Manages all state and side-effects for the {@link DeployWizard}.
 *
 * Extracted from `DeployWizard.tsx` so it can be unit-tested independently
 * and so that {@link DeployWizardPure} remains a pure presentational component.
 *
 * @param options - Cluster, namespace, and initial app name configuration.
 * @returns Wizard state and handlers ready to spread into {@link DeployWizardPure}.
 */
export function useDeployWizard({
  cluster,
  namespace,
  initialApplicationName,
  initialContainerConfig,
}: UseDeployWizardOptions): UseDeployWizardResult {
  const { t } = useTranslation();
  const isEditMode = !!initialContainerConfig;
  const [activeStep, setActiveStep] = useState(
    isEditMode ? WizardStep.CONFIGURE : WizardStep.SOURCE
  );
  const [sourceType, setSourceType] = useState<null | 'yaml' | 'container'>(
    isEditMode ? 'container' : null
  );

  const [yamlEditorValue, setYamlEditorValue] = useState<string>('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<null | 'success' | 'error'>(null);
  const [deployMessage, setDeployMessage] = useState<string>('');
  const [quotaWarnings, setQuotaWarnings] = useState<QuotaWarning[]>([]);
  const [userPreviewYaml, setUserPreviewYaml] = useState<string>('');

  const containerConfig = useContainerConfiguration(initialApplicationName, initialContainerConfig);

  useEffect(() => {
    // Generate YAML preview for the review step
    if (activeStep === WizardStep.DEPLOY && sourceType === 'container') {
      const newYaml = getDeployText(sourceType, containerConfig.config, namespace);
      if (newYaml !== containerConfig.config.containerPreviewYaml) {
        containerConfig.setConfig(prev => ({
          ...prev,
          containerPreviewYaml: newYaml,
        }));
      }
    }
  }, [namespace, sourceType, activeStep, containerConfig.config]);

  useEffect(() => {
    if (activeStep === WizardStep.DEPLOY && sourceType === 'yaml') {
      try {
        const processed = parseAndOverride(yamlEditorValue, namespace).map(obj =>
          YAML.stringify(obj).trim()
        );
        setUserPreviewYaml(processed.join('\n---\n'));
      } catch (e) {
        setUserPreviewYaml(yamlEditorValue);
      }
    }
    if (activeStep !== WizardStep.DEPLOY) {
      setDeployResult(null);
      setDeployMessage('');
      setDeploying(false);
      setQuotaWarnings(prev => (prev.length === 0 ? prev : []));
    }
  }, [activeStep, sourceType, namespace, yamlEditorValue, containerConfig.config]);

  // Advisory quota check: runs when entering the Deploy review step.
  // Uses containerPreviewYaml (a primitive string, set by the effect above)
  // instead of containerConfig.config to avoid a duplicate API call caused by
  // the object reference changing when setConfig updates containerPreviewYaml.
  const containerPreviewYaml = containerConfig.config.containerPreviewYaml;
  useEffect(() => {
    if (activeStep !== WizardStep.DEPLOY || !namespace) {
      return;
    }

    const text = sourceType === 'container' ? containerPreviewYaml ?? '' : yamlEditorValue ?? '';

    if (!text) return;

    setQuotaWarnings(prev => (prev.length === 0 ? prev : []));

    let flatDocs: any[];
    try {
      const docs = parseDeployDocs(sourceType, text, namespace);
      flatDocs = flattenListResources(docs);
    } catch {
      return;
    }

    let cancelled = false;
    checkResourceQuota(flatDocs, namespace, cluster)
      .then(warnings => {
        if (!cancelled) setQuotaWarnings(warnings);
      })
      .catch(() => {
        if (!cancelled) setQuotaWarnings(prev => (prev.length === 0 ? prev : []));
      });
    return () => {
      cancelled = true;
    };
  }, [activeStep, namespace, cluster, sourceType, yamlEditorValue, containerPreviewYaml]);

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
        return false;
    }
  };

  const handleNext = () => setActiveStep(s => Math.min(s + 1, WizardStep.DEPLOY) as WizardStep);
  const handleBack = () => setActiveStep(s => Math.max(s - 1, WizardStep.SOURCE) as WizardStep);
  const handleStepClick = (step: WizardStep) => {
    // Block breadcrumb navigation while a deploy is in-flight to prevent stale
    // success/error state from being applied to a different YAML/config.
    if (deploying) return;
    if (step <= activeStep || isStepValid(step)) {
      setActiveStep(step);
    }
  };

  const handleDeploy = async () => {
    try {
      setYamlError(null);
      setDeployResult(null);
      setDeployMessage('');
      setDeploying(true);

      // Generate container YAML synchronously to avoid a race where
      // containerPreviewYaml may still be empty on the first render of the Deploy step.
      const text = getDeployText(sourceType, containerConfig.config, namespace, yamlEditorValue);

      let docs;
      try {
        docs = parseDeployDocs(sourceType, text, namespace);
        for (const doc of docs) {
          if (!doc || !doc.kind) {
            throw new Error(t('Invalid YAML: missing required field (kind)'));
          }
          if (doc.kind === 'List' || (doc.kind.endsWith('List') && doc.items !== undefined)) {
            if (!Array.isArray(doc.items)) {
              throw new Error(t('Invalid YAML: List resource must have an array "items" field'));
            }
            for (const item of doc.items) {
              if (!item?.kind) {
                throw new Error(t('Invalid YAML: List item missing required field (kind)'));
              }
              if (!item?.metadata?.name) {
                throw new Error(
                  t('Invalid YAML: List item missing required field (metadata.name)')
                );
              }
            }
          } else if (!doc.metadata?.name) {
            throw new Error(t('Invalid YAML: missing required field (metadata.name)'));
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setYamlError(msg || t('Invalid YAML'));
        setDeployResult('error');
        setDeployMessage(msg || t('Invalid YAML'));
        return;
      }

      // Expand List resources (e.g., DeploymentList) into individual items
      // so both dry-run and apply operate on each resource independently.
      const flatDocs = flattenListResources(docs);

      // Phase 1: Server-side dry-run validation (catches admission webhook errors).
      // Runs in parallel — unlike the sequential Phase 2 apply — because dry-runs
      // are read-only and safe to execute concurrently.
      const dryRunResults = await Promise.allSettled(
        flatDocs.map(resource => dryRunApply(resource, cluster))
      );
      const dryRunErrors = dryRunResults
        .map((result, i) => {
          if (result.status !== 'rejected') {
            return null;
          }
          const reason = result.reason as unknown;
          const errMsg = reason instanceof Error ? reason.message : String(reason ?? '');
          return `${flatDocs[i].kind}/${flatDocs[i].metadata?.name ?? 'unknown'}: ${
            errMsg || t('Validation failed')
          }`;
        })
        .filter((msg): msg is string => msg !== null);

      if (dryRunErrors.length > 0) {
        setDeployResult('error');
        setDeployMessage(dryRunErrors.join('\n'));
        return;
      }

      // Phase 2: Actual apply with per-resource error tracking
      const errors: string[] = [];
      let applied = 0;
      for (const resource of flatDocs) {
        if (!resource || typeof resource !== 'object') continue;
        try {
          await apply(resource as any, cluster);
          applied++;
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          errors.push(
            `${resource.kind}/${resource.metadata?.name ?? 'unknown'}: ${
              errMsg || t('Failed to apply')
            }`
          );
        }
      }

      if (errors.length > 0) {
        setDeployResult('error');
        setDeployMessage(
          applied > 0
            ? t('Applied {{applied}} resource(s), but {{failed}} failed:\n{{errors}}', {
                applied,
                failed: errors.length,
                errors: errors.join('\n'),
              })
            : errors.join('\n')
        );
      } else {
        setDeployResult('success');
        setDeployMessage(t('Applied {{count}} resource(s) successfully.', { count: applied }));
      }
    } catch (e: unknown) {
      setDeployResult('error');
      const deployErrMsg = e instanceof Error ? e.message : String(e);
      setDeployMessage(deployErrMsg || t('Failed to apply resources.'));
    } finally {
      setDeploying(false);
    }
  };

  return {
    activeStep,
    sourceType,
    setSourceType,
    yamlEditorValue,
    setYamlEditorValue,
    yamlError,
    setYamlError,
    deploying,
    deployResult,
    deployMessage,
    quotaWarnings,
    userPreviewYaml,
    containerConfig,
    handleNext,
    handleBack,
    handleStepClick,
    handleDeploy,
    isStepValid,
  };
}
