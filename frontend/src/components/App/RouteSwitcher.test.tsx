/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCluster, useClustersConf } from '../../lib/k8s';
import { testAuth } from '../../lib/k8s/api/v1/clusterApi';
import { addPreOpenHook } from '../../redux/clusterProviderSlice';
import reducers from '../../redux/reducers/reducers';
import { TestContext } from '../../test';

vi.mock('../../lib/k8s', () => ({
  useCluster: vi.fn(() => null),
  useClustersConf: vi.fn(() => ({})),
  useClustersVersion: vi.fn(() => ({})),
  useConnectApi: vi.fn(),
  useSelectedClusters: vi.fn(() => []),
}));

vi.mock('../../lib/k8s/api/v1/clusterApi', () => ({
  testAuth: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../../lib/k8s/event', () => ({ default: class Event {} }));
vi.mock('../common/ObjectEventList', () => ({ default: () => null }));

import RouteSwitcher, { AuthRoute } from './RouteSwitcher';

// Verify RouteSwitcher renders stable route keys and handles an unset cluster.

describe('RouteSwitcher', () => {
  it('assigns unique keys to all rendered AuthRoute components', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <TestContext>
            <RouteSwitcher requiresToken={() => false} />
          </TestContext>
        </QueryClientProvider>
      );

      const duplicateKeyWarnings = consoleError.mock.calls.filter(args => {
        if (typeof args[0] !== 'string') {
          return false;
        }

        return (
          args[0].includes('Each child in a list should have a unique "key" prop') ||
          args[0].includes('Encountered two children with the same key')
        );
      });

      expect(duplicateKeyWarnings).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not throw when rendering with no cluster set', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    expect(() =>
      render(
        <QueryClientProvider client={queryClient}>
          <TestContext>
            <RouteSwitcher requiresToken={() => false} />
          </TestContext>
        </QueryClientProvider>
      )
    ).not.toThrow();
  });
});

describe('AuthRoute pre-open hooks', () => {
  beforeEach(() => {
    vi.mocked(useCluster).mockReturnValue('test-cluster');
    vi.mocked(useClustersConf).mockReturnValue({ 'test-cluster': {} } as any);
    vi.mocked(testAuth)
      .mockClear()
      .mockResolvedValue(true as any);
  });

  afterEach(() => {
    vi.mocked(useCluster).mockReturnValue(null);
  });

  // Renders a single AuthRoute for 'test-cluster' with one registered pre-open
  // hook whose promise the test controls, so we can assert each preparation state.
  function renderAuthRoute(hook: () => Promise<void>) {
    const store = configureStore({ reducer: reducers });
    store.dispatch(addPreOpenHook(hook));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <TestContext store={store}>
          <AuthRoute
            path="/"
            exact
            sidebar={null}
            requiresAuth
            requiresCluster
            requiresToken={() => false}
          >
            <div>cluster-content</div>
          </AuthRoute>
        </TestContext>
      </QueryClientProvider>
    );
  }

  it('shows the connecting dialog while a pre-open hook is pending', async () => {
    const hook = vi.fn(() => new Promise<void>(() => {})); // never settles
    renderAuthRoute(hook);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Preparing cluster/)).toBeInTheDocument();
    // The cluster's views and the auth probe are gated while preparing.
    expect(screen.queryByText('cluster-content')).not.toBeInTheDocument();
    expect(testAuth).not.toHaveBeenCalled();
  });

  it('shows an error with a Retry that refetches when a hook rejects', async () => {
    let reject!: (err: Error) => void;
    const hook = vi.fn(() => new Promise<void>((_resolve, rej) => (reject = rej)));
    renderAuthRoute(hook);

    await screen.findByRole('dialog');
    reject(new Error('proxy failed'));

    // Error UI: the message is shown and a Retry button appears (Retry only
    // renders in the error state).
    const retry = await screen.findByRole('button', { name: /Retry/i });
    expect((await screen.findAllByText(/proxy failed/)).length).toBeGreaterThan(0);

    fireEvent.click(retry);
    await waitFor(() => expect(hook).toHaveBeenCalledTimes(2));
  });

  it('does not probe auth until pre-open hooks succeed', async () => {
    let resolve!: () => void;
    const hook = vi.fn(() => new Promise<void>(res => (resolve = res)));
    renderAuthRoute(hook);

    await screen.findByRole('dialog');
    expect(testAuth).not.toHaveBeenCalled();

    resolve();

    await waitFor(() => expect(testAuth).toHaveBeenCalledWith('test-cluster'));
    expect(await screen.findByText('cluster-content')).toBeInTheDocument();
  });
});
