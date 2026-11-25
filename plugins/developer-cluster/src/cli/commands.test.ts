// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCluster, deleteCluster, listKubernetesVersions } from './commands';
import { CliCommandError, runCli } from './runner';

vi.mock('./runner', async importOriginal => ({
  ...(await importOriginal<typeof import('./runner')>()),
  runCli: vi.fn(),
}));

const NAME = 'dev-cluster';

function respond(data: Record<string, unknown>): void {
  vi.mocked(runCli).mockResolvedValueOnce({ level: 'info', data });
}

function sentArgv(): readonly string[] {
  return vi.mocked(runCli).mock.calls[0][0];
}

describe('aks-devctl argv', () => {
  beforeEach(() => {
    vi.mocked(runCli).mockReset();
  });

  // These shapes must match AKS Desktop's grants exactly.
  it('lists versions with JSON Lines output', async () => {
    respond({ versions: [{ version: 'v1.36.5', deprecated: false }] });
    await listKubernetesVersions();
    expect(sentArgv()).toStrictEqual(['cluster', 'get-versions', '--output', 'json']);
  });

  it.each([
    ['K8s', false, []],
    ['K8s', true, ['--enable-gpu']],
    ['K3s', false, []],
  ] as const)('creates a %s cluster (gpu %s)', async (distribution, gpu, extra) => {
    respond({ context: NAME, path: '/home/user/.kube/config' });
    await createCluster({ name: NAME, distribution, kubernetesVersion: 'v1.36.5', gpu });
    expect(sentArgv()).toStrictEqual([
      'cluster',
      'create',
      '--output',
      'json',
      '--kubernetes-distribution',
      distribution,
      '--name',
      NAME,
      '--kubernetes-version',
      'v1.36.5',
      ...extra,
    ]);
  });

  it.each([
    [
      'Create',
      () =>
        createCluster({
          name: NAME,
          distribution: 'K8s',
          kubernetesVersion: 'v1.36.5',
          gpu: false,
        }),
    ],
    ['Delete', () => deleteCluster(NAME)],
  ])('rejects a warn result from %s', async (_command, run) => {
    vi.mocked(runCli).mockResolvedValueOnce({ level: 'warn', data: { context: NAME, path: '/k' } });
    await expect(run()).rejects.toThrow(new CliCommandError('unexpected-result'));
  });

  it('deletes without the CLI prompt', async () => {
    respond({ context: NAME, path: '/home/user/.kube/config', removed: true });
    await deleteCluster(NAME);
    expect(sentArgv()).toStrictEqual([
      'cluster',
      'delete',
      '--output',
      'json',
      '--name',
      NAME,
      '--yes',
    ]);
  });
});
