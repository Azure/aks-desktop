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

import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { KubeObject } from '../../../../lib/k8s/KubeObject';
import { createMuiTheme } from '../../../../lib/themes';
import { TestContext } from '../../../../test';
import { MainInfoHeader } from './MainInfoSectionHeader';

const { mockActivityClose, mockUseActivity } = vi.hoisted(() => ({
  mockActivityClose: vi.fn(),
  mockUseActivity: vi.fn(),
}));

vi.mock('../../../activity/Activity', () => ({
  Activity: { close: mockActivityClose, launch: vi.fn() },
  useActivity: () => mockUseActivity(),
}));

vi.mock('../../../../redux/clusterActionSlice', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../redux/clusterActionSlice')>()),
  clusterAction: () => () => {},
}));

vi.mock('../AuthVisible', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Not under test here, and they need more of a real KubeObject than this stub.
vi.mock('../RestartButton', () => ({ RestartButton: () => null }));
vi.mock('../ScaleButton', () => ({ default: () => null }));
vi.mock('../EditButton', () => ({ default: () => null }));

const theme = createMuiTheme({ base: 'light', name: 'light' });

const resource = {
  kind: 'Deployment',
  metadata: { name: 'my-app', namespace: 'default', uid: 'abc' },
  delete: vi.fn(),
  getName: () => 'my-app',
  getDetailsLink: () => '/c/mycluster/deployments/default/my-app',
  getListLink: () => '/c/mycluster/deployments',
} as unknown as KubeObject;

function renderAndConfirmDelete() {
  render(
    <TestContext urlPrefix="/c/mycluster/projects/my-project">
      <ThemeProvider theme={theme}>
        <MainInfoHeader resource={resource} />
      </ThemeProvider>
    </TestContext>
  );
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  const dialog = screen.getByRole('dialog');
  const confirm = within(dialog)
    .getAllByRole('button')
    .find(b => b.textContent?.trim() === 'Delete')!;
  fireEvent.click(confirm);
}

describe('MainInfoHeader delete action', () => {
  beforeEach(() => {
    mockActivityClose.mockClear();
  });

  it('dismisses the enclosing details pane when the object is deleted', () => {
    // Regression test for #852: the split-right details pane used to stay open
    // on a resource that was on its way out.
    mockUseActivity.mockReturnValue([{ id: 'detailsDeployment my-app' }, vi.fn()]);
    renderAndConfirmDelete();
    expect(mockActivityClose).toHaveBeenCalledWith('detailsDeployment my-app');
  });

  it('closes nothing when the details view is a route, not a pane', () => {
    // Route-level details pages render outside any activity.
    mockUseActivity.mockReturnValue([{}, vi.fn()]);
    renderAndConfirmDelete();
    expect(mockActivityClose).not.toHaveBeenCalled();
  });
});
