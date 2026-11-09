// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Insight } from '../../types/upgradeInsights';
import { cluster, passed, provider } from './__fixtures__/fixtures';
import GenerateInsight from './GenerateInsight';

const translation = vi.hoisted(() => ({ labels: {} as Record<string, string> }));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      (translation.labels[text] ?? text).replace(/\{\{(\w+)\}\}/g, (_: string, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  translation.labels = {};
});

async function select(label: string, option: string) {
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: label }).getAttribute('aria-disabled')).not.toBe(
      'true'
    )
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('explicit generation safety', () => {
  it('localizes scope selection and confirmation without changing the POST discriminator', async () => {
    translation.labels = { 'Control plane + all node pools': 'localized-combined' };
    const api = provider();
    render(
      <GenerateInsight
        cluster={cluster}
        provider={api}
        onGenerated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    );
    expect(screen.getByRole('combobox', { name: 'Generate scope' }).textContent).toContain(
      'localized-combined'
    );
    await select('Target Kubernetes version', '1.34.2');
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    expect(screen.getByText('Scope: localized-combined')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm POST and generate' }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.generate).mock.calls[0][1].upgradeType).toBe('ControlPlaneAndAgentPools');
  });

  it('requires review and confirmation of the exact POST; disables duplicate submissions and edits', async () => {
    let resolve!: (value: Insight) => void;
    const api = provider({
      generate: vi.fn().mockReturnValue(
        new Promise<Insight>(done => {
          resolve = done;
        })
      ),
    });
    const onGenerated = vi.fn();
    const onBusyChange = vi.fn();
    render(
      <GenerateInsight
        cluster={cluster}
        provider={api}
        onGenerated={onGenerated}
        onBusyChange={onBusyChange}
      />
    );
    await waitFor(() => expect(api.listUpgradeTargets).toHaveBeenCalled());
    await select('Target Kubernetes version', '1.34.2');
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    expect(api.generate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(
      `${cluster.id}/generateUpgradeInsights?api-version=2026-08-02-preview`
    );
    expect(dialog.textContent).toContain('"targetKubernetesVersion": "1.34.2"');
    expect(dialog.textContent).toContain('does not upgrade the cluster');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm POST and generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm POST and generate' }));
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.generate).toHaveBeenCalledWith(
      cluster,
      { upgradeType: 'ControlPlaneAndAgentPools', targetKubernetesVersion: '1.34.2' },
      expect.any(AbortSignal)
    );
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await act(async () => resolve(passed()));
    expect(onGenerated).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(api.getInsight).not.toHaveBeenCalled();
  });

  it('cancels the review without issuing a POST', async () => {
    const api = provider();
    render(
      <GenerateInsight
        cluster={cluster}
        provider={api}
        onGenerated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    );
    await select('Target Kubernetes version', '1.34.2');
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.generate).not.toHaveBeenCalled();
  });

  it('loads targets for the exact pool scope and does not reuse combined targets', async () => {
    const api = provider({
      listUpgradeTargets: vi
        .fn()
        .mockImplementation((_cluster, scope) =>
          Promise.resolve(scope.upgradeType === 'AgentPool' ? ['1.33.9'] : ['1.34.2'])
        ),
    });
    render(
      <GenerateInsight
        cluster={cluster}
        provider={api}
        onGenerated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    );
    await select('Target Kubernetes version', '1.34.2');
    await select('Generate scope', 'Node pool');
    expect(
      (screen.getByRole('button', { name: 'Review generation request' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await select('Node pool', 'workloads');
    await waitFor(() =>
      expect(api.listUpgradeTargets).toHaveBeenLastCalledWith(
        cluster,
        { upgradeType: 'AgentPool', agentPoolName: 'workloads' },
        expect.any(AbortSignal)
      )
    );
    await select('Target Kubernetes version', '1.33.9');
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    expect(screen.getByRole('dialog').textContent).toContain('"agentPoolName": "workloads"');
    expect(screen.getByRole('dialog').textContent).not.toContain('1.34.2');
  });

  it('keeps NodeImage independent of failed Kubernetes target loading', async () => {
    const api = provider({
      listUpgradeTargets: vi.fn().mockRejectedValue(new Error('Target API denied')),
    });
    render(
      <GenerateInsight
        cluster={cluster}
        provider={api}
        onGenerated={vi.fn()}
        onBusyChange={vi.fn()}
      />
    );
    expect(
      await screen.findByText(/Could not load upgrade targets: Target API denied/)
    ).toBeTruthy();
    await select('Generate scope', 'Node OS image');
    await select('Node pool', 'system');
    expect(api.listUpgradeTargets).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('combobox', { name: 'Target Kubernetes version' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    expect(screen.getByRole('dialog').textContent).toContain(
      'latest available node image, selected by Azure'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm POST and generate' }));
    await waitFor(() =>
      expect(api.generate).toHaveBeenCalledWith(
        cluster,
        { upgradeType: 'NodeImage', agentPoolName: 'system' },
        expect.any(AbortSignal)
      )
    );
  });

  it('surfaces verification errors without claiming generation succeeded', async () => {
    const api = provider({
      generate: vi.fn().mockRejectedValue(new Error('Forbidden GET verification')),
    });
    const done = vi.fn();
    render(
      <GenerateInsight cluster={cluster} provider={api} onGenerated={done} onBusyChange={vi.fn()} />
    );
    await select('Target Kubernetes version', '1.34.2');
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm POST and generate' }));
    expect(
      await screen.findByText(/Evaluation was not verified: Forbidden GET verification/)
    ).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
  });

  it('releases the latest busy callback on cancellation and ignores a late response', async () => {
    let resolve!: (value: Insight) => void;
    const api = provider({
      generate: vi.fn().mockReturnValue(
        new Promise<Insight>(done => {
          resolve = done;
        })
      ),
    });
    const done = vi.fn();
    const firstBusy = vi.fn();
    const latestBusy = vi.fn();
    const view = render(
      <GenerateInsight
        cluster={cluster}
        provider={api}
        onGenerated={done}
        onBusyChange={firstBusy}
      />
    );
    await select('Target Kubernetes version', '1.34.2');
    fireEvent.click(screen.getByRole('button', { name: 'Review generation request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm POST and generate' }));
    const signal = vi.mocked(api.generate).mock.calls[0][2]!;
    expect(firstBusy).toHaveBeenLastCalledWith(true);
    view.rerender(
      <GenerateInsight
        cluster={cluster}
        provider={api}
        onGenerated={done}
        onBusyChange={latestBusy}
      />
    );
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(latestBusy).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => resolve(passed()));
    expect(done).not.toHaveBeenCalled();
    expect(latestBusy).toHaveBeenCalledExactlyOnceWith(false);
    expect(firstBusy).toHaveBeenCalledExactlyOnceWith(true);
  });
});
