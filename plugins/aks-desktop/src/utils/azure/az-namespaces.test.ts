// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { updateManagedNamespace } from './az-namespaces';

const run = vi.hoisted(() => vi.fn());
vi.mock('./az-cli-core', () => ({
  debugLog: vi.fn(),
  getErrorMessage: (error: Error) => error.message,
  isAzError: (stderr: string) => stderr.startsWith('ERROR'),
  needsRelogin: (stderr: string) => stderr.includes('az login'),
  runCommandAsync: run,
}));

describe('managed namespace updates', () => {
  const target = {
    subscriptionId: 'subscription',
    resourceGroup: 'group',
    clusterName: 'cluster',
    namespaceName: 'namespace',
  };
  beforeEach(() => run.mockReset());

  test.each(['properties', 'root'])(
    'preserves %s labels and uses one show plus one update',
    async location => {
      const labels = {
        'headlamp.dev/project-managed-by': 'aks-desktop',
        'aks-desktop/project-subscription': 'subscription',
        unrelated: 'keep-me',
      };
      run
        .mockResolvedValueOnce({
          stdout: JSON.stringify(
            location === 'properties' ? { properties: { labels } } : { labels }
          ),
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '{}', stderr: '' });
      await updateManagedNamespace({ ...target, cpuRequest: 500 });
      expect(run).toHaveBeenCalledTimes(2);
      const show = run.mock.calls[0][1];
      const update = run.mock.calls[1][1];
      expect(show.slice(0, 3)).toEqual(['aks', 'namespace', 'show']);
      expect(update.slice(0, 3)).toEqual(['aks', 'namespace', 'update']);
      for (const args of [show, update]) {
        expect(args).toEqual(
          expect.arrayContaining([
            '--name',
            'namespace',
            '--subscription',
            'subscription',
            '--resource-group',
            'group',
            '--cluster-name',
            'cluster',
          ])
        );
      }
      expect(update).toEqual(
        expect.arrayContaining([
          '--labels',
          'headlamp.dev/project-managed-by=aks-desktop',
          'aks-desktop/project-subscription=subscription',
          'unrelated=keep-me',
          '--cpu-request',
          '500m',
        ])
      );
    }
  );

  test('aborts without issuing update if the label-preserving read fails', async () => {
    run.mockRejectedValueOnce(new Error('read denied'));
    await expect(updateManagedNamespace(target)).rejects.toThrow('aborting to avoid wiping labels');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1].slice(0, 3)).toEqual(['aks', 'namespace', 'show']);
  });
});
