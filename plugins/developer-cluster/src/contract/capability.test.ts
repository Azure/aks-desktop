// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { decodeLocalContext, isLocalContext, LocalContextError } from './capability';
import { LOCAL_CONTEXT_MANAGED_BY } from './devctl';

const INFO = {
  managedBy: LOCAL_CONTEXT_MANAGED_BY,
  name: 'dev-cluster',
  kubernetesVersion: 'v1.36.5',
  image: 'Ubuntu-24.04',
};

function cluster(info: unknown) {
  return {
    name: 'display-name',
    meta_data: { originalName: 'dev-cluster', extensions: { context_info: info } },
  };
}

describe('Developer Cluster context identity', () => {
  it('recognizes a context the CLI manages, whatever its provider or WSL instance', () => {
    expect(isLocalContext(cluster(INFO))).toBe(true);
    expect(
      decodeLocalContext(cluster({ ...INFO, provider: 'another-provider', distro: 'Ubuntu-24.04' }))
    ).toStrictEqual({
      name: 'dev-cluster',
      distribution: null,
      kubernetesVersion: 'v1.36.5',
      image: 'Ubuntu-24.04',
      contextName: 'dev-cluster',
      listName: 'display-name',
    });
  });

  it.each(['K8s', 'K3s'])(
    'reads the recorded %s distribution independently of the OS',
    distribution => {
      expect(decodeLocalContext(cluster({ ...INFO, distribution }))?.distribution).toBe(
        distribution
      );
    }
  );

  it('does not mislabel an unrecognized distribution as K8s', () => {
    expect(
      decodeLocalContext(cluster({ ...INFO, distribution: 'Other' }))?.distribution
    ).toBeNull();
  });

  it('reads a missing or empty image as unknown', () => {
    expect(decodeLocalContext(cluster({ ...INFO, image: undefined }))?.image).toBeNull();
    expect(decodeLocalContext(cluster({ ...INFO, image: '' }))?.image).toBeNull();
  });

  it('does not claim a context without the managedBy mark, such as one from an earlier CLI', () => {
    const earlier = {
      provider: 'baremetal.aksarc.microsoft.com',
      name: 'dev-cluster',
      distro: 'dev-cluster',
    };
    expect(isLocalContext(cluster(earlier))).toBe(false);
    expect(decodeLocalContext(cluster(earlier))).toBeNull();
    expect(isLocalContext(cluster({ ...INFO, managedBy: 'another-tool' }))).toBe(false);
  });

  it('does not claim a context whose context_info is not an object', () => {
    expect(isLocalContext(cluster(LOCAL_CONTEXT_MANAGED_BY))).toBe(false);
    expect(isLocalContext(cluster(undefined))).toBe(false);
  });

  it('rejects invalid cluster metadata after matching the managedBy mark', () => {
    expect(() => decodeLocalContext(cluster({ ...INFO, name: 'invalid name' }))).toThrow(
      LocalContextError
    );
    expect(() => decodeLocalContext(cluster({ ...INFO, name: undefined }))).toThrow(
      LocalContextError
    );
    expect(() => decodeLocalContext(cluster({ ...INFO, image: 24.04 }))).toThrow(LocalContextError);
  });
});
