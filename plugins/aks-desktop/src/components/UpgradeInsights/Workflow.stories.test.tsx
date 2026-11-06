// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { composeStories } from '@storybook/react';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sessionStories from './Session.stories';
import * as workflowStories from './Workflow.stories';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => String(values?.[key] ?? '')),
  }),
}));

afterEach(cleanup);

const session = composeStories(sessionStories);
const workflow = composeStories(workflowStories);

describe('isolated session and workflow stories', () => {
  it.each([
    ['PreviewDisabled', /Upgrade Insights is disabled/],
    ['CheckingAccount', null],
    ['SignedOut', /Sign in to Azure to view/],
    ['AuthenticationError', /Azure login expired/],
    ['SubscriptionLoading', null],
    ['SubscriptionError', /Could not load subscriptions/],
    ['NoSubscriptions', /No enabled Azure subscriptions/],
  ] as const)('renders session state %s', async (name, message) => {
    const Story = session[name];
    render(<Story />);
    if (message) expect(await screen.findByText(message)).toBeTruthy();
    else expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText(/Storybook visual fixtures only/)).toBeTruthy();
  });

  it.each([
    ['InventoryLoading', 'Loading readiness'],
    ['ReadinessLoading', 'Loading readiness'],
    ['InventoryError', /Could not load cluster inventory/],
    ['PartialInventory', /Partial cluster inventory/],
    ['ContextDisambiguation', /Select the exact Azure ARM resource/],
    ['StoredEvaluationDetails', 'Stored readiness: Blocked'],
    ['TargetsLoading', 'Stored readiness: Blocked'],
    ['TargetsError', /Could not load upgrade targets/],
  ] as const)('renders workflow state %s', async (name, message) => {
    const Story = workflow[name];
    render(<Story />);
    expect(await screen.findByText(message)).toBeTruthy();
    if (name === 'TargetsLoading') {
      expect(screen.getByRole('progressbar', { name: 'Loading upgrade targets' })).toBeTruthy();
    }
    expect(screen.getByText(/Storybook visual fixtures only/)).toBeTruthy();
  });

  it.each([
    ['ChooseSubscriptions', session.ChooseSubscriptions],
    ['Pagination', workflow.Pagination],
    ['RawResponse', workflow.RawResponse],
    ['GenerationConfirmation', workflow.GenerationConfirmation],
    ['GenerationSubmitting', workflow.GenerationSubmitting],
    ['GenerationVerificationFailure', workflow.GenerationVerificationFailure],
    ['GenerationSuccess', workflow.GenerationSuccess],
  ] as const)('exercises %s interactions', async (_name, Story) => {
    const { container } = render(<Story />);
    await Story.play({ canvasElement: container });
  });
});
