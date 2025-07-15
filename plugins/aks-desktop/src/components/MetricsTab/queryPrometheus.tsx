// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { runCommandWithOutput } from '../../utils/kubernetes';

// Helper to query Prometheus
export async function queryPrometheus(
  endpoint: string,
  query: string,
  start: number,
  end: number,
  step = 60,
  subscription: string
): Promise<any[]> {
  try {
    const { stdout: tokenStdout } = await runCommandWithOutput('az', [
      'account',
      'get-access-token',
      '--resource',
      'https://prometheus.monitor.azure.com/',
      '--query',
      'accessToken',
      '-o',
      'tsv',
      '--subscription',
      subscription,
    ]);

    const token = tokenStdout.trim();
    const rangeUrl = `${endpoint}/api/v1/query_range`;

    const formData = new URLSearchParams();
    formData.append('query', query);
    formData.append('start', start.toString());
    formData.append('end', end.toString());
    formData.append('step', step.toString());

    const response = await fetch(rangeUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
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
