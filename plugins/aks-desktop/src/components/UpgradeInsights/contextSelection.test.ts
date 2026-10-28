// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it } from 'vitest';
import { cluster } from './__fixtures__/fixtures';
import { contextCandidates } from './contextSelection';

beforeEach(() => localStorage.clear());

describe('context scope disambiguation', () => {
  const other = { ...cluster, id: '/other-id', subscription: 'other', resourceGroup: 'other-rg' };
  it('does not select a cluster just because its name matches the context', () => {
    expect(contextCandidates([cluster, other], cluster.name)).toEqual([cluster, other]);
  });
  it('narrows by registered metadata, never display or context name', () => {
    localStorage.setItem(
      'cluster_settings.alias',
      JSON.stringify({
        azureRegistration: {
          subscriptionId: cluster.subscription.toUpperCase(),
          resourceGroup: 'RG',
        },
      })
    );
    expect(contextCandidates([cluster, other], 'alias')).toEqual([cluster]);
  });
  it('keeps duplicates within a registered scope available for explicit selection', () => {
    const duplicate = { ...cluster, id: '/second-id' };
    localStorage.setItem(
      'cluster_settings.alias',
      JSON.stringify({
        azureRegistration: { subscriptionId: cluster.subscription, resourceGroup: 'rg' },
      })
    );
    expect(contextCandidates([cluster, duplicate], 'alias')).toHaveLength(2);
  });
  it('does not use incomplete metadata or infer a default subscription', () => {
    localStorage.setItem(
      'cluster_settings.alias',
      JSON.stringify({
        azureRegistration: { resourceGroup: 'rg' },
      })
    );
    expect(contextCandidates([cluster, other], 'alias')).toHaveLength(2);
  });
  it('does not map an Arc context to an AKS cluster with the same name', () => {
    localStorage.setItem('cluster_settings.cluster', JSON.stringify({ clusterType: 'aksarc' }));
    expect(contextCandidates([cluster], 'cluster')).toEqual([]);
  });
  it('lets HOME inventory work without a Kubernetes context', () => {
    expect(contextCandidates([cluster])).toEqual([cluster]);
  });
});
