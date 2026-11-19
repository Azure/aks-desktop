// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCluster, deleteCluster, listKubernetesVersions } from '../cli/commands';
import { overviewPanel } from '../common/panel';
import { LocalTarget } from '../contract/capability';
import { readLocalTarget } from '../native/localContext';
import { inspectWsl } from '../native/platformChecks';
import { checkReadinessAgain, createLocalCluster } from './create';
import { deleteLocalCluster, deleteLocalContext } from './delete';
import { hostError, nativeError } from './failure';
import { checkPlatform } from './platform';
import { beginSetup, finishedOverviewRefreshes, refreshOverview, refreshSetup } from './setup';
import { getWorkflowState, update } from './store';

vi.mock('../cli/commands', () => ({
  createCluster: vi.fn(),
  deleteCluster: vi.fn(),
  listKubernetesVersions: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
}));

vi.mock('../native/localContext', () => ({
  readLocalTarget: vi.fn(),
}));

vi.mock('../native/platformChecks', () => ({
  inspectWsl: vi.fn(),
}));

vi.mock('./platform', () => ({
  checkPlatform: vi.fn(),
}));

const VERSION = 'v1.36.5';

const TARGET: LocalTarget = {
  name: 'dev-cluster',
  contextName: 'dev-cluster',
  listName: 'dev-cluster',
  kubernetesVersion: VERSION,
  image: 'Ubuntu-24.04',
};

/** Holds the next target read until the returned function releases it with `target`. */
function holdTargetRead(target: LocalTarget | null): () => void {
  let release: (() => void) | undefined;
  vi.mocked(readLocalTarget).mockImplementationOnce(
    () =>
      new Promise<LocalTarget | null>(resolve => {
        release = () => resolve(target);
      })
  );
  return () => release?.();
}

/** Only Setup's environment step runs the platform check and the WSL queries (B3). */
function expectNoEnvironmentChecks(): void {
  expect(checkPlatform).not.toHaveBeenCalled();
  expect(inspectWsl).not.toHaveBeenCalled();
}

const READY = Object.freeze({ wsl: 'ready' } as const);
const VERSIONS = Object.freeze([{ version: VERSION, deprecated: false }]);

describe('Setup attempt', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    update({ busy: false, refreshFailure: null, environment: null, versions: null, target: null });
    vi.mocked(readLocalTarget).mockResolvedValue(null);
    vi.mocked(inspectWsl).mockResolvedValue(READY);
    vi.mocked(listKubernetesVersions).mockResolvedValue(VERSIONS);
  });

  it('records the result and the catalog together after every check succeeded', async () => {
    await expect(refreshSetup()).resolves.toBe(true);

    expect(checkPlatform).toHaveBeenCalledOnce();
    expect(getWorkflowState().environment).toEqual({ target: null, ...READY });
    expect(getWorkflowState().versions).toEqual(VERSIONS);
  });

  it('records no result when the catalog read fails', async () => {
    vi.mocked(listKubernetesVersions).mockRejectedValueOnce(nativeError('failed'));

    await expect(refreshSetup()).resolves.toBe(false);

    expect(getWorkflowState().environment).toBeNull();
    expect(getWorkflowState().versions).toBeNull();
    expect(getWorkflowState().refreshFailure).toEqual({ source: 'native', code: 'failed' });
  });

  it('discards the previous result when Check again fails', async () => {
    await refreshSetup();
    vi.mocked(checkPlatform).mockRejectedValueOnce(hostError('unsupported'));

    await expect(refreshSetup()).resolves.toBe(false);
    await refreshOverview();

    expect(getWorkflowState().environment).toBeNull();
    expect(getWorkflowState().refreshFailure).toBeNull();
  });

  it('starts each attempt without the previous result or catalog', async () => {
    await refreshSetup();

    beginSetup();

    expect(getWorkflowState().environment).toBeNull();
    expect(getWorkflowState().versions).toBeNull();
  });

  it('ends the result when Create or Delete starts', async () => {
    await refreshSetup();
    vi.mocked(readLocalTarget).mockResolvedValueOnce(null).mockResolvedValueOnce(TARGET);
    await createLocalCluster({ name: TARGET.name, kubernetesVersion: VERSION });
    expect(getWorkflowState().environment).toBeNull();

    await refreshSetup();
    vi.mocked(readLocalTarget).mockResolvedValueOnce(TARGET);
    vi.mocked(deleteCluster).mockResolvedValueOnce(undefined);
    await deleteLocalContext(TARGET.contextName, TARGET.name);
    expect(deleteCluster).toHaveBeenCalledWith(TARGET.name);
    expect(getWorkflowState().environment).toBeNull();
  });
});

