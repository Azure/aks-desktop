// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { acceptEnvironment, startSetup } from '../../common/setupDraft';
import { PLUGIN_ROUTES } from '../../contract/routes';
import { createLocalCluster } from '../../workflow/create';
import { update } from '../../workflow/store';
import { ConfigureStep } from './ConfigureStep';
import { ReviewStep } from './ReviewStep';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (text: string) => text }),
}));
vi.mock('../../workflow/create', () => ({ createLocalCluster: vi.fn() }));

it('keeps K3s when going back from Review and creates with the reviewed distribution', () => {
  startSetup();
  acceptEnvironment('install');
  update({
    target: null,
    environment: { wsl: 'ready', target: null },
    versions: [{ version: 'v1.36.5', deprecated: false }],
  });
  render(
    <MemoryRouter initialEntries={[PLUGIN_ROUTES.configure]}>
      <Route path={PLUGIN_ROUTES.configure} component={ConfigureStep} />
      <Route path={PLUGIN_ROUTES.review} component={ReviewStep} />
    </MemoryRouter>
  );
  expect(screen.getByRole('radio', { name: 'K8s (default)', checked: true })).toBeTruthy();
  expect(screen.getByText('Cilium (default)')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'K3s' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review and create' }));
  expect(screen.getByText('Flannel (bundled)')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Back' }));
  expect(screen.getByRole('radio', { name: 'K3s', checked: true })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review and create' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create cluster' }));
  expect(createLocalCluster).toHaveBeenCalledExactlyOnceWith({
    name: 'dev-cluster',
    distribution: 'K3s',
    kubernetesVersion: 'v1.36.5',
    gpu: false,
  });
});
