// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../constants';
import {
  ACTIVE_PIPELINE_KEY_PREFIX,
  clearActivePipeline,
  getActivePipeline,
  setActivePipeline,
} from './pipelineStorage';

describe('pipelineStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('getActivePipeline', () => {
    const cluster = 'my-cluster';
    const ns = 'production';
    const activeKey = `${ACTIVE_PIPELINE_KEY_PREFIX}${cluster}:${ns}`;
    const repo = { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' };
    const stateKey = `${STORAGE_KEY_PREFIX}testuser/my-repo`;

    it('should return repo and state for valid stored data', () => {
      localStorage.setItem(activeKey, JSON.stringify(repo));
      localStorage.setItem(
        stateKey,
        JSON.stringify({ __schemaVersion: SCHEMA_VERSION, deploymentState: 'AgentRunning' })
      );

      const result = getActivePipeline(cluster, ns);
      expect(result).toEqual({ repo, state: 'AgentRunning' });
    });

    it('should return null when active pipeline key is missing', () => {
      expect(getActivePipeline(cluster, ns)).toBeNull();
    });

    it('should return null for malformed JSON in active key', () => {
      localStorage.setItem(activeKey, 'not-valid-json{{{');

      expect(getActivePipeline(cluster, ns)).toBeNull();
    });

    it('should return null when repo data has wrong schema', () => {
      localStorage.setItem(activeKey, JSON.stringify({ wrongField: 'value' }));

      expect(getActivePipeline(cluster, ns)).toBeNull();
    });

    it('should return null when pipeline state has wrong schema version', () => {
      localStorage.setItem(activeKey, JSON.stringify(repo));
      localStorage.setItem(
        stateKey,
        JSON.stringify({ __schemaVersion: 999, deploymentState: 'AgentRunning' })
      );

      expect(getActivePipeline(cluster, ns)).toBeNull();
    });

    it('should return null when pipeline state key is missing', () => {
      localStorage.setItem(activeKey, JSON.stringify(repo));

      expect(getActivePipeline(cluster, ns)).toBeNull();
    });

    it('should return null for non-resumable state', () => {
      localStorage.setItem(activeKey, JSON.stringify(repo));
      localStorage.setItem(
        stateKey,
        JSON.stringify({ __schemaVersion: SCHEMA_VERSION, deploymentState: 'Configured' })
      );

      expect(getActivePipeline(cluster, ns)).toBeNull();
    });

    it('should return null for Deployed state (not resumable)', () => {
      localStorage.setItem(activeKey, JSON.stringify(repo));
      localStorage.setItem(
        stateKey,
        JSON.stringify({ __schemaVersion: SCHEMA_VERSION, deploymentState: 'Deployed' })
      );

      expect(getActivePipeline(cluster, ns)).toBeNull();
    });

    it('should return result for Failed state (resumable)', () => {
      localStorage.setItem(activeKey, JSON.stringify(repo));
      localStorage.setItem(
        stateKey,
        JSON.stringify({ __schemaVersion: SCHEMA_VERSION, deploymentState: 'Failed' })
      );

      const result = getActivePipeline(cluster, ns);
      expect(result).toEqual({ repo, state: 'Failed' });
    });
  });

  describe('setActivePipeline', () => {
    it('should write the correct key and JSON value', () => {
      const repo = { owner: 'testuser', repo: 'my-repo', defaultBranch: 'main' };
      setActivePipeline('cluster-1', 'ns-1', repo);

      const stored = localStorage.getItem(`${ACTIVE_PIPELINE_KEY_PREFIX}cluster-1:ns-1`);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(repo);
    });

    it('should not throw when localStorage is unavailable', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      expect(() =>
        setActivePipeline('cluster', 'ns', {
          owner: 'o',
          repo: 'r',
          defaultBranch: 'main',
        })
      ).not.toThrow();
    });
  });

  describe('clearActivePipeline', () => {
    it('should remove the active pipeline key', () => {
      const key = `${ACTIVE_PIPELINE_KEY_PREFIX}cluster:ns`;
      localStorage.setItem(key, JSON.stringify({ owner: 'o', repo: 'r', defaultBranch: 'main' }));

      clearActivePipeline('cluster', 'ns');

      expect(localStorage.getItem(key)).toBeNull();
    });

    it('should remove matching pipeline state entries', () => {
      const stateKey = `${STORAGE_KEY_PREFIX}owner/repo`;
      localStorage.setItem(
        stateKey,
        JSON.stringify({
          config: { clusterName: 'cluster', namespace: 'ns' },
          deploymentState: 'AgentRunning',
        })
      );

      clearActivePipeline('cluster', 'ns');

      expect(localStorage.getItem(stateKey)).toBeNull();
    });

    it('should not remove state entries for other clusters', () => {
      const stateKey = `${STORAGE_KEY_PREFIX}owner/repo`;
      localStorage.setItem(
        stateKey,
        JSON.stringify({
          config: { clusterName: 'other-cluster', namespace: 'ns' },
          deploymentState: 'AgentRunning',
        })
      );

      clearActivePipeline('cluster', 'ns');

      expect(localStorage.getItem(stateKey)).not.toBeNull();
    });
  });
});
