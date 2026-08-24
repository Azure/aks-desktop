// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../CreateAKSProject/components/ClusterConfigurePanel', () => ({
  ClusterConfigurePanel: () => <div data-testid="cluster-configure-panel" />,
}));

import RegisterAKSClusterDialogPure, {
  RegisterAKSClusterDialogPureProps,
} from './RegisterAKSClusterDialogPure';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const noOp = () => {};

const baseArgs: RegisterAKSClusterDialogPureProps = {
  open: true,
  isChecking: false,
  isLoggedIn: true,
  loading: false,
  loadingSubscriptions: false,
  loadingClusters: false,
  capabilitiesLoading: false,
  error: '',
  success: '',
  subscriptions: [],
  selectedSubscription: null,
  subscriptionInputValue: '',
  tenants: [],
  selectedTenant: null,
  tenantInputValue: '',
  clusters: [],
  filteredClusters: [],
  clusterInputValue: '',
  selectedCluster: null,
  capabilities: null,
  onClose: noOp,
  onSubscriptionChange: noOp as any,
  onSubscriptionInputChange: noOp as any,
  onTenantChange: noOp as any,
  onTenantInputChange: noOp as any,
  onClusterChange: noOp as any,
  onClusterInputChange: noOp as any,
  onRegister: noOp,
  onDone: noOp,
  onDismissError: noOp,
  onDismissSuccess: noOp,
  onConfigured: noOp,
};

/** Open the Tenant dropdown and return its listbox options. */
async function openTenantDropdown() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Tenant' }));
  return within(screen.getByRole('listbox')).getAllByRole('option');
}

/** Assert the option renders `name` ahead of `id`, not just that both appear. */
function expectNameBeforeId(option: HTMLElement, name: string, id: string) {
  const text = option.textContent ?? '';
  expect(text).toContain(name);
  expect(text).toContain(id);
  expect(text.indexOf(name)).toBeLessThan(text.indexOf(id));
}

describe('RegisterAKSClusterDialogPure tenant options', () => {
  afterEach(cleanup);

  test('shows the tenant display name above its ID when a name is resolved', async () => {
    render(
      <RegisterAKSClusterDialogPure
        {...baseArgs}
        tenants={[
          { id: TENANT_A, name: 'Contoso' },
          { id: TENANT_B, name: 'Fabrikam' },
        ]}
      />
    );

    const options = await openTenantDropdown();

    expect(options).toHaveLength(2);
    // The name must render *above* the ID, not merely somewhere in the option.
    expectNameBeforeId(options[0], 'Contoso', TENANT_A);
    expectNameBeforeId(options[1], 'Fabrikam', TENANT_B);
  });

  test('shows an unresolvable tenant GUID once, not twice', async () => {
    render(
      <RegisterAKSClusterDialogPure
        {...baseArgs}
        tenants={[
          { id: TENANT_A, name: 'Contoso' },
          // Name unresolvable upstream — callers fall back to the ID.
          { id: TENANT_B, name: TENANT_B },
        ]}
      />
    );

    const options = await openTenantDropdown();
    const guidOccurrences = (options[1].textContent ?? '').split(TENANT_B).length - 1;

    expect(guidOccurrences).toBe(1);
  });

  test('keeps the tenant dropdown selectable when no name could be resolved', async () => {
    const onTenantChange = vi.fn();
    render(
      <RegisterAKSClusterDialogPure
        {...baseArgs}
        tenants={[
          { id: TENANT_A, name: TENANT_A },
          { id: TENANT_B, name: TENANT_B },
        ]}
        onTenantChange={onTenantChange}
      />
    );

    const options = await openTenantDropdown();
    await userEvent.setup().click(options[1]);

    expect(onTenantChange).toHaveBeenCalledTimes(1);
    expect(onTenantChange.mock.calls[0][1]).toMatchObject({ id: TENANT_B });
  });

  test('disables the tenant dropdown when there is only one tenant', () => {
    render(
      <RegisterAKSClusterDialogPure
        {...baseArgs}
        tenants={[{ id: TENANT_A, name: 'Contoso' }]}
        selectedTenant={{ id: TENANT_A, name: 'Contoso' }}
        tenantInputValue="Contoso"
      />
    );

    expect(screen.getByRole('combobox', { name: 'Tenant' })).toBeDisabled();
  });

  test('disables all cluster identity controls while registration is in flight', () => {
    const selectedSubscription = {
      id: 'sub-1',
      name: 'Production',
      state: 'Enabled',
      tenantId: TENANT_A,
    };
    const selectedCluster = {
      name: 'aks-prod',
      resourceGroup: 'rg-prod',
      location: 'eastus',
      kubernetesVersion: '1.32.0',
      provisioningState: 'Succeeded',
    };
    render(
      <RegisterAKSClusterDialogPure
        {...baseArgs}
        loading
        tenants={[
          { id: TENANT_A, name: 'Contoso' },
          { id: TENANT_B, name: 'Fabrikam' },
        ]}
        selectedTenant={{ id: TENANT_A, name: 'Contoso' }}
        tenantInputValue="Contoso"
        subscriptions={[selectedSubscription]}
        selectedSubscription={selectedSubscription}
        subscriptionInputValue="Production"
        clusters={[selectedCluster]}
        filteredClusters={[selectedCluster]}
        selectedCluster={selectedCluster}
        clusterInputValue="aks-prod"
      />
    );

    expect(screen.getByRole('combobox', { name: 'Tenant' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Subscription' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'AKS Cluster' })).toBeDisabled();
  });
});
