// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getLoginStatus: vi.fn(),
  graphGroup: vi.fn(),
}));

vi.mock('./az-auth', () => ({ getLoginStatus: mocks.getLoginStatus }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: vi.fn() }));
vi.mock('./az-resource-graph', () => ({
  getClusterResourceGroupViaGraph: mocks.graphGroup,
  getClustersViaGraph: vi.fn(),
}));

import { getClusterInfo } from './az-clusters';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.fetch.mockRejectedValue(new Error('Unexpected network request'));
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('rejects provider-classified re-login diagnostics', async () => {
  mocks.getLoginStatus.mockResolvedValue({
    isLoggedIn: false,
    needsRelogin: true,
    error: 'synthetic diagnostic',
  });

  await expect(getClusterInfo('sample-cluster')).rejects.toThrow(
    'Your Azure session requires re-authentication. Please run "az login" to sign in again.'
  );
  expect(mocks.graphGroup).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
