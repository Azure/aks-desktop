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

import { fireEvent, render, screen, within } from '@testing-library/react';
import { KubeObject } from '../../../lib/k8s/KubeObject';
import { TestContext } from '../../../test';
import DeleteButton from './DeleteButton';

const { mockClusterAction } = vi.hoisted(() => ({ mockClusterAction: vi.fn() }));

vi.mock('../../../redux/clusterActionSlice', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../redux/clusterActionSlice')>()),
  clusterAction: (...args: any[]) => {
    mockClusterAction(...args);
    // clusterAction returns a thunk; a no-op one keeps dispatch happy.
    return () => {};
  },
}));

// AuthVisible performs a real SelfSubjectAccessReview; the button's visibility
// is not what these tests are about.
vi.mock('./AuthVisible', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const DETAILS_LINK = '/c/mycluster/deployments/default/my-app';
const LIST_LINK = '/c/mycluster/deployments';

function makeItem() {
  return {
    kind: 'Deployment',
    metadata: { name: 'my-app', namespace: 'default', uid: 'abc' },
    delete: vi.fn(),
    getDetailsLink: () => DETAILS_LINK,
    getListLink: () => LIST_LINK,
  } as unknown as KubeObject;
}

/** Renders the button at `pathname` and clicks through the confirm dialog. */
function deleteFrom(pathname: string, extraProps: Record<string, any> = {}) {
  render(
    <TestContext urlPrefix={pathname}>
      <DeleteButton item={makeItem()} {...extraProps} />
    </TestContext>
  );
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  const dialog = screen.getByRole('dialog');
  const confirm = within(dialog)
    .getAllByRole('button')
    .find(b => b.textContent?.trim() === 'Delete')!;
  fireEvent.click(confirm);
  return mockClusterAction.mock.calls.at(-1)?.[1];
}

describe('DeleteButton', () => {
  beforeEach(() => {
    mockClusterAction.mockClear();
  });

  it('navigates to the list when deleting from the item’s own details page', () => {
    // That page would 404 once the object is gone, so leaving it is correct.
    const options = deleteFrom(DETAILS_LINK);
    expect(options.startUrl).toBe(LIST_LINK);
    expect(options.errorUrl).toBe(LIST_LINK);
  });

  it('stays put when deleting from somewhere else', () => {
    // Regression test for #852: deleting a resource from inside a project view
    // used to throw the user out to the cluster-wide resource list.
    const projectPage = '/c/mycluster/projects/my-project';
    const options = deleteFrom(projectPage);
    expect(options.startUrl).toBe(projectPage);
    expect(options.errorUrl).toBe(projectPage);
  });

  it('lets an explicit options prop win over the computed url', () => {
    const options = deleteFrom('/c/mycluster/projects/my-project', {
      options: { startUrl: '/somewhere/else' },
    });
    expect(options.startUrl).toBe('/somewhere/else');
  });
});
