// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, describe, expect, test } from 'vitest';
import {
  clusterSettingsKey,
  getClusterSettings,
  setClusterSettings,
} from '../shared/clusterSettings';

describe('clusterSettings', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('clusterSettingsKey', () => {
    test('returns legacy key when subscription/resourceGroup are absent', () => {
      expect(clusterSettingsKey('my-cluster')).toBe('cluster_settings.my-cluster');
    });

    test('returns disambiguated key when subscription and resourceGroup are provided', () => {
      expect(clusterSettingsKey('my-cluster', 'sub-1', 'rg-1')).toBe(
        'cluster_settings.sub-1.rg-1.my-cluster'
      );
    });

    test('returns legacy key when only one of subscription/resourceGroup is provided', () => {
      expect(clusterSettingsKey('my-cluster', 'sub-1')).toBe('cluster_settings.my-cluster');
      expect(clusterSettingsKey('my-cluster', undefined, 'rg-1')).toBe(
        'cluster_settings.my-cluster'
      );
    });
  });

  describe('getClusterSettings', () => {
    test('returns empty object when no settings exist', () => {
      const settings = getClusterSettings('my-cluster');
      expect(settings).toEqual({});
      expect(settings.allowedNamespaces).toBeUndefined();
    });

    test('returns parsed settings from localStorage (legacy key)', () => {
      localStorage.setItem(
        'cluster_settings.my-cluster',
        JSON.stringify({ allowedNamespaces: ['ns-a', 'ns-b'], theme: 'dark' })
      );

      const settings = getClusterSettings('my-cluster');
      expect(settings.allowedNamespaces).toEqual(['ns-a', 'ns-b']);
      expect(settings.theme).toBe('dark');
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

    test('reads from disambiguated key when subscription and resourceGroup are given', () => {
      localStorage.setItem(
        'cluster_settings.sub-1.rg-1.my-cluster',
        JSON.stringify({ clusterType: 'aksarc' })
      );

      const settings = getClusterSettings('my-cluster', 'sub-1', 'rg-1');
      expect(settings.clusterType).toBe('aksarc');
    });

    test('falls back to legacy key when disambiguated key has no entry and no other disambiguated entries exist', () => {
      localStorage.setItem('cluster_settings.my-cluster', JSON.stringify({ clusterType: 'aks' }));

      const settings = getClusterSettings('my-cluster', 'sub-1', 'rg-1');
      expect(settings.clusterType).toBe('aks');
    });

    test('does not fall back to legacy key when other disambiguated entries exist for same name', () => {
      localStorage.setItem('cluster_settings.my-cluster', JSON.stringify({ clusterType: 'aks' }));
      localStorage.setItem(
        'cluster_settings.sub-2.rg-2.my-cluster',
        JSON.stringify({ clusterType: 'aksarc' })
      );

      // sub-1/rg-1 has no entry, but sub-2/rg-2 does – legacy entry is ambiguous
      const settings = getClusterSettings('my-cluster', 'sub-1', 'rg-1');
      expect(settings).toEqual({});
    });

    test('same cluster name in different subs/rgs does not collide', () => {
      localStorage.setItem(
        'cluster_settings.sub-1.rg-a.cluster',
        JSON.stringify({ subscriptionId: 'sub-1', resourceGroup: 'rg-a' })
      );
      localStorage.setItem(
        'cluster_settings.sub-2.rg-b.cluster',
        JSON.stringify({ subscriptionId: 'sub-2', resourceGroup: 'rg-b' })
      );

      const a = getClusterSettings('cluster', 'sub-1', 'rg-a');
      const b = getClusterSettings('cluster', 'sub-2', 'rg-b');
      expect(a.subscriptionId).toBe('sub-1');
      expect(b.subscriptionId).toBe('sub-2');
    });

    test('finds unique disambiguated entry when called with only clusterName', () => {
      localStorage.setItem(
        'cluster_settings.sub-1.rg-1.my-cluster',
        JSON.stringify({ clusterType: 'aksarc', subscriptionId: 'sub-1' })
      );

      const settings = getClusterSettings('my-cluster');
      expect(settings.clusterType).toBe('aksarc');
      expect(settings.subscriptionId).toBe('sub-1');
    });

    test('returns legacy key when multiple disambiguated entries exist for same name', () => {
      localStorage.setItem(
        'cluster_settings.sub-1.rg-a.my-cluster',
        JSON.stringify({ subscriptionId: 'sub-1' })
      );
      localStorage.setItem(
        'cluster_settings.sub-2.rg-b.my-cluster',
        JSON.stringify({ subscriptionId: 'sub-2' })
      );
      localStorage.setItem('cluster_settings.my-cluster', JSON.stringify({ clusterType: 'aks' }));

      const settings = getClusterSettings('my-cluster');
      expect(settings.clusterType).toBe('aks');
    });
  });

  describe('setClusterSettings', () => {
    test('writes settings to localStorage (legacy key)', () => {
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

    test('writes to disambiguated key when subscriptionId/resourceGroup are present', () => {
      setClusterSettings('my-cluster', {
        clusterType: 'aksarc',
        subscriptionId: 'sub-1',
        resourceGroup: 'rg-1',
      });

      const raw = localStorage.getItem('cluster_settings.sub-1.rg-1.my-cluster');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.clusterType).toBe('aksarc');
    });
  });
});
