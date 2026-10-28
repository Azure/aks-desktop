// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Stack } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, userEvent, within } from 'storybook/test';
import { StoryFrame } from './__fixtures__/storyFixtures';
import SessionNotice from './SessionNotice';
import SubscriptionSelection from './SubscriptionSelection';

export default {
  title: 'UpgradeInsights/Session',
  decorators: [
    Story => (
      <MemoryRouter>
        <StoryFrame>
          <Stack spacing={2}>
            <Story />
          </Stack>
        </StoryFrame>
      </MemoryRouter>
    ),
  ],
} satisfies Meta;

type Story = StoryObj;

export const PreviewDisabled: Story = {
  render: () => <SessionNotice state="disabled" />,
};

export const CheckingAccount: Story = {
  render: () => <SessionNotice state="checking" />,
};

export const SignedOut: Story = {
  render: () => <SessionNotice state="signedOut" />,
};

export const AuthenticationError: Story = {
  render: () => <SessionNotice state="signedOut" error="Azure login expired (Storybook fixture)" />,
};

function Selection({ loading = false, error = '', empty = false }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const [failure, setFailure] = useState(error);
  return (
    <SubscriptionSelection
      subscriptions={
        loading || failure || empty
          ? []
          : [{ id: 'storybook', name: 'Visual review subscription', tenantId: 'storybook-tenant' }]
      }
      selectedIds={selectedIds}
      loading={loading}
      error={failure}
      busy={false}
      selectionChanged={selectedIds.join() !== applied.join()}
      onSelectionChange={setSelectedIds}
      onRetry={() => setFailure('')}
      onApply={() => setApplied([...selectedIds])}
    />
  );
}

export const SubscriptionLoading: Story = {
  render: () => <Selection loading />,
};

export const SubscriptionError: Story = {
  render: () => <Selection error="Subscription discovery denied (Storybook fixture)" />,
};

export const NoSubscriptions: Story = {
  render: () => <Selection empty />,
};

export const ChooseSubscriptions: Story = {
  render: () => <Selection />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const apply = await canvas.findByRole('button', { name: 'Load selected subscriptions' });
    await expect(apply).toBeDisabled();
    await userEvent.click(canvas.getByRole('checkbox', { name: /Visual review subscription/ }));
    await expect(apply).toBeEnabled();
    await userEvent.click(apply);
    await expect(apply).toBeDisabled();
  },
};
