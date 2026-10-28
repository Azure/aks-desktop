// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArmProvider } from '../../utils/azure/upgrade-insights';
import { cluster, passed, provider } from './__fixtures__/fixtures';
import ClusterDetails from './ClusterDetails';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => String(values?.[key] ?? '')),
  }),
}));
afterEach(cleanup);

describe('stored insights detail', () => {
  it('reuses the refreshed cache when details are remounted or inventory objects change', async () => {
    const transport = vi.fn(async (path: string) =>
      path.includes('/upgradeProfiles/')
        ? { properties: { controlPlaneProfile: { upgrades: [] } } }
        : { value: [passed()] }
    );
    const insightReads = () =>
      transport.mock.calls.filter(([path]) => path.includes('/upgradeInsights?')).length;
    const api = new ArmProvider(transport, [cluster.subscription]);
    const props = { cluster, provider: api, onBusyChange: vi.fn(), onGenerated: vi.fn() };
    const view = render(<ClusterDetails {...props} refresh={0} />);
    await screen.findByText('Stored readiness: Ready');
    expect(insightReads()).toBe(1);

    api.invalidateInsights();
    view.rerender(<ClusterDetails {...props} refresh={1} />);
    await waitFor(() => expect(insightReads()).toBe(2));
    await screen.findByText('Stored readiness: Ready');
    view.rerender(<ClusterDetails {...props} cluster={{ ...cluster }} refresh={1} />);
    await screen.findByText('Stored readiness: Ready');
    expect(insightReads()).toBe(2);

    view.unmount();
    render(<ClusterDetails {...props} refresh={1} />);
    await screen.findByText('Stored readiness: Ready');
    expect(insightReads()).toBe(2);
  });

  it('shows remaining scopes after refresh removes the selected pool scope', async () => {
    const updated = passed();
    updated.properties.agentPools = updated.properties.agentPools!.filter(
      pool => pool.agentPoolName !== 'workloads'
    );
    const api = provider({
      listInsights: vi.fn().mockResolvedValueOnce([passed()]).mockResolvedValue([updated]),
    });
    const props = { cluster, provider: api, onBusyChange: vi.fn(), onGenerated: vi.fn() };
    const view = render(<ClusterDetails {...props} refresh={0} />);
    await screen.findByRole('combobox', { name: 'Evaluation scope' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Evaluation scope' }));
    fireEvent.click(await screen.findByRole('option', { name: 'workloads' }));
    expect(screen.queryByRole('heading', { name: 'Control plane' })).toBeNull();
    view.rerender(<ClusterDetails {...props} refresh={1} />);
    expect(await screen.findByRole('heading', { name: 'Control plane' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Evaluation scope' }).textContent).toBe(
      'All evaluated scopes'
    );
  });

  it('shows scoped resources and safe informational remediation with raw API response', async () => {
    const insight = passed();
    insight.properties.agentPools![0].evaluation!.detectedIssues = [
      {
        issueType: 'PDBConstraint',
        severity: 'Blocking',
        message: 'A workload cannot drain',
        impactedResources: [{ kind: 'PodDisruptionBudget', namespace: 'apps', name: 'budget' }],
        recommendedActions: [
          {
            title: 'Review PDB',
            details: 'Inspect the workload policy',
            documentationLink: 'https://learn.microsoft.com/azure/aks',
          },
          { title: 'Untrusted URL', documentationLink: 'javascript:alert(1)' },
        ],
      },
    ];
    const api = provider({ listInsights: vi.fn().mockResolvedValue([insight]) });
    render(
      <ClusterDetails
        cluster={cluster}
        provider={api}
        refresh={0}
        onBusyChange={vi.fn()}
        onGenerated={vi.fn()}
      />
    );
    expect(await screen.findByText('Stored readiness: Blocked')).toBeTruthy();
    expect(screen.getByText('PodDisruptionBudget / apps / budget')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open remediation documentation' });
    expect(link.getAttribute('href')).toBe('https://learn.microsoft.com/azure/aks');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText(/Documentation link is not on the allowed/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Evaluation scope' }));
    fireEvent.click(await screen.findByRole('option', { name: 'workloads' }));
    expect(screen.queryByText('A workload cannot drain')).toBeNull();
    fireEvent.click(screen.getByText('Raw API response'));
    expect(screen.getByText(/"targetKubernetesVersion": "1.34.2"/)).toBeTruthy();
  });

  it('allows selecting stored NodeImage evaluations independently of the combined result', async () => {
    const image = passed();
    image.id = `${cluster.id}/upgradeInsights/nodeImage-system`;
    image.name = 'nodeImage-system';
    image.properties = {
      ...image.properties,
      upgradeType: 'NodeImage',
      agentPoolName: 'system',
      targetNodeImageVersion: 'image-new',
      currentNodeImageVersion: 'image-old',
      evaluation: { status: 'Passed', evaluatedAt: image.properties.lastEvaluatedAt! },
    };
    const api = provider({ listInsights: vi.fn().mockResolvedValue([passed(), image]) });
    render(
      <ClusterDetails
        cluster={cluster}
        provider={api}
        refresh={0}
        onBusyChange={vi.fn()}
        onGenerated={vi.fn()}
      />
    );
    await screen.findByRole('combobox', { name: 'Stored evaluation' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Stored evaluation' }));
    fireEvent.click(await screen.findByRole('option', { name: /nodeImage-system/ }));
    expect(screen.getByRole('combobox', { name: 'Stored evaluation' }).textContent).toContain(
      'nodeImage-system'
    );
    expect(screen.getByText('Stored readiness: Ready')).toBeTruthy();
  });

  it('surfaces detail read failure rather than substituting a successful empty result', async () => {
    const api = provider({ listInsights: vi.fn().mockRejectedValue(new Error('Read forbidden')) });
    render(
      <ClusterDetails
        cluster={cluster}
        provider={api}
        refresh={0}
        onBusyChange={vi.fn()}
        onGenerated={vi.fn()}
      />
    );
    expect(await screen.findByText('Could not load stored insights: Read forbidden')).toBeTruthy();
    expect(screen.queryByText(/Stored readiness: Ready/)).toBeNull();
    expect(screen.queryByText(/No stored insights/)).toBeNull();
  });
});
