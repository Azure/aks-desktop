// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { clusterAction, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import type { KubeNamespace } from '@kinvolk/headlamp-plugin/lib/lib/k8s/namespace';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import {
  getManagedNamespaceDetails,
  updateManagedNamespace,
} from '../../../utils/azure/az-namespaces';
import {
  getManagedNamespaceAuthState,
  type ManagedNamespaceDetails,
  managedNamespaceQueryKey,
  type ManagedNamespaceTarget,
  subscribeManagedNamespaceAuth,
} from '../../../utils/azure/managedNamespaceQueries';
import { RESOURCE_GROUP_LABEL, SUBSCRIPTION_LABEL } from '../../../utils/constants/projectLabels';
import { supportsManagedNamespaceSettings } from '../../../utils/shared/isAksProject';
import {
  DEFAULT_FORM_DATA,
  type FormData,
  type ValidationState,
} from '../../CreateAKSProject/types';
import {
  validateComputeQuota,
  validateNetworkingPolicies,
} from '../../CreateAKSProject/validators';

const fields = [
  'ingress',
  'egress',
  'cpuRequest',
  'cpuLimit',
  'memoryRequest',
  'memoryLimit',
] as const;

function equalSettings(a: FormData, b: FormData) {
  return fields.every(field => a[field] === b[field]);
}

function readForm(details?: ManagedNamespaceDetails): FormData {
  const policy = details?.properties?.defaultNetworkPolicy;
  const quota = details?.properties?.defaultResourceQuota;
  const normalizePolicy = (value?: string): FormData['ingress'] =>
    value === 'AllowAll' || value === 'DenyAll' ? value : 'AllowSameNamespace';
  const parseQuota = (value?: string) => {
    const parsed = parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    ...DEFAULT_FORM_DATA,
    ingress: normalizePolicy(policy?.ingress),
    egress: normalizePolicy(policy?.egress),
    cpuRequest: parseQuota(quota?.cpuRequest),
    cpuLimit: parseQuota(quota?.cpuLimit),
    memoryRequest: parseQuota(quota?.memoryRequest),
    memoryLimit: parseQuota(quota?.memoryLimit),
  };
}

function validateForm(form: FormData): ValidationState {
  const compute = validateComputeQuota(form);
  const networking = validateNetworkingPolicies(form);
  return {
    isValid: compute.isValid && networking.isValid,
    errors: [...compute.errors, ...networking.errors],
    warnings: [],
    fieldErrors: {
      ...compute.fieldErrors,
      ...(!networking.isValid ? { networking: networking.errors } : {}),
    },
  };
}

function savedDetails(
  previous: ManagedNamespaceDetails,
  response: ManagedNamespaceDetails,
  form: FormData
): ManagedNamespaceDetails {
  return {
    ...previous,
    ...response,
    properties: {
      ...previous.properties,
      ...response.properties,
      defaultNetworkPolicy: {
        ...previous.properties?.defaultNetworkPolicy,
        ingress: form.ingress,
        egress: form.egress,
        ...response.properties?.defaultNetworkPolicy,
      },
      defaultResourceQuota: {
        ...previous.properties?.defaultResourceQuota,
        cpuRequest: `${form.cpuRequest}m`,
        cpuLimit: `${form.cpuLimit}m`,
        memoryRequest: `${form.memoryRequest}Mi`,
        memoryLimit: `${form.memoryLimit}Mi`,
        ...response.properties?.defaultResourceQuota,
      },
    },
  };
}

interface Draft {
  owner: string;
  baseline: FormData;
  values: FormData;
}

interface Submission {
  target: ManagedNamespaceTarget;
  key: ReturnType<typeof managedNamespaceQueryKey>;
  owner: string;
  generation: number;
  values: FormData;
  snapshot: ManagedNamespaceDetails;
}

