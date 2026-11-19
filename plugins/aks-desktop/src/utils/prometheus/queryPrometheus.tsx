// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { AccessToken, TokenCredential } from '@azure/identity';
import { createAzureRequestSignal } from '../azure/az-http';
import { getSubscriptionCredential, withAbort } from '../azure/az-token';

const PROMETHEUS_SCOPE = 'https://prometheus.monitor.azure.com/.default';
const inFlightRefreshes = new Map<string, Promise<AccessToken>>();

function refreshPrometheusToken(
  subscription: string,
  credential: TokenCredential,
  rejectedToken: string,
  signal: AbortSignal
): Promise<AccessToken> {
  const key = `${subscription}|${rejectedToken}`;
  const pending = inFlightRefreshes.get(key);
  if (pending) {
    return withAbort(() => pending, signal);
  }
  const refresh = (async () => {
    if ('clearCache' in credential && typeof credential.clearCache === 'function') {
      (credential.clearCache as (scope?: string) => void)(PROMETHEUS_SCOPE);
    }
    const next = await credential.getToken(PROMETHEUS_SCOPE);
    if (!next?.token) {
      throw new Error('Failed to acquire Prometheus access token');
    }
    return next;
  })();
  inFlightRefreshes.set(key, refresh);
  const cleanup = () => {
    if (inFlightRefreshes.get(key) === refresh) {
      inFlightRefreshes.delete(key);
    }
  };
  void refresh.then(cleanup, cleanup);
  return withAbort(() => refresh, signal);
}

export interface QueryPrometheusOptions {
  /** Optional token credential override (defaults to subscription-bound CLI credential). */
  credential?: TokenCredential;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
  /** Optional request timeout in milliseconds (defaults to 60s). */
  timeoutMs?: number;
}

/**
 * Executes a PromQL range query against the given Azure Monitor Prometheus endpoint.
 * Acquires and caches/refreshes the `https://prometheus.monitor.azure.com/.default`
 * token via the shared subscription credential without invoking CLI subprocesses directly.
 *
 * @param endpoint - HTTPS Prometheus query endpoint URL.
 * @param query - PromQL query string.
 * @param start - Range start (Unix epoch seconds).
 * @param end - Range end (Unix epoch seconds).
 * @param step - Query resolution step in seconds.
 * @param subscription - Azure subscription ID used to acquire the access token.
 * @param options - Optional credential, cancellation, and timeout controls.
 * @returns Array of Prometheus result objects, or an empty array on failure.
 */
export async function queryPrometheus(
  endpoint: string,
  query: string,
  start: number,
  end: number,
  step = 60,
  subscription: string,
  options: QueryPrometheusOptions = {}
): Promise<any[]> {
  const linked = createAzureRequestSignal(options.signal, options.timeoutMs);
  try {
    const baseUrl = endpoint.trim().replace(/\/+$/, '');
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:') {
      throw new Error('Prometheus query endpoint must use HTTPS');
    }

    const credential = options.credential ?? getSubscriptionCredential(subscription);
    const rangeUrl = `${baseUrl}/api/v1/query_range`;

    const formData = new URLSearchParams();
    formData.append('query', query);
    formData.append('start', start.toString());
    formData.append('end', end.toString());
    formData.append('step', step.toString());

    const sendQuery = async (accessToken: AccessToken) => {
      if (!accessToken?.token) {
        throw new Error('Failed to acquire Prometheus access token');
      }
      return fetch(rangeUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData,
        signal: linked.signal,
      });
    };

    let accessToken = await withAbort(
      () => credential.getToken(PROMETHEUS_SCOPE, { abortSignal: linked.signal }),
      linked.signal
    );
    let response = await sendQuery(accessToken);
    if (response.status === 401 && !options.credential) {
      accessToken = await refreshPrometheusToken(
        subscription,
        credential,
        accessToken.token,
        linked.signal
      );
      response = await sendQuery(accessToken);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'success' && data.data.result) {
      return data.data.result;
    }

    return [];
  } catch (error) {
    console.error('MetricsTab: Prometheus query failed:', error);
    return [];
  } finally {
    linked.dispose();
  }
}
