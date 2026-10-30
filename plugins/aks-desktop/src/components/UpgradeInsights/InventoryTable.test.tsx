// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cluster, passed, provider } from './__fixtures__/fixtures';
import InventoryTable from './InventoryTable';
import ReadinessWorkspace from './ReadinessWorkspace';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => String(values?.[key] ?? '')),
  }),
}));

afterEach(cleanup);

describe('page-scoped readiness inventory', () => {
  it('preserves region ordering for rendering and CSV, and restores it after readiness sorting', async () => {
    const blocked = passed();
    blocked.properties.controlPlane!.evaluation!.detectedIssues = [
      { issueType: 'PDBConstraint', severity: 'Blocking' },
    ];
    const createURL = vi.fn().mockReturnValue('blob:region-order');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      render(
        <InventoryTable
          records={[
            {
              cluster: { ...cluster, id: `${cluster.id}-zulu`, name: 'zulu', location: 'eastus' },
              insights: [passed()],
            },
            {
              cluster: { ...cluster, id: `${cluster.id}-alpha`, name: 'alpha', location: 'westus' },
              insights: [blocked],
            },
          ]}
          disabled={false}
          onSelect={vi.fn()}
        />
      );
      const displayedNames = () =>
        within(screen.getByRole('table'))
          .getAllByRole('button')
          .map(button => button.textContent);
      expect(displayedNames()).toEqual(['zulu', 'alpha']);
      fireEvent.click(screen.getByRole('button', { name: 'Export filtered page' }));
      const csv = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(createURL.mock.calls[0][0]);
      });
      expect(csv.indexOf('"zulu"')).toBeLessThan(csv.indexOf('"alpha"'));
      fireEvent.click(screen.getByRole('button', { name: 'Sort current page by readiness' }));
      expect(displayedNames()).toEqual(['alpha', 'zulu']);
      fireEvent.click(screen.getByRole('button', { name: 'Use inventory order on current page' }));
      expect(displayedNames()).toEqual(['zulu', 'alpha']);
    } finally {
      click.mockRestore();
    }
  });

  it('renders the selected inventory region ordering instead of overwriting it by name', async () => {
    const api = provider({
      listClusters: vi.fn().mockResolvedValue({
        clusters: [
          { ...cluster, id: `${cluster.id}-alpha`, name: 'alpha', location: 'westus' },
          { ...cluster, id: `${cluster.id}-zulu`, name: 'zulu', location: 'eastus' },
        ],
        warnings: [],
        fleetWarnings: [],
      }),
    });
    render(
      <ReadinessWorkspace provider={api} requireClusterSelection={false} onBusyChange={vi.fn()} />
    );
    await screen.findByRole('table');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Inventory sort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Region' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table'))
          .getAllByRole('button')
          .map(button => button.textContent)
      ).toEqual(['zulu', 'alpha'])
    );
  });

  it('reassesses freshness while idle without making another Azure request', () => {
    vi.useFakeTimers();
    try {
      render(
        <InventoryTable
          records={[{ cluster, insights: [passed()] }]}
          disabled={false}
          onSelect={vi.fn()}
        />
      );
      expect(screen.getByText('Ready on page: 1')).toBeTruthy();
      act(() => vi.advanceTimersByTime(25 * 60 * 60 * 1000));
      expect(screen.getByText('Ready on page: 0')).toBeTruthy();
      expect(screen.getByText('Re-check required on page: 1')).toBeTruthy();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
  it('counts only page records and does not call stale or errored snapshots ready', () => {
    const stale = passed();
    stale.properties.expiresAt = '2000-01-01T00:00:00Z';
    render(
      <InventoryTable
        records={[
          { cluster, insights: [passed()] },
          { cluster: { ...cluster, id: '/stale' }, insights: [stale] },
          { cluster: { ...cluster, id: '/error' }, insights: [], error: 'Forbidden' },
        ]}
        disabled={false}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('Ready on page: 1')).toBeTruthy();
    expect(screen.getByText('Re-check required on page: 1')).toBeTruthy();
    expect(screen.getByText('Unavailable on page: 1')).toBeTruthy();
    expect(screen.getByText('Forbidden')).toBeTruthy();
  });

  it('filters risk categories on this page and exports only visible records', async () => {
    const blocked = passed();
    blocked.properties.controlPlane!.evaluation!.detectedIssues = [
      { issueType: 'PDBConstraint', severity: 'Blocking' },
    ];
    const createURL = vi.fn().mockReturnValue('blob:test');
    const revokeURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <InventoryTable
        records={[
          { cluster, insights: [blocked] },
          { cluster: { ...cluster, id: '/ready', name: 'ready-cluster' }, insights: [passed()] },
        ]}
        disabled={false}
        onSelect={vi.fn()}
      />
    );
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Risk on current page' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Disruption budgets' }));
    expect(screen.queryByRole('button', { name: 'ready-cluster' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export filtered page' }));
    expect(createURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeURL).toHaveBeenCalledWith('blob:test');
    click.mockRestore();
  });

  it('queries readiness only for the current inventory page and supports search', async () => {
    const clusters = Array.from({ length: 11 }, (_, i) => ({
      ...cluster,
      id: `${cluster.id}-${i}`,
      name: `cluster-${String(i).padStart(2, '0')}`,
    }));
    const api = provider({
      listClusters: vi.fn().mockResolvedValue({ clusters, warnings: [], fleetWarnings: [] }),
    });
    render(
      <ReadinessWorkspace provider={api} requireClusterSelection={false} onBusyChange={vi.fn()} />
    );
    await screen.findByRole('table');
    expect(api.listInsights).toHaveBeenCalledTimes(10);
    expect(screen.getByText('Ready on page: 10')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    await waitFor(() => expect(api.listInsights).toHaveBeenCalledTimes(11));
    expect(await screen.findByText('Ready on page: 1')).toBeTruthy();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search clusters, subscriptions, regions or fleets' }),
      {
        target: { value: 'cluster-03' },
      }
    );
    expect(await screen.findByRole('button', { name: 'cluster-03' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'cluster-10' })).toBeNull();
  });
});
