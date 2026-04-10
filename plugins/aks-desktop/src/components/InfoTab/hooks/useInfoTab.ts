// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getManagedNamespaceDetails,
  updateManagedNamespace,
} from '../../../utils/azure/az-namespaces';
import { RESOURCE_GROUP_LABEL, SUBSCRIPTION_LABEL } from '../../../utils/constants/projectLabels';
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

function parseMillicores(val: string): number {
  const n = parseInt(String(val).replace(/m$/i, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseMiB(val: string): number {
  const n = parseInt(String(val).replace(/Mi$/i, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

// Module-level cache keyed by "<subscription>/<resourceGroup>/<clusterName>/<projectId>".
// Persists across tab switches for the lifetime of the app session.
const detailsCache = new Map<string, NamespaceDetails>();

// Test helpers — narrow surface for accessing the module-level cache.
export function clearDetailsCacheForTests(): void {
  detailsCache.clear();
}
export function getDetailsCacheForTests(): ReadonlyMap<string, NamespaceDetails> {
  return detailsCache;
}
export function setDetailsCacheForTests(key: string, value: NamespaceDetails): void {
  detailsCache.set(key, value);
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
  /** Whether the initial namespace details fetch is in progress (no cached data available). */
  loading: boolean;
  /** Whether a background revalidation fetch is in progress. */
  revalidating: boolean;
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
  handleSave: () => Promise<void>;
  /** Triggers a background revalidation fetch from Azure CLI without clearing cached data. */
  handleRefresh: () => void;
}

/**
 * Manages data fetching, form state, validation, and save logic for the InfoTab component.
 *
 * Uses a stale-while-revalidate strategy: cached data is shown immediately on subsequent
 * opens, while a background fetch keeps it fresh. Revalidation is also triggered on manual
 * refresh and always runs as a background fetch if data is already displayed, even if the
 * cache was invalidated (e.g. after a successful save).
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

  const cacheKey =
    clusterName && projectId && resourceGroup && subscription
      ? `${subscription}/${resourceGroup}/${clusterName}/${projectId}`
      : null;
  const cached = cacheKey ? detailsCache.get(cacheKey) ?? null : null;

  const [loading, setLoading] = useState(cacheKey !== null && cached === null);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namespaceDetails, setNamespaceDetails] = useState<NamespaceDetails | null>(cached);
  const namespaceDetailsRef = useRef(namespaceDetails);
  namespaceDetailsRef.current = namespaceDetails;
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA);
  const [baselineFormData, setBaselineFormData] = useState<FormData | null>(null);
  const [updating, setUpdating] = useState(false);
  const hasUnsavedChangesRef = useRef(false);
  const isFirstRenderRef = useRef(true);
  const latestRequestIdRef = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [validation, setValidation] = useState<ValidationState>({
    isValid: true,
    errors: [],
    warnings: [],
    fieldErrors: {},
  });

  // Reset all data/form state when the project identity changes so stale data
  // from a previous project is never shown for the new one.
  // Skip the initial mount — state is already initialised correctly from the cache.
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setNamespaceDetails(null);
    setFormData(DEFAULT_FORM_DATA);
    setBaselineFormData(null);
    hasUnsavedChangesRef.current = false;
    setError(null);
    setLoading(!!clusterName);
    setRevalidating(false);
  }, [clusterName, projectId]);

  // Fetch (or revalidate) managed namespace details from Azure CLI.
  // If cached data exists, runs silently in the background (revalidating).
  // If no cached data, shows a blocking spinner (loading).
  useEffect(() => {
    let isMounted = true;
    if (!clusterName || !resourceGroup || !cacheKey) {
      // clusterName/projectId are present but resourceGroup/subscription are
      // still resolving from the namespace instance. Preserve existing details
      // (already scoped to this project by the reset effect above) and wait.
      setLoading(false);
      setError(null);
      setRevalidating(false);
      return () => {
        isMounted = false;
      };
    }

    const hasExistingData = namespaceDetailsRef.current !== null;
    if (hasExistingData) {
      setRevalidating(true);
    } else {
      setLoading(true);
    }
    setError(null);

    const requestId = ++latestRequestIdRef.current;
    const isLatest = () => isMounted && latestRequestIdRef.current === requestId;

    (async () => {
      try {
        const details = await getManagedNamespaceDetails({
          clusterName,
          resourceGroup,
          namespaceName: projectId,
          subscriptionId: subscription,
        });
        if (isLatest()) {
          detailsCache.set(cacheKey, details);
          setNamespaceDetails(details);
        }
      } catch (e) {
        console.error(e);
        if (isLatest()) {
          // Only surface the error if we have no existing data to show.
          if (!hasExistingData) {
            setError(t('Failed to fetch managed namespace details'));
            setNamespaceDetails(null);
          }
        }
      } finally {
        if (isLatest()) {
          setLoading(false);
          setRevalidating(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [clusterName, projectId, subscription, resourceGroup, refreshTick]);

  // Pre-populate form when namespace details are fetched.
  // During background revalidation, skip re-populating formData if the user
  // has unsaved changes so edits are not clobbered.
  useEffect(() => {
    if (!namespaceDetails) return;
    if (hasUnsavedChangesRef.current) return;

    const quota = namespaceDetails.properties?.defaultResourceQuota;
    const policy = namespaceDetails.properties?.defaultNetworkPolicy;

    const populated: FormData = {
      ...DEFAULT_FORM_DATA,
      ingress: normalizePolicy(policy?.ingress ?? 'AllowSameNamespace'),
      egress: normalizePolicy(policy?.egress ?? 'AllowAll'),
      cpuRequest: parseMillicores(quota?.cpuRequest ?? '0m'),
      cpuLimit: parseMillicores(quota?.cpuLimit ?? '0m'),
      memoryRequest: parseMiB(quota?.memoryRequest ?? '0Mi'),
      memoryLimit: parseMiB(quota?.memoryLimit ?? '0Mi'),
    };

    setFormData(populated);
    setBaselineFormData(populated);
  }, [namespaceDetails]);

  const handleFormDataChange = useCallback((updates: Partial<FormData>) => {
    setFormData(prev => {
      const next = { ...prev, ...updates };

      const compute = validateComputeQuota({
        cpuRequest: next.cpuRequest,
        cpuLimit: next.cpuLimit,
        memoryRequest: next.memoryRequest,
        memoryLimit: next.memoryLimit,
      });
      const networking = validateNetworkingPolicies({
        ingress: next.ingress,
        egress: next.egress,
      });

      const fieldErrors: Record<string, string[]> = {};
      if (compute.fieldErrors) Object.assign(fieldErrors, compute.fieldErrors);
      if (!networking.isValid) fieldErrors.networking = networking.errors;

      setValidation({
        isValid: compute.isValid && networking.isValid,
        errors: [...(compute.errors || []), ...(networking.errors || [])],
        warnings: [],
        fieldErrors,
      });

      return next;
    });
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

  useEffect(() => {
    hasUnsavedChangesRef.current = hasChanges;
  }, [hasChanges]);

  const handleSave = useCallback(async () => {
    if (!resourceGroup || !clusterName || !projectId) return;

    try {
      setUpdating(true);
      await updateManagedNamespace({
        clusterName,
        resourceGroup,
        namespaceName: projectId,
        subscriptionId: subscription,
        ingressPolicy: formData.ingress,
        egressPolicy: formData.egress,
        cpuRequest: formData.cpuRequest,
        cpuLimit: formData.cpuLimit,
        memoryRequest: formData.memoryRequest,
        memoryLimit: formData.memoryLimit,
        noWait: false,
      });
      setBaselineFormData(formData);
      setError(null);
      // Invalidate cache so the next background fetch reflects the saved state.
      if (cacheKey) detailsCache.delete(cacheKey);
    } catch (e) {
      console.error('Failed to update managed namespace', e);
      setError(t('Failed to update managed namespace'));
    } finally {
      setUpdating(false);
    }
  }, [resourceGroup, clusterName, projectId, subscription, formData, cacheKey]);

  const handleRefresh = useCallback(() => {
    // Trigger a revalidation fetch while keeping existing cached/state data,
    // so the UI stays on the form and shows a background refresh instead of a cold-start spinner.
    setRefreshTick(n => n + 1);
  }, []);

  return {
    loading,
    revalidating,
    updating,
    error,
    namespaceDetails,
    formData,
    validation,
    hasChanges,
    handleFormDataChange,
    handleSave,
    handleRefresh,
  };
};
