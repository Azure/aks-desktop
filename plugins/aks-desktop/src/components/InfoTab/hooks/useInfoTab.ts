// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterAction, K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getManagedNamespaceDetails,
  getManagedNamespaces,
  updateManagedNamespace,
} from '../../../utils/azure/az-namespaces';
import { RESOURCE_GROUP_LABEL, SUBSCRIPTION_LABEL } from '../../../utils/constants/projectLabels';
import { parseCpuToMillicores, parseMemoryToBytes } from '../../../utils/shared/resourceUnits';
import {
  DEFAULT_FORM_DATA,
  type FormData,
  type ValidationState,
} from '../../CreateAKSProject/types';
import {
  validateComputeQuota,
  validateNetworkingPolicies,
} from '../../CreateAKSProject/validators';

// Pure helpers — module-level so they are never recreated on re-renders.

function normalizePolicy(value: string): FormData['ingress'] {
  const allowed: Record<FormData['ingress'], true> = {
    AllowSameNamespace: true,
    AllowAll: true,
    DenyAll: true,
  };
  return (value as FormData['ingress']) in allowed
    ? (value as FormData['ingress'])
    : 'AllowSameNamespace';
}

const BYTES_PER_MEBIBYTE = 1024 ** 2;

function formDataFromNamespaceDetails(details: NamespaceDetails): FormData {
  const quota = details.properties?.defaultResourceQuota;
  const policy = details.properties?.defaultNetworkPolicy;
  return {
    ...DEFAULT_FORM_DATA,
    ingress: normalizePolicy(policy?.ingress ?? 'AllowSameNamespace'),
    egress: normalizePolicy(policy?.egress ?? 'AllowAll'),
    cpuRequest: parseCpuToMillicores(quota?.cpuRequest ?? '0m'),
    cpuLimit: parseCpuToMillicores(quota?.cpuLimit ?? '0m'),
    memoryRequest: parseMemoryToBytes(quota?.memoryRequest ?? '0Mi') / BYTES_PER_MEBIBYTE,
    memoryLimit: parseMemoryToBytes(quota?.memoryLimit ?? '0Mi') / BYTES_PER_MEBIBYTE,
  };
}

function validationForFormData(data: FormData): ValidationState {
  const compute = validateComputeQuota({
    cpuRequest: data.cpuRequest,
    cpuLimit: data.cpuLimit,
    memoryRequest: data.memoryRequest,
    memoryLimit: data.memoryLimit,
  });
  const networking = validateNetworkingPolicies({
    ingress: data.ingress,
    egress: data.egress,
  });
  const fieldErrors: Record<string, string[]> = {};
  if (compute.fieldErrors) Object.assign(fieldErrors, compute.fieldErrors);
  if (!networking.isValid) fieldErrors.networking = networking.errors;
  return {
    isValid: compute.isValid && networking.isValid,
    errors: [...(compute.errors || []), ...(networking.errors || [])],
    warnings: [],
    fieldErrors,
  };
}

/**
 * The shape of namespace details returned from the Azure CLI.
 */
export interface NamespaceDetails {
  properties?: {
    defaultNetworkPolicy?: {
      ingress?: string;
      egress?: string;
    };
    defaultResourceQuota?: {
      cpuRequest?: string;
      cpuLimit?: string;
      memoryRequest?: string;
      memoryLimit?: string;
    };
  };
}

/**
 * Return type for the {@link useInfoTab} hook.
 */
export interface UseInfoTabResult {
  /** Whether the initial namespace details fetch is in progress. */
  loading: boolean;
  /** Whether an update operation is in progress. */
  updating: boolean;
  /** Error message if fetch or update failed, otherwise null. */
  error: string | null;
  /** The fetched managed namespace details, or null if unavailable or not yet loaded. */
  namespaceDetails: NamespaceDetails | null;
  /** Current form field values. */
  formData: FormData;
  /** Current validation state of the form. */
  validation: ValidationState;
  /** Whether the form has unsaved changes relative to the last saved state. */
  hasChanges: boolean;
  /** Updates form fields and re-validates. */
  handleFormDataChange: (updates: Partial<FormData>) => void;
  /** Persists the current form data to the managed namespace. */
  handleSave: () => void;
}

