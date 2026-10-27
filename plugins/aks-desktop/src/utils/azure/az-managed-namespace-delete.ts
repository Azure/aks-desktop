// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { K8S_DNS_LABEL_PATTERN } from '../kubernetes/k8sNames';
import type { ClusterType } from './aks';
import { getErrorMessage, isValidGuid } from './az-cli-core';
import {
  ARM_ENDPOINT,
  type AzRequestOptions,
  azRequestRaw,
  type AzResponse,
  AzureRequestError,
  waitForAzureRetry,
} from './az-http';
import { getSubscriptionCredential } from './az-token';

/**
 * Managed namespace coordinates and transport overrides. timeoutMs defaults to
 * ten minutes for the entire DELETE/poll sequence, not one minute per HTTP request.
 */
export type ManagedNamespaceDeleteOptions = Pick<
  AzRequestOptions,
  'credential' | 'tenantId' | 'endpoint' | 'scope' | 'signal' | 'timeoutMs'
> & {
  /** Explicit Azure subscription GUID used by the URL and default credential. */
  subscriptionId: string;
  /** Cluster resource group; parent dot segments and slashes are rejected. */
  resourceGroup: string;
  /** Managed AKS resource name, not a kubeconfig context or ARM ID. */
  clusterName: string;
  /** Kubernetes DNS-1123 label, validated before authentication or HTTP. */
  namespaceName: string;
  /** Optional discriminator; Arc is rejected before any managed-namespace request. */
  clusterType?: ClusterType;
};

/** Fields used from ARM operation-status and managed-namespace polling responses. */
interface OperationStatus {
  /** Long-running operation state, for example InProgress, Succeeded or Failed. */
  status?: string;
  /** Failure detail accompanying a terminal operation state. */
  error?: {
    /** Azure service failure code. */
    code?: string;
    /** Service-provided operation diagnostic. */
    message?: string;
  };
  /** Managed namespace properties returned while checking resource disappearance. */
  properties?: {
    /** Failed/canceled/delete-failed states stop the deletion wait. */
    provisioningState?: string;
  };
}

/**
 * @param status - Optional body from a DELETE or operation-status response.
 * @returns Nothing when no terminal failure is present.
 * @throws {AzureRequestError} For Failed/Canceled/Cancelled, preserving service details.
 */
function checkOperation(status: OperationStatus | undefined) {
  if (status?.status && ['Failed', 'Canceled', 'Cancelled'].includes(status.status)) {
    throw new AzureRequestError(
      `Managed namespace deletion ${status.status}: ${status.error?.message ?? 'operation failed'}`,
      { code: status.error?.code }
    );
  }
}

/**
 * @param error - Failure from the namespace resource request, not an operation URL.
 * @returns True only for HTTP 404 with a recognized namespace/parent absence code.
 */
function isAbsent(error: unknown): boolean {
  return (
    error instanceof AzureRequestError &&
    error.status === 404 &&
    [
      'ResourceNotFound',
      'NotFound',
      'ParentResourceNotFound',
      'ResourceGroupNotFound',
      'NamespaceNotFound',
    ].includes(error.code ?? '')
  );
}

/**
 * Deletes the ARM resource while honoring its existing Kubernetes Keep/Delete policy.
 * @param options - Validated namespace identity and optional REST/authentication controls.
 * @returns Resolved success only after known absence, including an already absent
 * namespace. stdout/stderr are empty; error reports invalid input, denial,
 * operation failure, cancellation or timeout rather than rejecting.
 * Trusted same-origin operation polling and resource disappearance share one budget.
 * This helper never independently deletes a Kubernetes namespace or changes its policy.
 */
export async function deleteManagedNamespaceViaRest(
  options: ManagedNamespaceDeleteOptions
): Promise<{
  /** Whether ARM completion and namespace absence were confirmed. */
  success: boolean;
  /** Empty compatibility field; no CLI stdout exists for REST deletion. */
  stdout: string;
  /** Empty compatibility field; inspect error for failures. */
  stderr: string;
  /** User-facing diagnostic when success is false. */
  error?: string;
}> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new Error('Managed namespace deletion timed out')),
    timeoutMs
  );
  try {
    if (options.clusterType && options.clusterType !== 'aks') {
      throw new AzureRequestError('Managed namespace deletion does not support Arc clusters');
    }
    if (
      typeof options.namespaceName !== 'string' ||
      !K8S_DNS_LABEL_PATTERN.test(options.namespaceName)
    ) {
      throw new AzureRequestError('Invalid Kubernetes namespace name');
    }
    if (
      !isValidGuid(options.subscriptionId) ||
      ![options.resourceGroup, options.clusterName].every(
        value => value?.trim() && !['.', '..'].includes(value) && !/[/\\]/.test(value)
      )
    ) {
      throw new AzureRequestError(
        'Valid subscription, resource group, cluster and namespace are required'
      );
    }
    const url = `/subscriptions/${encodeURIComponent(
      options.subscriptionId
    )}/resourceGroups/${encodeURIComponent(
      options.resourceGroup
    )}/providers/Microsoft.ContainerService/managedClusters/${encodeURIComponent(
      options.clusterName
    )}/managedNamespaces/${encodeURIComponent(options.namespaceName)}`;
    const request = {
      ...options,
      credential: options.credential ?? getSubscriptionCredential(options.subscriptionId),
      signal: controller.signal,
      timeoutMs,
      apiVersion: '2026-01-01',
    };
    let response: AzResponse<OperationStatus>;
    try {
      response = await azRequestRaw<OperationStatus>({ ...request, url, method: 'DELETE' });
    } catch (error) {
      if (isAbsent(error)) return { success: true, stdout: '', stderr: '' };
      throw error;
    }
    checkOperation(response.data);
    const asyncHeader = response.headers.get('azure-asyncoperation');
    const locationHeader = response.headers.get('location');
    const resourceUrl = new URL(url, options.endpoint ?? ARM_ENDPOINT);
    const operationHeader = asyncHeader || locationHeader;
    let operation = operationHeader ? new URL(operationHeader, resourceUrl) : undefined;
    if (operation && operation.origin !== resourceUrl.origin) {
      throw new AzureRequestError('Refusing to poll deletion on an untrusted host');
    }
    let headers = response.headers;
    for (;;) {
      await waitForAzureRetry(headers, controller.signal);
      if (operation) {
        const progress = await azRequestRaw<OperationStatus>({ ...request, url: operation.href });
        headers = progress.headers;
        const state = progress.data?.status;
        checkOperation(progress.data);
        if (asyncHeader && !state) {
          throw new AzureRequestError('Deletion operation response is missing its status');
        }
        if (state ? state !== 'Succeeded' : progress.status === 202) continue;
        operation = undefined;
      }
      try {
        const resource = await azRequestRaw<OperationStatus>({ ...request, url });
        headers = resource.headers;
        if (
          ['Failed', 'Canceled', 'Cancelled', 'DeleteFailed'].includes(
            resource.data?.properties?.provisioningState ?? ''
          )
        ) {
          throw new AzureRequestError('Managed namespace deletion failed');
        }
      } catch (error) {
        if (!isAbsent(error)) throw error;
        return { success: true, stdout: '', stderr: '' };
      }
    }
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      error: `Failed to delete managed namespace: ${getErrorMessage(error)}`,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
