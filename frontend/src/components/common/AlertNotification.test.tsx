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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useHistory } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../test';
import { PureAlertNotification } from './AlertNotification';

vi.mock('../../lib/cluster', async importOriginal => ({
  ...(await importOriginal()),
  getCluster: () => 'test-cluster',
}));

/** Renders the banner for a cluster route, with `suppress` controllable. */
function renderBanner(checkerFunction: () => Promise<any>, suppress: boolean) {
  return render(
    <MemoryRouter initialEntries={['/c/test-cluster/pods']}>
      <TestContext routerMap={{ cluster: 'test-cluster' }}>
        <PureAlertNotification checkerFunction={checkerFunction} suppress={suppress} />
      </TestContext>
    </MemoryRouter>
  );
}

function NavigateToOtherCluster() {
  const history = useHistory();
  return <button onClick={() => history.push('/c/other-cluster/pods')}>Navigate</button>;
}

describe('PureAlertNotification - suppression', () => {
  it('re-checks when suppression ends rather than trusting a pre-preparation verdict', async () => {
    // A cluster being prepared is unreachable, so the check that ran before
    // preparation says "down". Once preparation finishes the cluster is up, and
    // the banner must reflect that immediately -- not wait for the next poll,
    // which is up to 10s away once the backoff has grown.
    const checker = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderBanner(checker, true);

    expect(checker).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter initialEntries={['/c/test-cluster/pods']}>
        <TestContext routerMap={{ cluster: 'test-cluster' }}>
          <PureAlertNotification checkerFunction={checker} suppress={false} />
        </TestContext>
      </MemoryRouter>
    );

    // Un-suppressing asks the cluster straight away.
    await waitFor(() => expect(checker).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores a check that was still in flight when suppression began', async () => {
    // The stale case: a check is dispatched, then preparation starts and the
    // cluster goes briefly unreachable, so that earlier check rejects. Writing
    // its verdict back would raise the banner suppression exists to hide, and
    // leave it up once preparation ends.
    const pending: Array<(err: Error) => void> = [];
    const checker = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          pending.push(reject);
        })
    );
    const banner = (suppress: boolean) => (
      <MemoryRouter initialEntries={['/c/test-cluster/pods']}>
        <TestContext routerMap={{ cluster: 'test-cluster' }}>
          <PureAlertNotification checkerFunction={checker} suppress={suppress} />
        </TestContext>
      </MemoryRouter>
    );

    const { rerender } = render(banner(true));
    // Preparation ends: this dispatches a check that has not settled yet.
    rerender(banner(false));
    await waitFor(() => expect(checker).toHaveBeenCalledTimes(1));

    // Preparation starts again while that check is still in flight…
    rerender(banner(true));
    // …and only now does it fail.
    await act(async () => {
      pending[0](new Error('Lost connection'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // It must not resurface when preparation ends either.
    rerender(banner(false));
    await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores a check that settles after navigating to another cluster', async () => {
    let rejectCheck!: (error: Error) => void;
    const checker = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCheck = reject;
        })
    );
    const banner = (suppress: boolean) => (
      <MemoryRouter initialEntries={['/c/test-cluster/pods']}>
        <TestContext routerMap={{ cluster: 'test-cluster' }}>
          <NavigateToOtherCluster />
          <PureAlertNotification checkerFunction={checker} suppress={suppress} />
        </TestContext>
      </MemoryRouter>
    );

    const { rerender } = render(banner(true));
    rerender(banner(false));
    await waitFor(() => expect(checker).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
    await act(async () => rejectCheck(new Error('cluster A is unreachable')));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores an interval check that settles after navigating to another cluster', async () => {
    const intervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    const onlineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    try {
      let rejectCheck!: (error: Error) => void;
      const checker = vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectCheck = reject;
          })
      );

      render(
        <MemoryRouter initialEntries={['/c/test-cluster/pods']}>
          <TestContext routerMap={{ cluster: 'test-cluster' }}>
            <NavigateToOtherCluster />
            <PureAlertNotification checkerFunction={checker} suppress={false} />
          </TestContext>
        </MemoryRouter>
      );

      const intervalCallback = intervalSpy.mock.calls.find(([, delay]) => delay === 5000)?.[0];
      expect(intervalCallback).toBeTypeOf('function');
      await act(async () => intervalCallback!());
      expect(checker).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
      await act(async () => rejectCheck(new Error('cluster A is unreachable')));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      onlineSpy.mockRestore();
      intervalSpy.mockRestore();
    }
  });
});
