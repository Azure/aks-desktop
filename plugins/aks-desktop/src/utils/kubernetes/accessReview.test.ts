// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockClusterRequest = vi.fn();

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { clusterRequest: (...args: any[]) => mockClusterRequest(...args) },
}));

import { reviewNamespaceAccess } from './accessReview';

const OID = '38927c93-a0fd-4b06-b21a-69b8ed1e208c';
const UPN = 'sannagaraj@microsoft.com';

/** The SubjectAccessReview body sent on the most recent call. */
function sentBody() {
  return JSON.parse(mockClusterRequest.mock.calls[0][1].body);
}

describe('reviewNamespaceAccess', () => {
  beforeEach(() => {
    mockClusterRequest.mockReset();
    mockClusterRequest.mockResolvedValue({ status: { allowed: true, reason: 'ok' } });
  });

  test('names the subject by username — what the RBAC authorizer matches', async () => {
    await reviewNamespaceAccess('c', UPN, OID, 'ns');
    expect(sentBody().spec.user).toBe(UPN);
    expect(sentBody().spec.resourceAttributes).toEqual({
      namespace: 'ns',
      verb: 'get',
      resource: 'pods',
    });
  });

  test('sends the object ID as extra.oid — what guard resolves the principal from', async () => {
    // The regression this guards: without extra.oid, guard answers "Azure does not
    // have opinion for this non AAD user" and a working grant reads as denied.
    await reviewNamespaceAccess('c', UPN, OID, 'ns');
    expect(sentBody().spec.extra).toEqual({ oid: [OID] });
  });

  test('omits extra entirely when no object ID is known', async () => {
    await reviewNamespaceAccess('c', UPN, undefined, 'ns');
    expect(sentBody().spec.extra).toBeUndefined();
    expect(sentBody().spec.user).toBe(UPN);
  });

  test('posts to the SubjectAccessReview endpoint on the named cluster', async () => {
    await reviewNamespaceAccess('my-cluster', UPN, OID, 'ns');
    const [path, opts] = mockClusterRequest.mock.calls[0];
    expect(path).toBe('/apis/authorization.k8s.io/v1/subjectaccessreviews');
    expect(opts.cluster).toBe('my-cluster');
    expect(opts.method).toBe('POST');
  });

  test('reports the verdict and reason', async () => {
    mockClusterRequest.mockResolvedValue({
      status: { allowed: true, reason: 'Access allowed by Azure RBAC Role Assignment' },
    });
    await expect(reviewNamespaceAccess('c', UPN, OID, 'ns')).resolves.toMatchObject({
      allowed: true,
      reason: 'Access allowed by Azure RBAC Role Assignment',
    });
  });

  test('a denial is reported as denied, not as an error', async () => {
    mockClusterRequest.mockResolvedValue({ status: { allowed: false } });
    await expect(reviewNamespaceAccess('c', UPN, OID, 'ns')).resolves.toMatchObject({
      allowed: false,
    });
  });

  test('an unusable review is null, distinct from a denial', async () => {
    // The caller must be able to tell "denied" from "could not ask" — e.g. when
    // the operator cannot create SubjectAccessReviews.
    mockClusterRequest.mockRejectedValue(new Error('forbidden'));
    await expect(reviewNamespaceAccess('c', UPN, OID, 'ns')).resolves.toMatchObject({
      allowed: null,
      error: 'forbidden',
    });
  });
});