describe('refreshOverview', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    update({
      busy: false,
      overviewInitialized: false,
      refreshFailure: null,
    });
    vi.mocked(readLocalTarget).mockResolvedValue(null);
  });

  it('reads only the target', async () => {
    vi.mocked(readLocalTarget).mockResolvedValueOnce(TARGET);

    await expect(refreshOverview()).resolves.toBe(true);

    expect(getWorkflowState().target).toEqual(TARGET);
    expectNoEnvironmentChecks();
  });

  it('does not initialize a remount when its refresh is refused by an in-flight operation', async () => {
    const release = holdTargetRead(null);
    const finished = finishedOverviewRefreshes();

    const firstRefresh = refreshOverview();
    await vi.waitFor(() => {
      expect(getWorkflowState().busy).toBe(true);
    });

    await expect(refreshOverview()).resolves.toBe(false);
    expect(getWorkflowState().overviewInitialized).toBe(false);
    expect(finishedOverviewRefreshes()).toBe(finished);

    release();
    await expect(firstRefresh).resolves.toBe(true);
    expect(getWorkflowState().overviewInitialized).toBe(true);
    expect(finishedOverviewRefreshes()).toBe(finished + 1);
  });

  it('initializes the overview after an executed refresh fails', async () => {
    vi.mocked(readLocalTarget).mockRejectedValueOnce(nativeError('failed'));
    const finished = finishedOverviewRefreshes();

    await expect(refreshOverview()).resolves.toBe(false);

    expect(finishedOverviewRefreshes()).toBe(finished + 1);

    expect(getWorkflowState().overviewInitialized).toBe(true);
    expect(getWorkflowState().refreshFailure).toEqual({ source: 'native', code: 'failed' });
  });

  it('initializes Overview when its mount refresh is refused by a Home-menu delete', async () => {
    vi.mocked(deleteCluster).mockResolvedValue(undefined);
    const release = holdTargetRead(TARGET);

    const deletion = deleteLocalContext(TARGET.contextName, TARGET.name);
    await vi.waitFor(() => {
      expect(getWorkflowState().deletePhase).toBe('running');
      expect(getWorkflowState().busy).toBe(true);
    });

    await expect(refreshOverview()).resolves.toBe(false);
    expect(getWorkflowState().overviewInitialized).toBe(false);

    release();
    await expect(deletion).resolves.toBe(true);
    expect(getWorkflowState().overviewInitialized).toBe(true);
    expect(overviewPanel(getWorkflowState())).toBe('none');
    expectNoEnvironmentChecks();
  });
});

