// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createManagedNamespaceQueryClient,
  getManagedNamespaceAuthState,
  invalidateManagedNamespaceAuth,
  type ManagedNamespaceDetails,
  managedNamespaceQueryKey,
  updateManagedNamespaceAuth,
} from '../../../utils/azure/managedNamespaceQueries';
import { useInfoTab } from './useInfoTab';

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  show: vi.fn(),
  update: vi.fn(),
  command: vi.fn(),
  clusterAction: vi.fn(),
  actions: [] as Promise<unknown>[],
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  clusterAction: mocks.clusterAction,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  clusterRequest: mocks.metadata,
}));
vi.mock('../../../utils/azure/az-namespaces', () => ({
  getManagedNamespaceDetails: mocks.show,
  updateManagedNamespace: mocks.update,
}));
vi.mock('../../../utils/azure/az-cli-core', () => ({
  debugLog: vi.fn(),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isAzError: (stderr: string) => stderr.startsWith('ERROR'),
  needsRelogin: () => false,
  runCommandAsync: mocks.command,
}));
vi.mock('../../../utils/shared/isAksProject', () => ({
  supportsManagedNamespaceSettings: (labels: Record<string, string>) =>
    !labels['aks-desktop/project-authz-model'],
}));

const project = { id: 'project-id', clusters: ['cluster'], namespaces: ['namespace'] };
const target = {
  subscriptionId: 'subscription',
  resourceGroup: 'group',
  clusterName: 'cluster',
  namespaceName: 'namespace',
};
const account = { isLoggedIn: true, username: 'user@example.com', tenantId: 'tenant' };
const metadata = (labels: Record<string, string> = {}) => ({
  metadata: {
    name: 'namespace',
    labels: {
      'headlamp.dev/project-managed-by': 'aks-desktop',
      'aks-desktop/project-subscription': 'subscription',
      'aks-desktop/project-resource-group': 'group',
      ...labels,
    },
  },
});
const details = (ingress = 'AllowAll'): ManagedNamespaceDetails => ({
  properties: {
    defaultNetworkPolicy: { ingress, egress: 'DenyAll' },
    defaultResourceQuota: {
      cpuRequest: '500m',
      cpuLimit: '1000m',
      memoryRequest: '256Mi',
      memoryLimit: '512Mi',
    },
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('useInfoTab', () => {
  let client: ReturnType<typeof createManagedNamespaceQueryClient>;
  let wrapper: (props: PropsWithChildren) => React.ReactElement;
  const key = () => managedNamespaceQueryKey(target, getManagedNamespaceAuthState().generation);
  const render = (value = project) =>
    renderHook(({ value }) => useInfoTab(value), { initialProps: { value }, wrapper });
  const loaded = async (result: ReturnType<typeof render>['result']) =>
    waitFor(() => expect(result.current.namespaceDetails).not.toBeNull());
  const save = async (result: ReturnType<typeof render>['result']) =>
    act(async () => {
      result.current.handleSave();
      await mocks.actions[mocks.actions.length - 1];
    });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actions.length = 0;
    updateManagedNamespaceAuth(account);
    client = createManagedNamespaceQueryClient();
    wrapper = ({ children }) => createElement(QueryClientProvider, { client }, children);
    mocks.metadata.mockResolvedValue(metadata());
    mocks.show.mockResolvedValue(details());
    mocks.update.mockResolvedValue({});
    mocks.clusterAction.mockImplementation((action: () => Promise<unknown>) => {
      const task = action();
      mocks.actions.push(task);
      void task.catch(() => undefined);
    });
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  test('cold load makes one direct show with the namespace name, not project ID', async () => {
    const { result } = render();
    expect(result.current.loading).toBe(true);
    await loaded(result);
    expect(mocks.show).toHaveBeenCalledExactlyOnceWith(target);
    expect(mocks.metadata).toHaveBeenCalledWith('/api/v1/namespaces/namespace', {
      cluster: 'cluster',
      method: 'GET',
    });
    expect(result.current.formData).toMatchObject({
      ingress: 'AllowAll',
      egress: 'DenyAll',
      cpuRequest: 500,
      cpuLimit: 1000,
      memoryRequest: 256,
      memoryLimit: 512,
    });
    expect(result.current.hasChanges).toBe(false);
  });

  test('deduplicates concurrent consumers and fresh remounts', async () => {
    const first = render();
    const second = render();
    await loaded(first.result);
    await loaded(second.result);
    expect(mocks.show).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
    const third = render();
    expect(third.result.current.loading).toBe(false);
    expect(third.result.current.namespaceDetails).toEqual(details());
    await act(async () => {});
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  test('deduplicates an in-flight read across unmount and remount', async () => {
    const pending = deferred<ManagedNamespaceDetails>();
    mocks.show.mockReturnValue(pending.promise);
    const first = render();
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = render();
    await act(async () => pending.resolve(details()));
    await loaded(second.result);
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  test('late metadata hydrates a fresh cache without a cold show', async () => {
    const pending = deferred<ReturnType<typeof metadata>>();
    mocks.metadata.mockReturnValue(pending.promise);
    client.setQueryData(key(), details('DenyAll'));
    const { result } = render();
    expect(result.current.loading).toBe(true);
    expect(mocks.show).not.toHaveBeenCalled();
    await act(async () => pending.resolve(metadata()));
    await loaded(result);
    expect(result.current.formData.ingress).toBe('DenyAll');
    expect(result.current.loading).toBe(false);
    expect(mocks.show).not.toHaveBeenCalled();
  });

  test('late metadata hydrates stale cache while one background show runs', async () => {
    const pending = deferred<ManagedNamespaceDetails>();
    client.setQueryData(key(), details('DenyAll'), { updatedAt: Date.now() - 60_001 });
    mocks.show.mockReturnValue(pending.promise);
    const { result } = render();
    await loaded(result);
    expect(result.current.formData.ingress).toBe('DenyAll');
    expect(result.current.loading).toBe(false);
    expect(result.current.revalidating).toBe(true);
    await act(async () => pending.resolve(details()));
    await waitFor(() => expect(result.current.formData.ingress).toBe('AllowAll'));
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  test.each(['clusters', 'namespaces'] as const)('rejects an empty %s target', async field => {
    const { result } = render({ ...project, [field]: [] });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain('one cluster and one namespace');
    expect(mocks.metadata).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
    act(() => result.current.handleSave());
    expect(result.current.saveError).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test.each([
    { 'aks-desktop/project-subscription': '' },
    { 'aks-desktop/project-resource-group': '' },
    { 'aks-desktop/project-authz-model': 'kubernetes-rbac' },
  ])('does not read or save an incomplete/unsupported target: %j', async labels => {
    mocks.metadata.mockResolvedValue(metadata(labels));
    const { result } = render();
    await waitFor(() => expect(result.current.error).toContain('unavailable'));
    act(() => result.current.handleSave());
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('metadata failure is visible and retryable without Azure requests', async () => {
    mocks.metadata.mockRejectedValueOnce(new Error('namespace forbidden'));
    const { result } = render();
    await waitFor(() => expect(result.current.error).toContain('namespace forbidden'));
    expect(mocks.show).not.toHaveBeenCalled();
    act(() => result.current.handleRefresh());
    await loaded(result);
    expect(result.current.error).toBeNull();
  });

  test.each([false, true])(
    'retries failed cached metadata and follows changed resource-group labels: %s',
    async changeGroup => {
      const first = render();
      await loaded(first.result);
      first.unmount();
      const metadataKey = [
        'aks-desktop',
        'managed-namespace',
        'metadata',
        getManagedNamespaceAuthState().generation,
        target.clusterName,
        target.namespaceName,
      ];
      client.setQueryData(metadataKey, metadata(), { updatedAt: Date.now() - 60_001 });
      mocks.metadata.mockRejectedValueOnce(new Error('metadata temporarily unavailable'));
      const { result } = render();
      await waitFor(() =>
        expect(result.current.error).toContain('metadata temporarily unavailable')
      );
      expect(result.current.namespaceDetails).toEqual(details());
      act(() => result.current.handleFormDataChange({ cpuLimit: 1500 }));
      const retry = deferred<ReturnType<typeof metadata>>();
      mocks.metadata.mockReturnValueOnce(retry.promise);
      mocks.show.mockResolvedValue(details('DenyAll'));
      act(() => result.current.handleRefresh());
      await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(3));
      expect(result.current.revalidating).toBe(true);
      await act(async () =>
        retry.resolve(
          metadata(changeGroup ? { 'aks-desktop/project-resource-group': 'new-group' } : {})
        )
      );
      await waitFor(() => expect(result.current.error).toBeNull());
      await waitFor(() => expect(result.current.revalidating).toBe(false));
      expect(result.current.formData.ingress).toBe(changeGroup ? 'DenyAll' : 'AllowAll');
      expect(result.current.formData.cpuLimit).toBe(changeGroup ? 1000 : 1500);
      expect(result.current.hasChanges).toBe(!changeGroup);
      expect(mocks.show).toHaveBeenCalledTimes(2);
      if (changeGroup) {
        expect(mocks.show).toHaveBeenLastCalledWith({ ...target, resourceGroup: 'new-group' });
      }
    }
  );

  test('cold failure preserves actionable errors, does not retry, and supports Retry', async () => {
    mocks.show.mockRejectedValueOnce(new Error('Authentication required: az login'));
    const { result } = render();
    await waitFor(() => expect(result.current.error).toContain('az login'));
    expect(result.current.loading).toBe(false);
    expect(mocks.show).toHaveBeenCalledTimes(1);
    act(() => result.current.handleRefresh());
    await loaded(result);
    expect(result.current.error).toBeNull();
  });

  test('explicit refresh bypasses freshness and repeated clicks share the pending read', async () => {
    const { result } = render();
    await loaded(result);
    const pending = deferred<ManagedNamespaceDetails>();
    mocks.show.mockReturnValue(pending.promise);
    act(() => {
      result.current.handleRefresh();
      result.current.handleRefresh();
    });
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(false);
    expect(result.current.revalidating).toBe(true);
    await act(async () => pending.resolve(details('DenyAll')));
    await waitFor(() => expect(result.current.formData.ingress).toBe('DenyAll'));
  });

  test.each([
    ['subscriptionId', 'aks-desktop/project-subscription', false],
    ['subscriptionId', 'aks-desktop/project-subscription', true],
    ['resourceGroup', 'aks-desktop/project-resource-group', false],
    ['resourceGroup', 'aks-desktop/project-resource-group', true],
  ] as const)(
    'Refresh reloads %s (%s) before reads and saves without remounting (cached target: %s)',
    async (field, label, cachedTarget) => {
      const { result } = render();
      await loaded(result);
      const nextTarget = { ...target, [field]: 'new-scope' };
      if (cachedTarget) {
        client.setQueryData(
          managedNamespaceQueryKey(nextTarget, getManagedNamespaceAuthState().generation),
          details('DenyAll')
        );
      }
      const next = deferred<ManagedNamespaceDetails>();
      mocks.metadata.mockResolvedValueOnce(metadata({ [label]: 'new-scope' }));
      mocks.show.mockReturnValueOnce(next.promise);
      act(() => {
        result.current.handleRefresh();
        result.current.handleRefresh();
      });
      await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2));
      expect(mocks.show).toHaveBeenLastCalledWith(nextTarget);
      await act(async () => next.resolve(details('AllowSameNamespace')));
      await waitFor(() => expect(result.current.revalidating).toBe(false));
      expect(result.current.formData.ingress).toBe('AllowSameNamespace');
      expect(mocks.show).toHaveBeenCalledTimes(2);
      act(() => result.current.handleFormDataChange({ cpuLimit: 2000 }));
      await save(result);
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining(nextTarget));
    }
  );

  test('Refresh stops before Azure reads when authentication changes during metadata reload', async () => {
    const { result } = render();
    await loaded(result);
    const pending = deferred<ReturnType<typeof metadata>>();
    mocks.metadata.mockReturnValueOnce(pending.promise);
    act(() => result.current.handleRefresh());
    await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(2));
    act(() => invalidateManagedNamespaceAuth());
    await act(async () =>
      pending.resolve(metadata({ 'aks-desktop/project-resource-group': 'new-scope' }))
    );
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(result.current.namespaceDetails).toBeNull();
    expect(result.current.error).toContain('Sign in');
  });

  test('Refresh immediately blocks saves while current namespace labels are unresolved', async () => {
    const { result } = render();
    await loaded(result);
    const pending = deferred<ReturnType<typeof metadata>>();
    mocks.metadata.mockReturnValueOnce(pending.promise);
    act(() => result.current.handleFormDataChange({ cpuLimit: 2000 }));
    act(() => {
      result.current.handleRefresh();
      result.current.handleSave();
    });
    await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(2));
    expect(result.current.resolvingTarget).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => pending.resolve(metadata()));
    await waitFor(() => expect(result.current.revalidating).toBe(false));
    expect(result.current.formData.cpuLimit).toBe(2000);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('Refresh does not read an old target when namespace metadata reload fails', async () => {
    const { result } = render();
    await loaded(result);
    mocks.metadata.mockRejectedValueOnce(new Error('metadata refresh failed'));
    act(() => result.current.handleRefresh());
    await waitFor(() => expect(result.current.error).toContain('metadata refresh failed'));
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(result.current.namespaceDetails).toEqual(details());
  });

  test('a pending Refresh keeps metadata paired with its captured namespace after navigation', async () => {
    const { result, rerender } = render();
    await loaded(result);
    const pending = deferred<ReturnType<typeof metadata>>();
    mocks.metadata
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(metadata({ 'aks-desktop/project-resource-group': 'b-group' }));
    act(() => result.current.handleRefresh());
    await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(2));
    rerender({ value: { ...project, namespaces: ['namespace-b'] } });
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({
        ...target,
        namespaceName: 'namespace-b',
        resourceGroup: 'b-group',
      })
    );
    await act(async () =>
      pending.resolve(metadata({ 'aks-desktop/project-resource-group': 'a-moved' }))
    );
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({ ...target, resourceGroup: 'a-moved' })
    );
    expect(mocks.show).not.toHaveBeenCalledWith({ ...target, resourceGroup: 'b-group' });
    expect(result.current.namespaceDetails).toEqual(details());
  });

  test('refresh preserves unsaved values and baseline while updating the snapshot', async () => {
    const { result } = render();
    await loaded(result);
    act(() => result.current.handleFormDataChange({ ingress: 'AllowSameNamespace' }));
    mocks.show.mockResolvedValue(details('DenyAll'));
    act(() => result.current.handleRefresh());
    await waitFor(() => expect(result.current.hasRemoteChanges).toBe(true));
    expect(result.current.formData.ingress).toBe('AllowSameNamespace');
    expect(result.current.hasChanges).toBe(true);
    expect(client.getQueryData(key())).toEqual(details('DenyAll'));
    act(() => result.current.handleFormDataChange({ ingress: 'AllowAll' }));
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.formData.ingress).toBe('DenyAll');
  });

  test('refresh failure keeps the snapshot and edits, and surfaces recovery', async () => {
    const { result } = render();
    await loaded(result);
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    mocks.show.mockRejectedValue(new Error('offline'));
    act(() => result.current.handleRefresh());
    await waitFor(() => expect(result.current.error).toContain('offline'));
    expect(result.current.namespaceDetails).toEqual(details());
    expect(result.current.formData.ingress).toBe('DenyAll');
    expect(result.current.hasChanges).toBe(true);
  });

  test.each([
    ['subscriptionId', 'aks-desktop/project-subscription'],
    ['resourceGroup', 'aks-desktop/project-resource-group'],
  ])('isolates draft and cached data when %s changes', async (field, label) => {
    const { result } = render();
    await loaded(result);
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    client.setQueryData(
      managedNamespaceQueryKey(
        { ...target, [field]: 'other' },
        getManagedNamespaceAuthState().generation
      ),
      details('AllowSameNamespace')
    );
    act(() => {
      const entry = client
        .getQueryCache()
        .findAll()
        .find(query => query.queryKey[2] === 'metadata');
      if (!entry) throw new Error('Expected metadata query');
      client.setQueryData(entry.queryKey, metadata({ [label]: 'other' }));
    });
    await waitFor(() => expect(result.current.formData.ingress).toBe('AllowSameNamespace'));
    expect(result.current.hasChanges).toBe(false);
  });

  test.each(['clusters', 'namespaces'] as const)(
    'late A read cannot change B after %s changes',
    async field => {
      const old = deferred<ManagedNamespaceDetails>();
      mocks.show.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('B failed'));
      const { result, rerender } = render();
      await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));
      rerender({ value: { ...project, [field]: ['other'] } });
      await waitFor(() => expect(result.current.error).toContain('B failed'));
      await act(async () => old.resolve(details()));
      expect(result.current.namespaceDetails).toBeNull();
      expect(result.current.error).toContain('B failed');
      expect(result.current.hasChanges).toBe(false);
    }
  );

  test('successful save publishes confirmed settings and preserves clusterAction notifications', async () => {
    const { result, unmount } = render();
    await loaded(result);
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    await save(result);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        ...target,
        ingressPolicy: 'DenyAll',
        egressPolicy: 'DenyAll',
        cpuRequest: 500,
      })
    );
    expect(mocks.clusterAction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        startMessage: 'Updating namespace {{ name }}…',
        successMessage: 'Updated namespace {{ name }}.',
        errorMessage: 'Failed to update namespace {{ name }}.',
      })
    );
    expect(client.getQueryData(key())).toEqual(details('DenyAll'));
    expect(result.current.hasChanges).toBe(false);
    unmount();
    const next = render();
    expect(next.result.current.formData.ingress).toBe('DenyAll');
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  test('a partial update response wins over submitted values without dropping unrelated settings', async () => {
    const original = {
      ...details(),
      labels: { unrelated: 'keep' },
    };
    mocks.show.mockResolvedValue(original);
    mocks.update.mockResolvedValue({
      properties: { defaultResourceQuota: { cpuLimit: '2000m' } },
    });
    const { result } = render();
    await loaded(result);
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    await save(result);
    expect(result.current.formData).toMatchObject({
      ingress: 'DenyAll',
      egress: 'DenyAll',
      cpuRequest: 500,
      cpuLimit: 2000,
    });
    expect(client.getQueryData(key())).toMatchObject({
      labels: { unrelated: 'keep' },
      properties: { defaultResourceQuota: { memoryLimit: '512Mi' } },
    });
    expect(result.current.hasChanges).toBe(false);
  });

  test.each([
    ['ingress', 'AllowAll'],
    ['egress', 'AllowSameNamespace'],
    ['cpuRequest', 700],
    ['cpuLimit', 3000],
    ['memoryRequest', 400],
    ['memoryLimit', 2048],
  ] as const)(
    'save retains only the %s edit made during submission and adopts other confirmed fields',
    async (field, value) => {
      const { result } = render();
      await loaded(result);
      const pending = deferred<ManagedNamespaceDetails>();
      mocks.update.mockReturnValueOnce(pending.promise);
      act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
      act(() => result.current.handleSave());
      await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
      act(() => result.current.handleFormDataChange({ [field]: value }));
      const confirmed = {
        properties: {
          defaultNetworkPolicy: { ingress: 'AllowSameNamespace', egress: 'AllowAll' },
          defaultResourceQuota: {
            cpuRequest: '600m',
            cpuLimit: '2000m',
            memoryRequest: '384Mi',
            memoryLimit: '1024Mi',
          },
        },
      };
      await act(async () => pending.resolve(confirmed));
      await waitFor(() => expect(result.current.updating).toBe(false));
      const expected = {
        ingress: 'AllowSameNamespace',
        egress: 'AllowAll',
        cpuRequest: 600,
        cpuLimit: 2000,
        memoryRequest: 384,
        memoryLimit: 1024,
        [field]: value,
      };
      expect(result.current.formData).toMatchObject(expected);
      expect(result.current.hasChanges).toBe(true);
      expect(client.getQueryData(key())).toEqual(confirmed);
      await save(result);
      expect(mocks.update).toHaveBeenLastCalledWith({
        ...target,
        assertCanUpdate: expect.any(Function),
        ingressPolicy: expected.ingress,
        egressPolicy: expected.egress,
        cpuRequest: expected.cpuRequest,
        cpuLimit: expected.cpuLimit,
        memoryRequest: expected.memoryRequest,
        memoryLimit: expected.memoryLimit,
      });
      expect(result.current.hasChanges).toBe(false);
    }
  );

  test.each([undefined, 'AllowAll', 'DenyAll', 'AllowSameNamespace'] as const)(
    'quota-only saves preserve egress policy %s and default missing egress to AllowAll',
    async egress => {
      mocks.show.mockResolvedValue({
        properties: {
          ...details().properties,
          defaultNetworkPolicy: { ingress: 'AllowAll', egress },
        },
      });
      const { result } = render();
      await loaded(result);
      expect(result.current.formData.egress).toBe(egress ?? 'AllowAll');
      act(() => result.current.handleFormDataChange({ cpuLimit: 2000 }));
      await save(result);
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ cpuLimit: 2000, egressPolicy: egress ?? 'AllowAll' })
      );
    }
  );

  test('multiple field edits in one event retain both values', async () => {
    const { result } = render();
    await loaded(result);
    act(() => {
      result.current.handleFormDataChange({ ingress: 'DenyAll' });
      result.current.handleFormDataChange({ cpuLimit: 2000 });
    });
    expect(result.current.formData).toMatchObject({ ingress: 'DenyAll', cpuLimit: 2000 });
  });

  test('editing a previously clean form uses the latest refreshed snapshot', async () => {
    const { result } = render();
    await loaded(result);
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => result.current.handleFormDataChange({ ingress: 'AllowAll' }));
    mocks.show.mockResolvedValue(details('AllowSameNamespace'));
    act(() => result.current.handleRefresh());
    await waitFor(() => expect(result.current.formData.ingress).toBe('AllowSameNamespace'));
    act(() => result.current.handleFormDataChange({ cpuLimit: 2000 }));
    expect(result.current.formData.ingress).toBe('AllowSameNamespace');
    expect(result.current.formData.cpuLimit).toBe(2000);
  });

  test('a failed old read cannot replace the next target error or data', async () => {
    const old = deferred<ManagedNamespaceDetails>();
    mocks.show.mockReturnValueOnce(old.promise);
    const { result, rerender } = render();
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));
    rerender({ value: { ...project, namespaces: ['other'] } });
    await loaded(result);
    await act(async () => old.reject(new Error('old target failed')));
    expect(result.current.error).toBeNull();
    expect(result.current.formData.ingress).toBe('AllowAll');
  });

  test('an old background GET resolving after save cannot roll back cache or form', async () => {
    const { result } = render();
    await loaded(result);
    const old = deferred<ManagedNamespaceDetails>();
    mocks.show.mockReturnValue(old.promise);
    act(() => result.current.handleRefresh());
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2));
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    await save(result);
    await act(async () => old.resolve(details()));
    expect(result.current.formData.ingress).toBe('DenyAll');
    expect(result.current.hasChanges).toBe(false);
    expect(client.getQueryData(key())).toEqual(details('DenyAll'));
  });

  test('save preserves newer edits and suppresses duplicate saves and refresh', async () => {
    const { result } = render();
    await loaded(result);
    const pending = deferred<ManagedNamespaceDetails>();
    mocks.update.mockReturnValue(pending.promise);
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => {
      result.current.handleSave();
      result.current.handleSave();
      result.current.handleRefresh();
    });
    await waitFor(() => expect(result.current.updating).toBe(true));
    act(() => result.current.handleFormDataChange({ ingress: 'AllowSameNamespace' }));
    await act(async () => pending.resolve({}));
    await waitFor(() => expect(result.current.updating).toBe(false));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(result.current.formData.ingress).toBe('AllowSameNamespace');
    expect(result.current.hasChanges).toBe(true);
    expect(client.getQueryData(key())).toEqual(details('DenyAll'));
  });

  test('save finishing after navigation updates only the captured target', async () => {
    const { result, rerender } = render();
    await loaded(result);
    const pending = deferred<ManagedNamespaceDetails>();
    mocks.update.mockReturnValue(pending.promise);
    const oldKey = key();
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => result.current.handleSave());
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    rerender({ value: { ...project, namespaces: ['other'] } });
    await loaded(result);
    await act(async () => pending.resolve({}));
    expect(client.getQueryData(oldKey)).toEqual(details('DenyAll'));
    expect(result.current.formData.ingress).toBe('AllowAll');
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  test('save failure preserves edits, exposes error, and propagates through clusterAction', async () => {
    const { result } = render();
    await loaded(result);
    mocks.update.mockRejectedValue(new Error('update denied'));
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => result.current.handleSave());
    await expect(mocks.actions[0]).rejects.toThrow('update denied');
    await waitFor(() => expect(result.current.saveError).toBe('update denied'));
    expect(result.current.namespaceDetails).toEqual(details());
    expect(result.current.formData.ingress).toBe('DenyAll');
    expect(result.current.hasChanges).toBe(true);
    expect(result.current.updating).toBe(false);
  });

  test('auth reset hides the previous editor and prevents a late write from repopulating it', async () => {
    const { result } = render();
    await loaded(result);
    const pending = deferred<ManagedNamespaceDetails>();
    mocks.update.mockReturnValue(pending.promise);
    act(() => result.current.handleFormDataChange({ ingress: 'DenyAll' }));
    act(() => result.current.handleSave());
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const oldKey = key();
    act(() => invalidateManagedNamespaceAuth());
    expect(result.current.namespaceDetails).toBeNull();
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.error).toContain('Sign in');
    await act(async () => pending.resolve({}));
    expect(client.getQueryData(oldKey)).toEqual(details());
    act(() => updateManagedNamespaceAuth({ ...account, username: 'another@example.com' }));
    await loaded(result);
    expect(result.current.formData.ingress).toBe('AllowAll');
    expect(result.current.hasChanges).toBe(false);
  });

  test.each(['logout', 'switch accounts'])(
    'does not dispatch an update after %s during the real label-preserving read',
    async change => {
      const actual = await vi.importActual<typeof import('../../../utils/azure/az-namespaces')>(
        '../../../utils/azure/az-namespaces'
      );
      mocks.update.mockImplementation(actual.updateManagedNamespace);
      const labels = deferred<{ stdout: string; stderr: string }>();
      mocks.command
        .mockReturnValueOnce(labels.promise)
        .mockResolvedValue({ stdout: '{}', stderr: '' });
      const { result } = render();
      await loaded(result);
      act(() => result.current.handleFormDataChange({ cpuLimit: 2000 }));
      act(() => result.current.handleSave());
      await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
      expect(mocks.command.mock.calls[0][1].slice(0, 3)).toEqual(['aks', 'namespace', 'show']);
      act(() => {
        if (change === 'logout') invalidateManagedNamespaceAuth();
        else updateManagedNamespaceAuth({ ...account, username: 'replacement@example.com' });
      });
      const rejected = expect(mocks.actions[0]).rejects.toThrow(
        'Azure account changed. Sign in and try again.'
      );
      await act(async () => {
        labels.resolve({
          stdout: JSON.stringify({ properties: { labels: { unrelated: 'keep' } } }),
          stderr: '',
        });
        await rejected;
      });
      expect(mocks.command).toHaveBeenCalledTimes(1);
      expect(mocks.command.mock.calls.some(([, args]) => args[2] === 'update')).toBe(false);
    }
  );

  test('invalid quotas block save and reverting edits clears dirty state', async () => {
    const { result } = render();
    await loaded(result);
    act(() => result.current.handleFormDataChange({ cpuRequest: 2000 }));
    expect(result.current.validation.isValid).toBe(false);
    act(() => result.current.handleSave());
    expect(result.current.saveError).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    act(() => result.current.handleFormDataChange({ cpuRequest: 500 }));
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.validation.isValid).toBe(true);
  });

  test('normalizes unknown policies and malformed quotas without triggering refetches', async () => {
    mocks.show.mockResolvedValue({
      properties: {
        defaultNetworkPolicy: { ingress: 'invalid' },
        defaultResourceQuota: { cpuRequest: 'invalid', memoryRequest: 'bad' },
      },
    });
    const { result, rerender } = render();
    await loaded(result);
    expect(result.current.formData).toMatchObject({
      ingress: 'AllowSameNamespace',
      cpuRequest: 0,
      memoryRequest: 0,
    });
    rerender({ value: { ...project } });
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });
});
