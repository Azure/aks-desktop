// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { getErrorMessage } from './az-cli-core';
import { getAzureCloudEndpoints } from './az-cloud';
import { azRequest, type AzRequestOptions } from './az-http';
import { getSubscriptionCredential } from './az-token';

/** Authentication/cloud overrides and one budget for registration plus optional polling. */
type RegistrationOptions = Pick<
  AzRequestOptions,
  'credential' | 'endpoint' | 'scope' | 'tenantId' | 'signal' | 'timeoutMs'
> & {
  /** If true, poll until Registered; false/omitted returns once registration is accepted. */
  waitUntilRegistered?: boolean;
  /** Selected account's CLI cloud; explicit endpoint/scope overrides take precedence. */
  cloudName?: string;
};

/** ARM provider fields used to distinguish accepted registration from completion. */
interface ResourceProvider {
  /** Provider namespace, normally Microsoft.ContainerService. */
  namespace?: string;
  /** Azure state such as Registering or Registered; may be absent on HTTP 202. */
  registrationState?: string;
}

/**
 * Requests idempotent registration on the selected subscription. Success means
 * accepted, not completed, unless `waitUntilRegistered` is requested.
 * @param subscriptionId - Explicit subscription GUID; never changes the CLI default.
 * @param options - Optional credential, tenant, cloud, endpoint/scope and abort signal.
 * The default credential is subscription-bound; timeoutMs defaults to 60 seconds
 * across cloud lookup, POST and any GET polling.
 * @returns A resolved result: success, optional last registrationState, or error.
 * Validation, HTTP, authentication, cancellation and timeout failures resolve with
 * success=false rather than rejecting.
 */
export async function registerContainerServiceProvider(
  subscriptionId: string,
  options: RegistrationOptions = {}
): Promise<{
  /** Whether the request was accepted, or completed when waiting was requested. */
  success: boolean;
  /** Last observed provider state; absent if Azure returned no provider body. */
  registrationState?: string;
  /** User-facing failure diagnostic, present when success is false. */
  error?: string;
}> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(
    () => controller.abort(new Error('Microsoft.ContainerService registration timed out')),
    options.timeoutMs ?? 60_000
  );

  try {
    if (!subscriptionId?.trim()) throw new Error('A subscription ID is required');
    const cloud = options.cloudName
      ? await getAzureCloudEndpoints(options.cloudName, controller.signal)
      : undefined;
    const url = `/subscriptions/${encodeURIComponent(
      subscriptionId
    )}/providers/Microsoft.ContainerService`;
    const request = {
      ...options,
      credential: options.credential ?? getSubscriptionCredential(subscriptionId),
      endpoint: options.endpoint ?? cloud?.endpoint,
      scope: options.scope ?? cloud?.scope,
      apiVersion: '2021-04-01',
      signal: controller.signal,
    };
    let provider = await azRequest<ResourceProvider>({
      ...request,
      url: `${url}/register`,
      method: 'POST',
    });

    while (options.waitUntilRegistered && provider?.registrationState !== 'Registered') {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(controller.signal.reason);
        };
        const timer = setTimeout(() => {
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        }, 1000);
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      provider = await azRequest<ResourceProvider>({ ...request, url });
    }

    return { success: true, registrationState: provider?.registrationState };
  } catch (error) {
    return {
      success: false,
      error: `Failed to register Microsoft.ContainerService provider: ${getErrorMessage(error)}`,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