/**
 * Manages data fetching, form state, validation, and save logic for the InfoTab component.
 *
 * Fetches managed namespace details from the Azure CLI and pre-populates the networking
 * and compute quota form fields. Provides handlers for form changes and persisting updates.
 *
 * @param project - The project whose first cluster and namespace are used for Azure CLI calls.
 * @returns State and handlers for the InfoTab component to render.
 */
export const useInfoTab = (project: {
  clusters: string[];
  namespaces: string[];
  id: string;
}): UseInfoTabResult => {
  const { t } = useTranslation();

  // Destructure stable primitives so the effects below don't re-run on
  // every render when the caller passes a new project object reference.
  const clusterName = project.clusters[0];
  const projectId = project.id;

  const [namespaceInstance] = K8s.ResourceClasses.Namespace.useGet(
    project.namespaces[0],
    undefined,
    { cluster: clusterName }
  );
  const subscription = namespaceInstance?.jsonData?.metadata?.labels?.[SUBSCRIPTION_LABEL];
  const resourceGroup = namespaceInstance?.jsonData?.metadata?.labels?.[RESOURCE_GROUP_LABEL];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namespaceDetails, setNamespaceDetails] = useState<NamespaceDetails | null>(null);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA);
  const formDataRef = useRef<FormData>(formData);
  const editGenerationsRef = useRef<Partial<Record<keyof FormData, number>>>({});
  const skipNextNamespacePopulationRef = useRef(false);
  const [baselineFormData, setBaselineFormData] = useState<FormData | null>(null);
  const scopeKey = JSON.stringify([clusterName, projectId, subscription, resourceGroup]);
  const scopeRef = useRef({ key: scopeKey, generation: 0 });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current = { key: scopeKey, generation: scopeRef.current.generation + 1 };
  }

  const [updating, setUpdating] = useState(false);
  const [validation, setValidation] = useState<ValidationState>({
    isValid: true,
    errors: [],
    warnings: [],
    fieldErrors: {},
  });

  useEffect(() => {
    setUpdating(false);
    setError(null);
    setNamespaceDetails(null);
    setBaselineFormData(null);
    formDataRef.current = DEFAULT_FORM_DATA;
    setFormData(DEFAULT_FORM_DATA);
    setValidation(validationForFormData(DEFAULT_FORM_DATA));
  }, [scopeKey]);

  // Fetch managed namespace details from Azure CLI
  useEffect(() => {
    let isMounted = true;
    if (!clusterName || !resourceGroup) {
      setLoading(false);
      setError(null);
      setNamespaceDetails(null);
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);

        let nsList: string[];
        try {
          nsList = await getManagedNamespaces({
            clusterName,
            resourceGroup,
            subscriptionId: subscription,
          });
        } catch (e) {
          console.error(e);
          if (isMounted) {
            setError(t('Failed to fetch managed namespaces'));
            setNamespaceDetails(null);
          }
          return;
        }

        if (nsList.length === 0) {
          if (isMounted) setNamespaceDetails(null);
          return;
        }

        try {
          const details = await getManagedNamespaceDetails({
            clusterName,
            resourceGroup,
            namespaceName: projectId,
            subscriptionId: subscription,
          });
          if (isMounted) setNamespaceDetails(details);
        } catch (e) {
          console.error(e);
          if (isMounted) {
            setError(t('Failed to fetch managed namespace details'));
            setNamespaceDetails(null);
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [clusterName, projectId, subscription, resourceGroup]);

  // Pre-populate form when namespace details are fetched
  useEffect(() => {
    if (!namespaceDetails) return;
    if (skipNextNamespacePopulationRef.current) {
      skipNextNamespacePopulationRef.current = false;
      return;
    }

    const populated = formDataFromNamespaceDetails(namespaceDetails);

    setFormData(populated);
    formDataRef.current = populated;
    setBaselineFormData(populated);
  }, [namespaceDetails]);

  const handleFormDataChange = useCallback((updates: Partial<FormData>) => {
    for (const key of Object.keys(updates) as (keyof FormData)[]) {
      editGenerationsRef.current[key] = (editGenerationsRef.current[key] ?? 0) + 1;
    }
    const next = { ...formDataRef.current, ...updates };
    formDataRef.current = next;
    setFormData(next);

    setValidation(validationForFormData(next));
  }, []);

  const hasChanges = useMemo(() => {
    if (!baselineFormData) return false;
    const keys: (keyof FormData)[] = [
      'ingress',
      'egress',
      'cpuRequest',
      'cpuLimit',
      'memoryRequest',
      'memoryLimit',
    ];
    return keys.some(k => formData[k] !== baselineFormData[k]);
  }, [baselineFormData, formData]);

  const handleSave = useCallback(() => {
    if (!resourceGroup || !clusterName || !projectId) return;

    const submittedFormData = formData;
    const submittedEditGenerations = { ...editGenerationsRef.current };
    const submittedScopeGeneration = scopeRef.current.generation;
    setUpdating(true);
    clusterAction(
      async () => {
        try {
          const savedResource = await updateManagedNamespace({
            clusterName,
            resourceGroup,
            namespaceName: projectId,
            ...(baselineFormData === null || formData.ingress !== baselineFormData.ingress
              ? { ingressPolicy: formData.ingress }
              : {}),
            ...(baselineFormData === null || formData.egress !== baselineFormData.egress
              ? { egressPolicy: formData.egress }
              : {}),
            ...(baselineFormData === null || formData.cpuRequest !== baselineFormData.cpuRequest
              ? { cpuRequest: formData.cpuRequest }
              : {}),
            ...(baselineFormData === null || formData.cpuLimit !== baselineFormData.cpuLimit
              ? { cpuLimit: formData.cpuLimit }
              : {}),
            ...(baselineFormData === null ||
            formData.memoryRequest !== baselineFormData.memoryRequest
              ? { memoryRequest: formData.memoryRequest }
              : {}),
            ...(baselineFormData === null || formData.memoryLimit !== baselineFormData.memoryLimit
              ? { memoryLimit: formData.memoryLimit }
              : {}),
            subscriptionId: subscription,
          });
          if (scopeRef.current.generation !== submittedScopeGeneration) return;
          const savedDetails = savedResource as NamespaceDetails;
          if (savedDetails?.properties) {
            const savedFormData = formDataFromNamespaceDetails(savedDetails);
            skipNextNamespacePopulationRef.current = true;
            setNamespaceDetails(savedDetails);
            setBaselineFormData(savedFormData);
            const reconciled = { ...formDataRef.current };
            const keys: (keyof FormData)[] = [
              'ingress',
              'egress',
              'cpuRequest',
              'cpuLimit',
              'memoryRequest',
              'memoryLimit',
            ];
            for (const key of keys) {
              if ((editGenerationsRef.current[key] ?? 0) === (submittedEditGenerations[key] ?? 0)) {
                Object.assign(reconciled, { [key]: savedFormData[key] });
              }
            }
            formDataRef.current = reconciled;
            setFormData(reconciled);
            setValidation(validationForFormData(reconciled));
          } else {
            setBaselineFormData(submittedFormData);
          }
          setError(null);
        } catch (err) {
          if (scopeRef.current.generation === submittedScopeGeneration) {
            setError(err instanceof Error ? err.message : String(err));
          }
          throw err;
        } finally {
          if (scopeRef.current.generation === submittedScopeGeneration) {
            setUpdating(false);
          }
        }
      },
      {
        startMessage: t('Updating namespace {{ name }}…', { name: projectId }),
        cancelledMessage: t('Cancelled update of namespace {{ name }}.', { name: projectId }),
        successMessage: t('Updated namespace {{ name }}.', { name: projectId }),
        errorMessage: t('Failed to update namespace {{ name }}.', { name: projectId }),
        startOptions: { autoHideDuration: null },
      }
    );
  }, [resourceGroup, clusterName, projectId, subscription, formData, baselineFormData, t]);

  return {
    loading,
    updating,
    error,
    namespaceDetails,
    formData,
    validation,
    hasChanges,
    handleFormDataChange,
    handleSave,
  };
};
