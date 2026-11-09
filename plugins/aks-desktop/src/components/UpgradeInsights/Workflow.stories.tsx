// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Meta, StoryObj } from '@storybook/react';
import React, { useMemo, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { InsightsProvider } from '../../types/upgradeInsights';
import { StoryFrame, storyProvider, storyRecords } from './__fixtures__/storyFixtures';
import ClusterDetails from './ClusterDetails';
import ReadinessWorkspace from './ReadinessWorkspace';

export default {
  title: 'UpgradeInsights/Workflow',
  decorators: [
    Story => (
      <StoryFrame>
        <Story />
      </StoryFrame>
    ),
  ],
} satisfies Meta;

type Story = StoryObj;
type Scenario =
  | 'inventoryLoading'
  | 'readinessLoading'
  | 'inventoryError'
  | 'partialInventory'
  | 'pagination'
  | 'contextDisambiguation'
  | 'details'
  | 'targetsLoading'
  | 'targetsError'
  | 'submitting'
  | 'verificationFailure'
  | 'success';

function Workflow({ scenario }: { scenario: Scenario }) {
  const [refresh, setRefresh] = useState(0);
  const { records, provider } = useMemo(() => {
    const records = storyRecords();
    const overrides: Partial<InsightsProvider> = {};
    if (scenario === 'inventoryLoading') overrides.listClusters = () => new Promise(() => {});
    if (scenario === 'readinessLoading') overrides.listInsights = () => new Promise(() => {});
    if (scenario === 'inventoryError') {
      overrides.listClusters = async () => {
        throw new Error('Inventory forbidden (Storybook fixture)');
      };
    }
    if (scenario === 'partialInventory') {
      overrides.listClusters = async () => ({
        clusters: records.map(record => record.cluster),
        warnings: ['Subscription B: Forbidden (Storybook fixture)'],
        fleetWarnings: ['Fleet members denied (Storybook fixture)'],
      });
    }
    if (scenario === 'pagination') {
      const template = records[1];
      records.splice(
        0,
        records.length,
        ...Array.from({ length: 12 }, (_, index) => ({
          cluster: {
            ...template.cluster,
            id: `${template.cluster.id}-${index}`,
            name: `cluster-${String(index).padStart(2, '0')}`,
          },
          insights: template.insights,
        }))
      );
    }
    if (scenario === 'contextDisambiguation') {
      records[1].cluster = {
        ...records[1].cluster,
        name: records[0].cluster.name,
        resourceGroup: 'another-resource-group',
        id: records[0].cluster.id.replace('/visual-review/', '/another-resource-group/'),
      };
    }
    if (scenario === 'targetsLoading') overrides.listUpgradeTargets = () => new Promise(() => {});
    if (scenario === 'targetsError') {
      overrides.listUpgradeTargets = async () => {
        throw new Error('Upgrade targets forbidden (Storybook fixture)');
      };
    }
    if (scenario === 'submitting') overrides.generate = () => new Promise(() => {});
    if (scenario === 'verificationFailure') {
      overrides.generate = async () => {
        throw new Error('Stored-resource verification denied (Storybook fixture)');
      };
    }
    return { records, provider: storyProvider(records, overrides) };
  }, [scenario]);
  const inventoryScenario = [
    'inventoryLoading',
    'readinessLoading',
    'inventoryError',
    'partialInventory',
    'pagination',
    'contextDisambiguation',
  ].includes(scenario);
  return inventoryScenario ? (
    <ReadinessWorkspace
      provider={provider}
      requireClusterSelection={scenario === 'contextDisambiguation'}
      onBusyChange={() => {}}
    />
  ) : (
    <ClusterDetails
      cluster={records[0].cluster}
      provider={provider}
      refresh={refresh}
      onBusyChange={() => {}}
      onGenerated={() => setRefresh(value => value + 1)}
    />
  );
}

export const InventoryLoading: Story = {
  render: () => <Workflow scenario="inventoryLoading" />,
};

export const ReadinessLoading: Story = {
  render: () => <Workflow scenario="readinessLoading" />,
};

export const InventoryError: Story = {
  render: () => <Workflow scenario="inventoryError" />,
};

export const PartialInventory: Story = {
  render: () => <Workflow scenario="partialInventory" />,
};

export const Pagination: Story = {
  render: () => <Workflow scenario="pagination" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('Ready on page: 10');
    await userEvent.click(canvas.getByRole('button', { name: 'Go to page 2' }));
    await canvas.findByText('Ready on page: 2');
  },
};

export const ContextDisambiguation: Story = {
  render: () => <Workflow scenario="contextDisambiguation" />,
};

export const StoredEvaluationDetails: Story = {
  render: () => <Workflow scenario="details" />,
};

export const RawResponse: Story = {
  render: () => <Workflow scenario="details" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('Stored readiness: Blocked');
    await userEvent.click(canvas.getByText('Raw API response'));
    await expect(canvas.getByText(/"targetKubernetesVersion": "1.34.2"/)).toBeVisible();
  },
};

export const TargetsLoading: Story = {
  render: () => <Workflow scenario="targetsLoading" />,
};

export const TargetsError: Story = {
  render: () => <Workflow scenario="targetsError" />,
};

async function reviewRequest(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const target = await canvas.findByRole('combobox', { name: 'Target Kubernetes version' });
  await waitFor(() => expect(target).not.toHaveAttribute('aria-disabled', 'true'));
  await userEvent.click(target);
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole('option', { name: '1.34.2' }));
  await userEvent.click(canvas.getByRole('button', { name: 'Review generation request' }));
  return within(await body.findByRole('dialog'));
}

export const GenerationConfirmation: Story = {
  render: () => <Workflow scenario="success" />,
  play: async ({ canvasElement }) => {
    const dialog = await reviewRequest(canvasElement);
    await expect(dialog.getByText(/This POST writes or replaces/)).toBeVisible();
  },
};

export const GenerationSubmitting: Story = {
  render: () => <Workflow scenario="submitting" />,
  play: async ({ canvasElement }) => {
    const dialog = await reviewRequest(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm POST and generate' }));
    await expect(dialog.getByRole('button', { name: 'Confirm POST and generate' })).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveTextContent('Generating and verifying');
  },
};

export const GenerationVerificationFailure: Story = {
  render: () => <Workflow scenario="verificationFailure" />,
  play: async ({ canvasElement }) => {
    const dialog = await reviewRequest(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm POST and generate' }));
    await within(canvasElement).findByText(/Evaluation was not verified:/);
  },
};

export const GenerationSuccess: Story = {
  render: () => <Workflow scenario="success" />,
  play: async ({ canvasElement }) => {
    const dialog = await reviewRequest(canvasElement);
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm POST and generate' }));
    await within(canvasElement).findByText('Stored readiness: Ready');
  },
};