/** Keeps query-backed server settings separate from the user's unsaved draft. */
export function useInfoTab(project: { clusters: string[]; namespaces: string[]; id: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const auth = useSyncExternalStore(subscribeManagedNamespaceAuth, getManagedNamespaceAuthState);
  const clusterName = project.clusters[0];
  const namespaceName = project.namespaces[0];
  const singleNamespace = project.clusters.length === 1 && project.namespaces.length === 1;
  const metadataKey = [
    'aks-desktop',
    'managed-namespace',
    'metadata',
    auth.generation,
    clusterName,
    namespaceName,
  ] as const;
  const metadata = useQuery({
    queryKey: metadataKey,
    enabled: auth.ready && singleNamespace,
    queryFn: async (): Promise<KubeNamespace> =>
      clusterRequest(`/api/v1/namespaces/${encodeURIComponent(namespaceName)}`, {
        cluster: clusterName,
        method: 'GET',
      }),
  });
  const labels = metadata.data?.metadata?.labels;
  const subscriptionId = labels?.[SUBSCRIPTION_LABEL];
  const resourceGroup = labels?.[RESOURCE_GROUP_LABEL];
  const target: ManagedNamespaceTarget | null =
    singleNamespace &&
    labels &&
    subscriptionId &&
    resourceGroup &&
    supportsManagedNamespaceSettings(labels, clusterName)
      ? { subscriptionId, resourceGroup, clusterName, namespaceName }
      : null;
  const key = managedNamespaceQueryKey(target, auth.generation);
  const owner = JSON.stringify(key);
  const mutationKey = [...key, 'update'];
  const updating = useIsMutating({ mutationKey, exact: true }) > 0;
  const query = useQuery({
    queryKey: key,
    enabled: auth.ready && target !== null && !updating,
    queryFn: () => {
      if (!target) throw new Error('Namespace target is unavailable');
      return getManagedNamespaceDetails(target);
    },
  });
  const [draft, setDraft] = useState<Draft>();
  const [actionError, setActionError] = useState<{ owner: string; message: string }>();
  const currentDraft = draft?.owner === owner ? draft : undefined;
  const hasChanges = !!currentDraft && !equalSettings(currentDraft.values, currentDraft.baseline);
  const formData = hasChanges ? currentDraft.values : readForm(query.data);
  const baseline = hasChanges ? currentDraft.baseline : formData;
  const validation = validateForm(formData);

  const mutation = useMutation({
    mutationKey,
    mutationFn: async (submission: Submission) => {
      await client.cancelQueries({ queryKey: submission.key, exact: true });
      const currentAuth = getManagedNamespaceAuthState();
      if (!currentAuth.ready || currentAuth.generation !== submission.generation) {
        throw new Error(t('Azure account changed. Sign in and try again.'));
      }
      return updateManagedNamespace({
        ...submission.target,
        ingressPolicy: submission.values.ingress,
        egressPolicy: submission.values.egress,
        cpuRequest: submission.values.cpuRequest,
        cpuLimit: submission.values.cpuLimit,
        memoryRequest: submission.values.memoryRequest,
        memoryLimit: submission.values.memoryLimit,
      });
    },
    onSuccess: async (response, submission) => {
      await client.cancelQueries({ queryKey: submission.key, exact: true });
      const currentAuth = getManagedNamespaceAuthState();
      if (!currentAuth.ready || currentAuth.generation !== submission.generation) return;
      const saved = savedDetails(submission.snapshot, response, submission.values);
      client.setQueryData(submission.key, saved);
      setDraft(previous =>
        previous?.owner === submission.owner
          ? {
              owner: submission.owner,
              baseline: readForm(saved),
              values: equalSettings(previous.values, submission.values)
                ? readForm(saved)
                : previous.values,
            }
          : previous
      );
    },
  });

  const handleSave = () => {
    if (client.isMutating({ mutationKey, exact: true })) return;
    if (!auth.ready || !target || !query.data || !validation.isValid || !hasChanges) {
      setActionError({ owner, message: t('Namespace settings are not ready to save.') });
      return;
    }
    setActionError(undefined);
    const submission: Submission = {
      target,
      key,
      owner,
      generation: auth.generation,
      values: { ...formData },
      snapshot: query.data,
    };
    clusterAction(() => mutation.mutateAsync(submission), {
      startMessage: t('Updating namespace {{ name }}…', { name: namespaceName }),
      cancelledMessage: t('Cancelled update of namespace {{ name }}.', { name: namespaceName }),
      successMessage: t('Updated namespace {{ name }}.', { name: namespaceName }),
      errorMessage: t('Failed to update namespace {{ name }}.', { name: namespaceName }),
      startOptions: { autoHideDuration: null },
    });
  };

  const handleRefresh = () => {
    if (!auth.ready || client.isMutating({ mutationKey, exact: true })) return;
    setActionError(undefined);
    if (target) void query.refetch({ cancelRefetch: false });
    else void metadata.refetch({ cancelRefetch: false });
  };

  const failure = metadata.error ?? query.error;
  let error: string | null = null;
  if (!auth.ready) error = t('Sign in to Azure to manage namespace settings.');
  else if (!singleNamespace) error = t('Select a project with one cluster and one namespace.');
  else if (failure) {
    error = `${t('Failed to fetch managed namespace details')}: ${failure.message}`;
  } else if (metadata.data && !target) {
    error = t('Managed namespace settings are unavailable for this project.');
  }
  const saveError =
    actionError?.owner === owner
      ? actionError.message
      : mutation.variables?.owner === owner
      ? mutation.error?.message ?? null
      : null;

  return {
    loading: auth.ready && singleNamespace && !error && !query.data,
    revalidating: query.isFetching && !!query.data,
    updating,
    canRefresh: auth.ready && singleNamespace,
    error,
    saveError,
    namespaceDetails: auth.ready && target ? query.data ?? null : null,
    formData,
    validation,
    hasChanges,
    hasRemoteChanges:
      hasChanges && !!query.data && !equalSettings(readForm(query.data), currentDraft.baseline),
    handleFormDataChange: (updates: Partial<FormData>) =>
      setDraft(previous => ({
        owner,
        baseline,
        values: {
          ...(previous?.owner === owner && !equalSettings(previous.values, previous.baseline)
            ? previous.values
            : formData),
          ...updates,
        },
      })),
    handleSave,
    handleRefresh,
  };
}
