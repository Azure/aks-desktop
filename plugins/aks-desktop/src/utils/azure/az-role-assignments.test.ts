// @vitest-environment node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), command: vi.fn() }));
vi.mock('../shared/runCommandAsync', () => ({ runCommandAsync: mocks.command }));

import { assignAzureRoles, getManagedNamespaceResourceId } from './az-identity';
import { createNamespaceRoleAssignment } from './az-namespace-access';
import { createAzureRoleAssignment } from './az-role-assignments';

const subscriptionId = '11111111-2222-3333-4444-555555555555';
const principalId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const role = 'acdd72a7-3385-48ef-bd42-f606fba81ae7';
const roleDefinitionId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${role}`;
const groupScope = `/subscriptions/${subscriptionId}/resourceGroups/rg`;
const clusterScope = `${groupScope}/providers/Microsoft.ContainerService/managedClusters/aks`;
const namespaceScope = `${clusterScope}/managedNamespaces/project`;
const options = {
  subscriptionId,
  principalId,
  principalType: 'ServicePrincipal' as const,
  role,
  scope: groupScope,
  credential: {
    getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 3600_000 }),
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const properties = () => ({
  principalId,
  principalType: 'ServicePrincipal',
  roleDefinitionId,
  scope: groupScope,
});
beforeEach(() => {
  mocks.fetch
    .mockReset()
    .mockImplementation((_url, init: RequestInit) =>
      Promise.resolve(json({ properties: JSON.parse(String(init.body)).properties }, 201))
    );
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(mocks.command).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('REST role assignment creation', () => {
  test.each([{ subscriptionId: 'invalid' }, { principalId: 'invalid' }])(
    'rejects invalid object/subscription IDs before authentication: %j',
    async invalid => {
      const getToken = vi.fn(options.credential.getToken);
      await expect(
        createAzureRoleAssignment({ ...options, ...invalid, credential: { getToken } })
      ).rejects.toThrow('Invalid subscription ID or principal ID');
      expect(getToken).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test('rejects an unsupported runtime principal type before authentication', async () => {
    await expect(
      createAzureRoleAssignment({
        ...options,
        // @ts-expect-error Exercise malformed input from a non-TypeScript caller.
        principalType: 'Application',
      })
    ).rejects.toThrow('Invalid principal type');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('rejects an empty role without looking up definitions or writing', async () => {
    await expect(createAzureRoleAssignment({ ...options, role: ' "" ' })).rejects.toThrow(
      'A role name or definition ID is required'
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test.each([`/providers/Microsoft.Authorization/roleDefinitions/${role}`, roleDefinitionId])(
    'accepts a role-definition ID without a name lookup: %s',
    async roleId => {
      await createAzureRoleAssignment({ ...options, role: roleId });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).properties.roleDefinitionId).toBe(
        roleDefinitionId
      );
    }
  );

  test('rejects a matching role definition with a malformed resource ID before writing', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ value: [{ id: '/invalid-definition', properties: { roleName: 'Reader' } }] })
    );
    await expect(createAzureRoleAssignment({ ...options, role: 'Reader' })).rejects.toThrow(
      'invalid resource ID'
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].method).toBe('GET');
  });

  test.each([
    groupScope,
    clusterScope,
    namespaceScope,
    `${groupScope}/providers/Microsoft.ContainerRegistry/registries/acr`,
    `${groupScope}/providers/Microsoft.Kubernetes/connectedClusters/arc/namespaces/project`,
  ])('preserves the exact ARM scope %s', async scope => {
    await createAzureRoleAssignment({ ...options, scope });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toMatch(
      new RegExp(`/roleAssignments/[a-f0-9-]+\\?api-version=2022-04-01$`)
    );
    expect(String(url).split('/providers/Microsoft.Authorization')[0]).toBe(
      `https://management.azure.com${scope}`
    );
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      properties: { roleDefinitionId, principalId, principalType: 'ServicePrincipal' },
    });
  });

  test.each(['User', 'Group', 'ServicePrincipal'] as const)(
    'uses the known %s object ID without directory lookup',
    async principalType => {
      await createAzureRoleAssignment({ ...options, principalType });
      expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).properties).toMatchObject({
        principalType,
        principalId,
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    }
  );

  test('uses the same retry GUID for equivalent scope/principal/role casing', async () => {
    await createAzureRoleAssignment(options);
    await createAzureRoleAssignment({
      ...options,
      scope: `${groupScope.toUpperCase()}/`,
      role: role.toUpperCase(),
    });
    const names = mocks.fetch.mock.calls.map(([url]) =>
      new URL(String(url)).pathname.split('/').pop()
    );
    expect(names[0]).toBe(names[1]);
    expect(names[0]).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
    );
  });

  test('keeps retry names stable across raw and encoded Unicode scopes', async () => {
    const raw = groupScope.replace('/resourceGroups/rg', '/resourceGroups/rg-équipe');
    const encoded = groupScope.replace('/resourceGroups/rg', '/resourceGroups/rg-%C3%A9quipe');
    await createAzureRoleAssignment({ ...options, scope: raw });
    await createAzureRoleAssignment({ ...options, scope: encoded });
    const names = mocks.fetch.mock.calls.map(([url]) =>
      new URL(String(url)).pathname.split('/').pop()
    );
    expect(names[0]).toBe(names[1]);
  });

  test('matches encoded versus raw Unicode scopes when verifying an existing assignment', async () => {
    const raw = groupScope.replace('/resourceGroups/rg', '/resourceGroups/rg-équipe');
    const encoded = groupScope.replace('/resourceGroups/rg', '/resourceGroups/rg-%C3%A9quipe');
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockResolvedValueOnce(
        json({ value: [{ id: 'existing', properties: { ...properties(), scope: raw } }] })
      );
    expect(await createAzureRoleAssignment({ ...options, scope: encoded })).toMatchObject({
      id: 'existing',
    });
  });

  test('resolves escaped role names with paging and preserves Arc role names', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        json({
          value: [],
          nextLink: `https://management.azure.com${groupScope}/providers/Microsoft.Authorization/roleDefinitions?page=2`,
        })
      )
      .mockResolvedValueOnce(
        json({
          value: [{ id: roleDefinitionId, properties: { roleName: "Azure Arc Dev's Role" } }],
        })
      )
      .mockResolvedValueOnce(json({ properties: properties() }, 201));
    await createAzureRoleAssignment({ ...options, role: '"Azure Arc Dev\'s Role"' });
    expect(new URL(String(mocks.fetch.mock.calls[0][0])).searchParams.get('$filter')).toBe(
      "roleName eq 'Azure Arc Dev''s Role'"
    );
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'PUT']);
  });

  test.each([
    { value: [] },
    {
      value: [
        { id: roleDefinitionId, properties: { roleName: 'Reader' } },
        { id: roleDefinitionId, properties: { roleName: 'Reader' } },
      ],
    },
  ])('rejects missing or ambiguous role definitions without a write', async ({ value }) => {
    mocks.fetch.mockResolvedValueOnce(json({ value }));
    await expect(createAzureRoleAssignment({ ...options, role: 'Reader' })).rejects.toThrow(
      'Expected one role definition'
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([429, 503])('retries an idempotent PUT after HTTP %s', async status => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, { status, headers: { 'Retry-After': '0' } })
    );
    expect(await createAzureRoleAssignment(options)).toMatchObject({
      properties: { principalId },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [[firstUrl, firstInit], [retryUrl, retryInit]] = mocks.fetch.mock.calls;
    expect(String(retryUrl)).toBe(String(firstUrl));
    expect(retryInit.method).toBe('PUT');
    expect(retryInit.body).toBe(firstInit.body);
  });

  test('retries an idempotent PUT after a network failure', async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError('Network unavailable'));
    expect(await createAzureRoleAssignment(options)).toMatchObject({
      properties: { principalId },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(String(mocks.fetch.mock.calls[1][0])).toBe(String(mocks.fetch.mock.calls[0][0]));
    expect(mocks.fetch.mock.calls[1][1].body).toBe(mocks.fetch.mock.calls[0][1].body);
  });

  test('stops after three retries and surfaces the final PUT failure', async () => {
    mocks.fetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: 'TooManyRequests', message: 'throttled' } }), {
          status: 429,
          headers: { 'Retry-After': '0' },
        })
    );
    await expect(createAzureRoleAssignment(options)).rejects.toMatchObject({
      status: 429,
      code: 'TooManyRequests',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(mocks.fetch.mock.calls.every(([, init]) => init.method === 'PUT')).toBe(true);
  });

  test('surfaces write denial without retries', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ error: { code: 'AuthorizationFailed', message: 'denied' } }, 403)
    );
    await expect(createAzureRoleAssignment(options)).rejects.toMatchObject({
      status: 403,
      code: 'AuthorizationFailed',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('accepts RoleAssignmentExists only after matching an existing assignment', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockResolvedValueOnce(
        json({ value: [{ id: 'existing-other-guid', properties: properties() }] })
      );
    expect(await createAzureRoleAssignment(options)).toMatchObject({ id: 'existing-other-guid' });
    expect(new URL(String(mocks.fetch.mock.calls[1][0])).searchParams.get('$filter')).toBe(
      'atScope()'
    );
  });

  test.each([
    { principalId: '00000000-0000-0000-0000-000000000001' },
    { principalType: 'User' },
    { scope: clusterScope },
    { roleDefinitionId: roleDefinitionId.replace(role, principalId) },
  ])('rejects nonmatching existing assignments %j', async mismatch => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockImplementation(async () =>
        json({ value: [{ properties: { ...properties(), ...mismatch } }] })
      );
    const rejected = expect(
      createAzureRoleAssignment({ ...options, timeoutMs: 100 })
    ).rejects.toMatchObject({
      code: 'RoleAssignmentExists',
    });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('rechecks stale conflict lists without replaying the PUT or accepting an inherited grant', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockResolvedValueOnce(json({ value: [{ properties: properties() }] }))
      .mockResolvedValueOnce(
        json({
          value: [{ id: 'existing', properties: { ...properties(), scope: clusterScope } }],
        })
      );
    const resolved = expect(
      createAzureRoleAssignment({ ...options, scope: clusterScope })
    ).resolves.toMatchObject({ id: 'existing' });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1000);
    await resolved;
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['PUT', 'GET', 'GET']);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(['cancel', 'timeout'])('bounds conflict-read backoff with %s', async mode => {
    vi.useFakeTimers();
    const controller = new AbortController();
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockImplementation(async () => json({ value: [] }));
    const rejection = expect(
      createAzureRoleAssignment({
        ...options,
        signal: controller.signal,
        timeoutMs: 100,
      })
    ).rejects;
    const rejected =
      mode === 'cancel'
        ? rejection.toThrow('cancelled')
        : rejection.toMatchObject({ status: 409, code: 'RoleAssignmentExists' });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    if (mode === 'cancel') controller.abort(new Error('cancelled'));
    else await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('bounds all conflict reads and waits by one verification deadline', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockImplementation(async () => json({ value: [] }));
    const rejected = expect(
      createAzureRoleAssignment({ ...options, timeoutMs: 5000 })
    ).rejects.toMatchObject({ status: 409, code: 'RoleAssignmentExists' });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual([
      'PUT',
      'GET',
      'GET',
      'GET',
      'GET',
      'GET',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('surfaces a denied conflict read without retrying it', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockResolvedValueOnce(json({ error: { code: 'AuthorizationFailed' } }, 403));
    await expect(createAzureRoleAssignment(options)).rejects.toMatchObject({
      status: 403,
      code: 'AuthorizationFailed',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not turn unrelated conflicts into success', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ error: { code: 'RoleAssignmentUpdateNotPermitted' } }, 409)
    );
    await expect(createAzureRoleAssignment(options)).rejects.toMatchObject({
      code: 'RoleAssignmentUpdateNotPermitted',
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test('does not accept an inherited assignment when the conflicting resource assignment is not yet visible', async () => {
    vi.useFakeTimers();
    mocks.fetch
      .mockResolvedValueOnce(json({ error: { code: 'RoleAssignmentExists' } }, 409))
      .mockImplementation(async () => json({ value: [{ properties: properties() }] }));
    const rejected = expect(
      createAzureRoleAssignment({ ...options, scope: clusterScope, timeoutMs: 100 })
    ).rejects.toMatchObject({ status: 409, code: 'RoleAssignmentExists' });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test('performs writes sequentially and reports each role result', async () => {
    let release!: (response: Response) => void;
    mocks.fetch
      .mockReturnValueOnce(
        new Promise(resolve => {
          release = resolve;
        })
      )
      .mockResolvedValueOnce(json({ error: { code: 'Denied', message: 'denied' } }, 403));
    const roles = [
      { role, scope: clusterScope },
      { role, scope: namespaceScope },
    ];
    const pending = assignAzureRoles({ ...options, roles });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    release(json({ properties: properties() }, 201));
    expect(await pending).toMatchObject({
      success: false,
      results: [
        { role, scope: clusterScope, success: true },
        { role, scope: namespaceScope, success: false, error: expect.stringContaining('Denied') },
      ],
    });
  });

  test.each([
    `${groupScope}/../other`,
    `${groupScope}/%2f..%2fother`,
    '/subscriptions/not-a-guid',
    `${groupScope}?escape=true`,
  ])('rejects malformed or traversing scopes %s', async scope => {
    await expect(createAzureRoleAssignment({ ...options, scope })).rejects.toThrow(
      'subscription resource ID'
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('preserves cross-subscription ACR scopes and resolves definitions in the target subscription', async () => {
    const registrySubscription = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const scope = `/subscriptions/${registrySubscription}/resourceGroups/registries/providers/Microsoft.ContainerRegistry/registries/acr`;
    await createAzureRoleAssignment({ ...options, scope });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toContain(
      `https://management.azure.com${scope}/providers/Microsoft.Authorization/roleAssignments/`
    );
    expect(JSON.parse(init.body).properties.roleDefinitionId).toBe(
      `/subscriptions/${registrySubscription}/providers/Microsoft.Authorization/roleDefinitions/${role}`
    );
  });

  test('does not issue writes after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      createAzureRoleAssignment({ ...options, signal: controller.signal })
    ).rejects.toThrow('cancelled');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('resolves a managed namespace via REST and keeps the namespace User default', async () => {
    mocks.fetch
      .mockResolvedValueOnce(json({ id: namespaceScope }))
      .mockResolvedValueOnce(
        json({ properties: { ...properties(), scope: namespaceScope, principalType: 'User' } }, 201)
      );
    const result = await createNamespaceRoleAssignment({
      ...options,
      clusterName: 'aks',
      resourceGroup: 'rg',
      namespaceName: 'project',
      assigneeObjectId: principalId,
      principalType: undefined,
    });
    expect(result.success).toBe(true);
    expect(String(mocks.fetch.mock.calls[0][0])).toContain(
      '/managedNamespaces/project?api-version=2026-01-01'
    );
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).properties.principalType).toBe('User');
  });

  test.each(['rg-équipe', 'rg-%C3%A9quipe'])(
    'compares decoded ARM IDs while retaining encoded HTTP paths: %s',
    async returnedGroup => {
      const returnedId = namespaceScope.replace(
        '/resourceGroups/rg/',
        `/resourceGroups/${returnedGroup}/`
      );
      mocks.fetch.mockResolvedValueOnce(json({ id: returnedId }));
      const result = await getManagedNamespaceResourceId({
        ...options,
        clusterName: 'aks',
        resourceGroup: 'rg-équipe',
        namespaceName: 'project',
      });
      expect(result).toEqual({ success: true, resourceId: returnedId });
      expect(String(mocks.fetch.mock.calls[0][0])).toContain('/resourceGroups/rg-%C3%A9quipe/');
    }
  );

  test('rejects a decoded namespace ID belonging to a different resource group', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({
        id: namespaceScope.replace('/resourceGroups/rg/', '/resourceGroups/other/'),
      })
    );
    expect(
      await getManagedNamespaceResourceId({
        ...options,
        clusterName: 'aks',
        resourceGroup: 'rg-équipe',
        namespaceName: 'project',
      })
    ).toMatchObject({ success: false, error: expect.stringContaining('expected resource ID') });
  });

  test('distinguishes a native namespace from a forbidden managed-namespace lookup', async () => {
    const coords = {
      ...options,
      clusterName: 'aks',
      resourceGroup: 'rg',
      namespaceName: 'project',
    };
    mocks.fetch.mockResolvedValueOnce(json({ error: { code: 'ResourceNotFound' } }, 404));
    expect(await getManagedNamespaceResourceId(coords)).toEqual({
      success: true,
      resourceId: undefined,
    });
    mocks.fetch.mockResolvedValueOnce(json({ error: { code: 'AuthorizationFailed' } }, 403));
    expect(await getManagedNamespaceResourceId(coords)).toMatchObject({
      success: false,
      error: expect.stringContaining('AuthorizationFailed'),
    });
  });

  test('treats a flat ContainerService NotFound response as a native namespace', async () => {
    mocks.fetch.mockResolvedValueOnce(json({ code: 'NotFound', message: 'Namespace absent' }, 404));
    expect(
      await getManagedNamespaceResourceId({
        ...options,
        clusterName: 'aks',
        resourceGroup: 'rg',
        namespaceName: 'project',
      })
    ).toEqual({ success: true, resourceId: undefined });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    { code: 'NotFound', status: 403 },
    { code: 'UnexpectedError', status: 404 },
    { code: undefined, status: 404 },
  ])('does not infer namespace absence from an unrecognized flat failure: %j', async response => {
    mocks.fetch.mockResolvedValueOnce(
      json({ code: response.code, message: 'Lookup failed' }, response.status)
    );
    expect(
      await getManagedNamespaceResourceId({
        ...options,
        clusterName: 'aks',
        resourceGroup: 'rg',
        namespaceName: 'project',
      })
    ).toMatchObject({ success: false, error: expect.stringContaining('Lookup failed') });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    { code: 'ResourceNotFound', status: 404 },
    { code: 'AuthorizationFailed', status: 403 },
  ])(
    'does not grant namespace roles after lookup failure/absence: %j',
    async ({ code, status }) => {
      mocks.fetch.mockResolvedValueOnce(json({ error: { code } }, status));
      const result = await createNamespaceRoleAssignment({
        ...options,
        clusterName: 'aks',
        resourceGroup: 'rg',
        namespaceName: 'project',
        assigneeObjectId: principalId,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
      expect(mocks.fetch.mock.calls[0][1].method).toBe('GET');
    }
  );
});