describe('Delete and the AKS Desktop cluster list', () => {
  // A context the user renamed in AKS Desktop: the backend keys it by the display name.
  const LISTED: LocalTarget = {
    ...TARGET,
    contextName: 'dev-cluster-context',
    listName: 'my dev cluster',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    update({ busy: false, deletePhase: 'idle', deleteFailure: null, target: null });
    vi.mocked(readLocalTarget).mockResolvedValue(LISTED);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the backend to drop the listed cluster only after the CLI deleted it', async () => {
    vi.mocked(deleteCluster).mockResolvedValueOnce(undefined);

    await expect(deleteLocalContext(LISTED.contextName, LISTED.name)).resolves.toBe(true);

    expect(deleteCluster).toHaveBeenCalledWith(LISTED.name);
    // The backend route itself, by list name, bounded, with no current cluster and no
    // removeKubeConfig: no browser-stored kubeconfig lookup and no file change.
    expect(ApiProxy.request).toHaveBeenCalledExactlyOnceWith(
      '/cluster/my%20dev%20cluster',
      { method: 'DELETE', timeout: 10_000 },
      false,
      false
    );
    expect(vi.mocked(deleteCluster).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ApiProxy.request).mock.invocationCallOrder[0]
    );
    expect(getWorkflowState().deletePhase).toBe('deleted');
  });

  it('still reports the cluster deleted when the list update fails', async () => {
    vi.mocked(deleteCluster).mockResolvedValueOnce(undefined);
    vi.mocked(ApiProxy.request).mockRejectedValueOnce(new Error('408 Request timed-out'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(deleteLocalContext(LISTED.contextName, LISTED.name)).resolves.toBe(true);

    expect(warn).toHaveBeenCalledOnce();
    expect(getWorkflowState()).toMatchObject({ deletePhase: 'deleted', deleteFailure: null });
  });

  it('leaves the list alone when the CLI delete fails', async () => {
    vi.mocked(deleteCluster).mockRejectedValueOnce(nativeError('failed'));

    await expect(deleteLocalContext(LISTED.contextName, LISTED.name)).resolves.toBe(false);

    expect(ApiProxy.request).not.toHaveBeenCalled();
    expect(getWorkflowState().deletePhase).toBe('failed');
  });
});

describe('Delete identity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    update({ busy: false, deletePhase: 'idle', deleteFailure: null, target: TARGET });
    vi.mocked(readLocalTarget).mockResolvedValue(TARGET);
  });

  it('refuses an Overview Delete when the loaded target changed since the page rendered', async () => {
    const shown: LocalTarget = { ...TARGET, kubernetesVersion: 'v1.35.9' };

    await expect(deleteLocalCluster(shown)).resolves.toBe(false);

    expect(readLocalTarget).not.toHaveBeenCalled();
    expect(deleteCluster).not.toHaveBeenCalled();
  });

  it('refuses a cluster-menu Delete when the context now names another cluster', async () => {
    vi.mocked(readLocalTarget).mockResolvedValueOnce({ ...TARGET, name: 'other-cluster' });

    await expect(deleteLocalContext(TARGET.contextName, TARGET.name)).resolves.toBe(false);

    expect(deleteCluster).not.toHaveBeenCalled();
    expect(getWorkflowState()).toMatchObject({
      deletePhase: 'failed',
      deleteFailure: { source: 'host', code: 'identity-mismatch' },
    });
  });
});

describe('createLocalCluster', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    update({
      busy: false,
      target: null,
      versions: [
        { version: 'v1.36.5', deprecated: false },
        { version: 'v1.35.9', deprecated: true },
      ],
    });
  });

  // This gate is the only check of the values `cluster create` receives.
  it.each([
    ['an invalid name', '-dev', 'v1.36.5'],
    ['a deprecated version', 'dev-cluster', 'v1.35.9'],
    ['a version outside the catalog', 'dev-cluster', 'v1.36.5 --purge'],
  ])('refuses %s before any command runs', async (_case, name, kubernetesVersion) => {
    await expect(createLocalCluster({ name, kubernetesVersion })).resolves.toBe(false);
    expect(readLocalTarget).not.toHaveBeenCalled();
    expect(createCluster).not.toHaveBeenCalled();
  });

  it('creates without repeating the environment checks', async () => {
    vi.mocked(readLocalTarget).mockResolvedValueOnce(null).mockResolvedValueOnce(TARGET);

    await expect(
      createLocalCluster({ name: TARGET.name, kubernetesVersion: VERSION })
    ).resolves.toBe(true);

    expect(createCluster).toHaveBeenCalledOnce();
    expect(getWorkflowState().createPhase).toBe('usable');
    expectNoEnvironmentChecks();
  });
});

