// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import PreviewFeaturesSettings from './PreviewFeaturesSettings';

const update = vi.hoisted(() => vi.fn());
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (text: string) => text }),
}));
vi.mock('../../hooks/usePreviewFeatures', () => ({
  usePreviewFeatures: () => ({ githubPipelines: true, upgradeInsights: false }),
}));
vi.mock('./previewFeaturesStore', () => ({ previewFeaturesStore: { update } }));
afterEach(cleanup);

it('keeps the existing GitHub toggle and writes only the Upgrade Insights change', () => {
  render(<PreviewFeaturesSettings />);
  const github = screen.getByRole('checkbox', { name: /GitHub Pipelines/ }) as HTMLInputElement;
  const insights = screen.getByRole('checkbox', { name: /Upgrade Insights/ }) as HTMLInputElement;
  expect(github.checked).toBe(true);
  expect(insights.checked).toBe(false);
  fireEvent.click(insights);
  expect(update).toHaveBeenCalledWith({ upgradeInsights: true });
  expect(github.checked).toBe(true);
});
