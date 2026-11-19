// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { listNamespaceRoleAssignments, verifyNamespaceAccess } from './az-namespace-access';

const cli = vi.hoisted(() => vi.fn());
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: cli }));

const subscriptionId = '12345678-1234-1234-1234-123456789abc';
const principalId = 'abcdefab-1234-1234-1234-123456789abc';
const deletedId = 'deadbeef-1234-1234-1234-123456789abc';
const roleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7';
const definitionPath = `/providers/Microsoft.Authorization/roleDefinitions/${roleId}`;
const groupScope = `/subscriptions/${subscriptionId}/resourceGroups/rg`;
const clusterScope = `${groupScope}/providers/Microsoft.ContainerService/managedClusters/aks`;
const namespaceScope = `${clusterScope}/managedNamespaces/project`;
const arcScope = `${groupScope}/providers/Microsoft.Kubernetes/connectedClusters/aks/namespaces/project`;
const arm = 'https://management.example.test';
const graph = {
  endpoint: 'https://graph.example.test',
  scope: 'https://graph.example.test/.default',
};
const getToken = vi.fn(async () => ({
  token: 'test-token',
  expiresOnTimestamp: Date.now() + 60_000,
}));
const options = {
  subscriptionId,
  tenantId: 'test-tenant',
  clusterName: 'aks',
  resourceGroup: 'rg',
  namespaceName: 'project',
  endpoint: arm,
  audience: 'https://arm-audience.example.test/.default',
  credential: { getToken },
};
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const assignment = (scope: string, principal: string, principalType?: string) => ({
  id: `${scope}/providers/Microsoft.Authorization/roleAssignments/${principal}`,
  properties: { scope, principalId: principal, principalType, roleDefinitionId: definitionPath },
});
const definitions = {
  value: [
    { id: `/subscriptions/${subscriptionId}${definitionPath}`, properties: { roleName: 'Reader' } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  expect(cli).not.toHaveBeenCalled();
});

test('lists all direct managed assignments and keeps deleted principals in the result', async () => {
  const user = assignment(namespaceScope.toUpperCase(), principalId.toUpperCase(), 'User');
  const deleted = assignment(namespaceScope, deletedId);
  const roleAssignments = `${namespaceScope}/providers/Microsoft.Authorization/roleAssignments`;
  fetchMock
    .mockResolvedValueOnce(json({ id: namespaceScope }))
    .mockResolvedValueOnce(
      json({
        value: [
          assignment(clusterScope, principalId),
          assignment(`${namespaceScope}/child`, principalId),
        ],
        nextLink: `${arm}${roleAssignments}?api-version=2022-04-01&$skiptoken=second`,
      })
    )
    .mockResolvedValueOnce(json({ value: [user, deleted] }))
    .mockResolvedValueOnce(json(definitions))
    .mockResolvedValueOnce(
      json({ value: [{ id: principalId, userPrincipalName: 'user@example.test' }] })
    );

  await expect(listNamespaceRoleAssignments({ ...options, graph })).resolves.toEqual({
    success: true,
    assignments: [
      {
        id: user.id,
        principalName: 'user@example.test',
        principalType: 'User',
        roleDefinitionName: 'Reader',
        scope: user.properties.scope,
      },
      {
        id: deleted.id,
        principalName: null,
        principalType: null,
        roleDefinitionName: 'Reader',
        scope: namespaceScope,
      },
    ],
  });
  const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
  expect(urls[0].pathname).toBe(namespaceScope);
  expect(urls[1].pathname).toBe(roleAssignments);
  expect(urls[1].searchParams.get('$filter')).toBe('atScope()');
  expect(urls[2].searchParams.get('$skiptoken')).toBe('second');
  expect(urls[4].href).toBe(`${graph.endpoint}/v1.0/directoryObjects/getByIds`);
  expect(fetchMock.mock.calls[4][1]).toMatchObject({
    method: 'POST',
    body: JSON.stringify({ ids: [principalId, deletedId] }),
  });
  expect(getToken).toHaveBeenNthCalledWith(
    1,
    options.audience,
    expect.objectContaining({ tenantId: options.tenantId })
  );
  expect(getToken).toHaveBeenLastCalledWith(
    graph.scope,
    expect.objectContaining({ tenantId: options.tenantId })
  );
});

test('lists Arc assignments without a namespace lookup and keeps rows after Graph denial', async () => {
  const row = assignment(arcScope, principalId, 'Group');
  fetchMock
    .mockResolvedValueOnce(json({ value: [row] }))
    .mockResolvedValueOnce(json(definitions))
    .mockResolvedValueOnce(json({ error: { code: 'Authorization_RequestDenied' } }, 403));

  await expect(
    listNamespaceRoleAssignments({ ...options, graph, isArcCluster: true })
  ).resolves.toEqual({
    success: true,
    assignments: [
      {
        id: row.id,
        principalName: null,
        principalType: 'Group',
        roleDefinitionName: 'Reader',
        scope: arcScope,
      },
    ],
  });
  expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(
    `${arcScope}/providers/Microsoft.Authorization/roleAssignments`
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('reports later ARM page failure instead of returning partial assignments', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ id: namespaceScope }))
    .mockResolvedValueOnce(
      json({ value: [assignment(namespaceScope, principalId)], nextLink: '?page=2' })
    )
    .mockResolvedValueOnce(json({ error: { code: 'AuthorizationFailed' } }, 403));

  await expect(listNamespaceRoleAssignments(options)).resolves.toEqual({
    success: false,
    assignments: [],
    error: expect.stringContaining('AuthorizationFailed'),
  });
});

test.each([true, false])(
  'verifies access only for a matching direct grant (present: %s)',
  async present => {
    const rows = [assignment(clusterScope, principalId), assignment(namespaceScope, deletedId)];
    if (present) rows.push(assignment(namespaceScope, principalId.toUpperCase(), 'User'));
    fetchMock
      .mockResolvedValueOnce(json({ id: namespaceScope }))
      .mockResolvedValueOnce(json({ value: rows }))
      .mockResolvedValueOnce(json(definitions));

    await expect(
      verifyNamespaceAccess({ ...options, assigneeObjectId: principalId })
    ).resolves.toEqual({
      success: true,
      hasAccess: present,
      stdout: JSON.stringify(
        present ? [{ roleDefinitionName: 'Reader', scope: namespaceScope }] : []
      ),
      stderr: '',
    });
    expect(fetchMock).toHaveBeenCalledTimes(present ? 3 : 2);
  }
);

test('retains the assignment when the role definition cannot be read', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ id: namespaceScope }))
    .mockResolvedValueOnce(json({ value: [assignment(namespaceScope, principalId, 'User')] }))
    .mockResolvedValueOnce(json({ error: { code: 'AuthorizationFailed' } }, 403));

  await expect(listNamespaceRoleAssignments(options)).resolves.toMatchObject({
    success: true,
    assignments: [{ principalName: null, roleDefinitionName: roleId }],
  });
});

test('does not check assignments when the managed namespace is absent', async () => {
  fetchMock.mockResolvedValueOnce(json({ error: { code: 'ResourceNotFound' } }, 404));

  await expect(
    verifyNamespaceAccess({ ...options, assigneeObjectId: principalId })
  ).resolves.toMatchObject({
    success: false,
    hasAccess: false,
    error: expect.stringContaining('Managed namespace not found'),
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('reports cancellation instead of an empty successful list', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Cancelled by caller'));

  await expect(
    listNamespaceRoleAssignments({ ...options, signal: controller.signal })
  ).resolves.toEqual({
    success: false,
    assignments: [],
    error: expect.stringContaining('Cancelled by caller'),
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