describe('readiness after Create', () => {
  const CREATE = { name: TARGET.name, kubernetesVersion: VERSION };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    update({
      busy: false,
      target: null,
      createPhase: 'idle',
      createFailure: null,
      versions: [{ version: VERSION, deprecated: false }],
    });
    vi.mocked(readLocalTarget).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ends not confirmed when the context is not loaded within 30 seconds', async () => {
    const create = createLocalCluster(CREATE);

    await vi.advanceTimersByTimeAsync(28_000);
    expect(getWorkflowState().createPhase).toBe('running');

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(create).resolves.toBe(true);
    expect(getWorkflowState().createPhase).toBe('not-confirmed');
  });

  it('reports usable when the context loads at the last read, at 30 seconds', async () => {
    const start = Date.now();
    vi.mocked(readLocalTarget).mockImplementation(async () =>
      Date.now() - start >= 30_000 ? TARGET : null
    );
    const create = createLocalCluster(CREATE);

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(create).resolves.toBe(true);
    expect(getWorkflowState().createPhase).toBe('usable');
  });

  it('ends not confirmed with the failure when a read fails, without retrying', async () => {
    vi.mocked(readLocalTarget)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(nativeError('failed'));

    await expect(createLocalCluster(CREATE)).resolves.toBe(true);

    expect(readLocalTarget).toHaveBeenCalledTimes(2);
    expect(getWorkflowState()).toMatchObject({
      createPhase: 'not-confirmed',
      createFailure: { source: 'native', code: 'failed' },
    });
  });

  it('fails with invalid-metadata for another loaded cluster, which becomes the target', async () => {
    const other: LocalTarget = { ...TARGET, name: 'other-cluster', contextName: 'other-cluster' };
    vi.mocked(readLocalTarget).mockResolvedValueOnce(null).mockResolvedValueOnce(other);

    await expect(createLocalCluster(CREATE)).resolves.toBe(false);

    expect(getWorkflowState()).toMatchObject({
      createPhase: 'failed',
      createFailure: { source: 'native', code: 'invalid-metadata' },
      target: other,
    });
  });

  /** Runs a Create whose context is not loaded within 30 seconds. */
  async function createNotConfirmed(): Promise<void> {
    const create = createLocalCluster(CREATE);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(create).resolves.toBe(true);
    expect(getWorkflowState().createPhase).toBe('not-confirmed');
    vi.mocked(readLocalTarget).mockClear();
  }

  it('Check again reads once and reports usable when the context is loaded', async () => {
    await createNotConfirmed();
    vi.mocked(readLocalTarget).mockResolvedValueOnce(TARGET);

    await expect(checkReadinessAgain()).resolves.toBe(true);

    expect(readLocalTarget).toHaveBeenCalledOnce();
    expect(getWorkflowState()).toMatchObject({ createPhase: 'usable', target: TARGET });
  });

  it('Check again fails with invalid-metadata for another loaded cluster', async () => {
    await createNotConfirmed();
    const other: LocalTarget = { ...TARGET, name: 'other-cluster', contextName: 'other-cluster' };
    vi.mocked(readLocalTarget).mockResolvedValueOnce(other);

    await expect(checkReadinessAgain()).resolves.toBe(false);

    expect(getWorkflowState()).toMatchObject({
      createPhase: 'failed',
      createFailure: { source: 'native', code: 'invalid-metadata' },
      target: other,
    });
  });

  it('Check again stays not confirmed when its read fails', async () => {
    await createNotConfirmed();
    vi.mocked(readLocalTarget).mockRejectedValueOnce(nativeError('failed'));

    await expect(checkReadinessAgain()).resolves.toBe(false);

    expect(getWorkflowState()).toMatchObject({
      createPhase: 'not-confirmed',
      createFailure: { source: 'native', code: 'failed' },
    });
  });
});
