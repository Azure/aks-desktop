// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { azureCredential } from '../../azureAuth';

/**
 * Executes PromQL query against the given Prometheus endpoint.
 *
 * @param endpoint - Prometheus query endpoint URL.
 * @param query - PromQL query string.
 * @param start - Range start (Unix epoch seconds).
 * @param end - Range end (Unix epoch seconds).
 * @param step - Query resolution step in seconds.
 * @returns Array of Prometheus result objects, or an empty array on failure.
 */
export async function queryPrometheus(
  endpoint: string,
  query: string,
  start: number,
  end: number,
  step = 60
): Promise<any[]> {
  try {
    const credential = azureCredential;
    const accessToken = await credential.getToken('https://prometheus.monitor.azure.com/.default');
    if (!accessToken?.token) {
      throw new Error('Failed to acquire an Azure Monitor Prometheus access token');
    }

    const rangeUrl = `${endpoint}/api/v1/query_range`;

    const formData = new URLSearchParams();
    formData.append('query', query);
    formData.append('start', start.toString());
    formData.append('end', end.toString());
    formData.append('step', step.toString());
    // Fetch & acquire the Prometheus query results
    const response = await fetch(rangeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

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
  }
}
