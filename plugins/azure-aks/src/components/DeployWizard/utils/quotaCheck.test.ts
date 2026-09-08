// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkResourceQuota } from './quotaCheck';

vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  clusterRequest: vi.fn(),
}));

import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

const mockedClusterRequest = vi.mocked(clusterRequest);

function makeDeployment(
  name: string,
  resources: { requests?: Record<string, string>; limits?: Record<string, string> },
  replicas = 1
) {
  return {
    kind: 'Deployment',
    metadata: { name, namespace: 'test-ns' },
    spec: {
      replicas,
      template: {
        spec: {
          containers: [{ name: 'app', resources }],
        },
      },
    },
  };
}

function makeQuotaResponse(hard: Record<string, string>, used: Record<string, string>) {
  return {
    items: [
      {
        metadata: { name: 'defaultresourcequota' },
        spec: { hard },
        status: { hard, used },
      },
    ],
  };
}

describe('checkResourceQuota', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns empty warnings when no quota exists', async () => {
    mockedClusterRequest.mockResolvedValue({ items: [] });
    const doc = makeDeployment('app', {
      requests: { memory: '128Mi' },
      limits: { memory: '512Mi' },
    });
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toEqual([]);
  });

  it('returns empty warnings when resources fit within quota', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse(
        { 'requests.memory': '1Gi', 'limits.memory': '2Gi' },
        { 'requests.memory': '0', 'limits.memory': '0' }
      )
    );
    const doc = makeDeployment('app', {
      requests: { memory: '128Mi' },
      limits: { memory: '512Mi' },
    });
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toEqual([]);
  });

  it('returns warning when memory request exceeds remaining quota', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse(
        { 'requests.memory': '64Mi', 'limits.memory': '128Mi' },
        { 'requests.memory': '0', 'limits.memory': '0' }
      )
    );
    const doc = makeDeployment('app', {
      requests: { memory: '128Mi' },
      limits: { memory: '512Mi' },
    });
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toHaveLength(2);
    expect(warnings[0].resource).toBe('requests.memory');
    expect(warnings[1].resource).toBe('limits.memory');
  });

  it('returns warning when CPU exceeds remaining quota', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse(
        { 'requests.cpu': '100m', 'limits.cpu': '200m' },
        { 'requests.cpu': '50m', 'limits.cpu': '100m' }
      )
    );
    const doc = makeDeployment('app', {
      requests: { cpu: '100m' },
      limits: { cpu: '500m' },
    });
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings.some(w => w.resource === 'requests.cpu')).toBe(true);
    expect(warnings.some(w => w.resource === 'limits.cpu')).toBe(true);
  });

  it('multiplies resource totals by replica count', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '256Mi' }, { 'requests.memory': '0' })
    );
    // 128Mi * 3 replicas = 384Mi > 256Mi quota
    const doc = makeDeployment('app', { requests: { memory: '128Mi' } }, 3);
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].resource).toBe('requests.memory');
  });

  it('sums resources across multiple containers', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '200Mi' }, { 'requests.memory': '0' })
    );
    const doc = {
      kind: 'Deployment',
      metadata: { name: 'app', namespace: 'test-ns' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [
              { name: 'main', resources: { requests: { memory: '128Mi' } } },
              { name: 'sidecar', resources: { requests: { memory: '128Mi' } } },
            ],
          },
        },
      },
    };
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].resource).toBe('requests.memory');
  });

  it('skips non-pod-template resources', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '64Mi' }, { 'requests.memory': '0' })
    );
    const service = {
      kind: 'Service',
      metadata: { name: 'svc' },
      spec: { type: 'ClusterIP' },
    };
    const configMap = {
      kind: 'ConfigMap',
      metadata: { name: 'cfg' },
      data: { key: 'value' },
    };
    const warnings = await checkResourceQuota([service, configMap], 'test-ns');
    expect(warnings).toEqual([]);
  });

  it('returns empty array on fetch failure (fail-open)', async () => {
    mockedClusterRequest.mockRejectedValue(new Error('Forbidden'));
    const doc = makeDeployment('app', {
      requests: { memory: '128Mi' },
      limits: { memory: '512Mi' },
    });
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toEqual([]);
  });

  it('uses parallelism for Job resource accounting', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '256Mi' }, { 'requests.memory': '0' })
    );
    const job = {
      kind: 'Job',
      metadata: { name: 'batch', namespace: 'test-ns' },
      spec: {
        parallelism: 3,
        completions: 10,
        template: {
          spec: {
            containers: [{ name: 'worker', resources: { requests: { memory: '128Mi' } } }],
          },
        },
      },
    };
    // 128Mi * 3 (parallelism, NOT completions) = 384Mi > 256Mi
    const warnings = await checkResourceQuota([job], 'test-ns');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].resource).toBe('requests.memory');
  });

  it('defaults Job replica count to 1 when parallelism is not set', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '256Mi' }, { 'requests.memory': '0' })
    );
    const job = {
      kind: 'Job',
      metadata: { name: 'batch', namespace: 'test-ns' },
      spec: {
        template: {
          spec: {
            containers: [{ name: 'worker', resources: { requests: { memory: '128Mi' } } }],
          },
        },
      },
    };
    // 128Mi * 1 = 128Mi < 256Mi → no warning
    const warnings = await checkResourceQuota([job], 'test-ns');
    expect(warnings).toEqual([]);
  });

  it('ignores completions when parallelism is not set (defaults to 1)', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '256Mi' }, { 'requests.memory': '0' })
    );
    const job = {
      kind: 'Job',
      metadata: { name: 'batch', namespace: 'test-ns' },
      spec: {
        completions: 10,
        template: {
          spec: {
            containers: [{ name: 'worker', resources: { requests: { memory: '128Mi' } } }],
          },
        },
      },
    };
    // completions should NOT be used as replica count — only parallelism matters
    // 128Mi * 1 (default) = 128Mi < 256Mi → no warning
    const warnings = await checkResourceQuota([job], 'test-ns');
    expect(warnings).toEqual([]);
  });

  it('skips non-pod-template resources in mixed docs', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '64Mi' }, { 'requests.memory': '0' })
    );
    const deployment = makeDeployment('app', {
      requests: { memory: '128Mi' },
    });
    const service = {
      kind: 'Service',
      metadata: { name: 'svc' },
    };
    const warnings = await checkResourceQuota([deployment, service], 'test-ns');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].resource).toBe('requests.memory');
  });

  it('picks the most restrictive quota when multiple ResourceQuotas exist', async () => {
    mockedClusterRequest.mockResolvedValue({
      items: [
        {
          metadata: { name: 'team-quota' },
          spec: { hard: { 'requests.memory': '512Mi' } },
          status: { hard: { 'requests.memory': '512Mi' }, used: { 'requests.memory': '0' } },
        },
        {
          metadata: { name: 'ns-quota' },
          spec: { hard: { 'requests.memory': '128Mi' } },
          status: { hard: { 'requests.memory': '128Mi' }, used: { 'requests.memory': '0' } },
        },
      ],
    });
    // 256Mi > 128Mi (the more restrictive quota)
    const doc = makeDeployment('app', { requests: { memory: '256Mi' } });
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].resource).toBe('requests.memory');
    expect(warnings[0].remaining).toBe('128Mi');
  });

  it('handles StatefulSet resources', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '256Mi' }, { 'requests.memory': '0' })
    );
    const statefulSet = {
      kind: 'StatefulSet',
      metadata: { name: 'db', namespace: 'test-ns' },
      spec: {
        replicas: 3,
        template: {
          spec: {
            containers: [{ name: 'db', resources: { requests: { memory: '128Mi' } } }],
          },
        },
      },
    };
    // 128Mi * 3 = 384Mi > 256Mi
    const warnings = await checkResourceQuota([statefulSet], 'test-ns');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].resource).toBe('requests.memory');
  });

  it('handles containers with no resources field', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse({ 'requests.memory': '64Mi' }, { 'requests.memory': '0' })
    );
    const doc = {
      kind: 'Deployment',
      metadata: { name: 'app', namespace: 'test-ns' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [{ name: 'app', image: 'nginx' }],
          },
        },
      },
    };
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toEqual([]);
  });

  it('includes human-readable requested, remaining, and limit values in warnings', async () => {
    mockedClusterRequest.mockResolvedValue(
      makeQuotaResponse(
        { 'requests.memory': '64Mi', 'requests.cpu': '100m' },
        { 'requests.memory': '0', 'requests.cpu': '0' }
      )
    );
    const doc = makeDeployment('app', {
      requests: { memory: '128Mi', cpu: '200m' },
    });
    const warnings = await checkResourceQuota([doc], 'test-ns');
    expect(warnings).toHaveLength(2);

    const memWarning = warnings.find(w => w.resource === 'requests.memory')!;
    expect(memWarning.requested).toBe('128Mi');
    expect(memWarning.remaining).toBe('64Mi');
    expect(memWarning.limit).toBe('64Mi');

    const cpuWarning = warnings.find(w => w.resource === 'requests.cpu')!;
    expect(cpuWarning.requested).toBe('200m');
    expect(cpuWarning.remaining).toBe('100m');
    expect(cpuWarning.limit).toBe('100m');
  });
});
