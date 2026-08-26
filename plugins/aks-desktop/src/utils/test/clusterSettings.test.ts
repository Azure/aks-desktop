// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, test } from 'vitest';
import { getClusterSettings, setClusterSettings } from '../shared/clusterSettings';

describe('clusterSettings', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('getClusterSettings', () => {
    test('returns empty object when no settings exist', () => {
      const settings = getClusterSettings('my-cluster');
      expect(settings).toEqual({});
      expect(settings.allowedNamespaces).toBeUndefined();
    });

    test('returns parsed settings from localStorage', () => {
      localStorage.setItem(
        'cluster_settings.my-cluster',
        JSON.stringify({ allowedNamespaces: ['ns-a', 'ns-b'], theme: 'dark' })
      );

      const settings = getClusterSettings('my-cluster');
      expect(settings.allowedNamespaces).toEqual(['ns-a', 'ns-b']);
      expect(settings.theme).toBe('dark');
    });

    test('reads settings through a case-insensitive cluster name', () => {
      localStorage.setItem(
        'cluster_settings.MyCluster',
        JSON.stringify({ azureRegistration: { subscriptionId: 'sub-1', resourceGroup: 'rg-1' } })
      );

      expect(getClusterSettings('mycluster').azureRegistration).toEqual({
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
      });
    });

    test('returns empty settings when case-variant keys are ambiguous', () => {
      localStorage.setItem(
        'cluster_settings.MyCluster',
        JSON.stringify({ azureRegistration: { subscriptionId: 'sub-1', resourceGroup: 'rg-1' } })
      );
      localStorage.setItem(
        'cluster_settings.mycluster',
        JSON.stringify({ azureRegistration: { subscriptionId: 'sub-2', resourceGroup: 'rg-2' } })
      );

      expect(getClusterSettings('MyCluster')).toEqual({});
      expect(getClusterSettings('mycluster')).toEqual({});
    });

    test('returns empty object for invalid JSON', () => {
      localStorage.setItem('cluster_settings.my-cluster', 'not-json{{{');

      const settings = getClusterSettings('my-cluster');
      expect(settings).toEqual({});
    });

    test('returns empty object when stored value is null JSON', () => {
      localStorage.setItem('cluster_settings.my-cluster', 'null');

      const settings = getClusterSettings('my-cluster');
      expect(settings).toEqual({});
    });

    test('returns empty object when stored value is a JSON array', () => {
      localStorage.setItem('cluster_settings.my-cluster', '[1,2,3]');

      const settings = getClusterSettings('my-cluster');
      expect(settings.allowedNamespaces).toBeUndefined();
      expect(Object.keys(settings)).toHaveLength(0);
    });

    test('different cluster names are independent', () => {
      localStorage.setItem(
        'cluster_settings.cluster-a',
        JSON.stringify({ allowedNamespaces: ['ns-a'] })
      );
      localStorage.setItem(
        'cluster_settings.cluster-b',
        JSON.stringify({ allowedNamespaces: ['ns-b'] })
      );

      const a = getClusterSettings('cluster-a');
      const b = getClusterSettings('cluster-b');
      expect(a.allowedNamespaces).toEqual(['ns-a']);
      expect(b.allowedNamespaces).toEqual(['ns-b']);
    });
  });

  describe('setClusterSettings', () => {
    test('writes settings to localStorage', () => {
      setClusterSettings('my-cluster', { allowedNamespaces: ['ns-1'] });

      const raw = localStorage.getItem('cluster_settings.my-cluster');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.allowedNamespaces).toEqual(['ns-1']);
    });

    test('overwrites existing settings', () => {
      setClusterSettings('my-cluster', { allowedNamespaces: ['ns-1'] });
      setClusterSettings('my-cluster', { allowedNamespaces: ['ns-2'], newKey: true });

      const settings = getClusterSettings('my-cluster');
      expect(settings.allowedNamespaces).toEqual(['ns-2']);
      expect(settings.newKey).toBe(true);
    });

    test('preserves an existing case-variant storage key', () => {
      localStorage.setItem(
        'cluster_settings.MyCluster',
        JSON.stringify({ allowedNamespaces: ['ns-1'] })
      );

      setClusterSettings('mycluster', { allowedNamespaces: ['ns-2'] });

      expect(localStorage.getItem('cluster_settings.mycluster')).toBeNull();
      expect(getClusterSettings('MYCLUSTER').allowedNamespaces).toEqual(['ns-2']);
    });

    test('rejects writes when case-variant keys are ambiguous', () => {
      localStorage.setItem(
        'cluster_settings.MyCluster',
        JSON.stringify({ allowedNamespaces: ['ns-1'] })
      );
      localStorage.setItem(
        'cluster_settings.mycluster',
        JSON.stringify({ allowedNamespaces: ['ns-2'] })
      );

      expect(() => setClusterSettings('MYCLUSTER', { allowedNamespaces: ['ns-3'] })).toThrow(
        "Multiple settings entries exist for cluster 'MYCLUSTER'."
      );
      expect(JSON.parse(localStorage.getItem('cluster_settings.MyCluster')!)).toEqual({
        allowedNamespaces: ['ns-1'],
      });
      expect(JSON.parse(localStorage.getItem('cluster_settings.mycluster')!)).toEqual({
        allowedNamespaces: ['ns-2'],
      });
    });
  });
});
